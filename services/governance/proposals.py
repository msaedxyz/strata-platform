"""Proposals and the approval policy. Source: docs/06-governance.md.

Agents and analysts write proposals. Only this module (the governance service) turns a proposal into
events in the canonical record, through services/governance/event_store.append_event.

create_proposal()
    Writes the proposal row and a ProposalCreated event in stream ('proposal', id). The payload holds the
    proposed events (stream_type, stream_id, event_type, payload, evidence_ids, certainty). The policy
    comes from config/approval-policy.yaml. An automatic proposal is written at once: the events, the
    status auto_approved and a ProposalApproved event with actor system.
approve(), reject(), edit_and_approve()
    The decisions of an approver. A user cannot approve a proposal that the same user created
    (ProposalForbidden, a PermissionError that the API maps to HTTP 403). A rejection needs a reason.
    Edit and approve writes human events that keep the evidence of the original events.
"""

from __future__ import annotations

import logging
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from services.common.config import approval_policy
from services.common.ids import new_id
from services.common.logging import log

from .event_store import append_event, validate_payload

logger = logging.getLogger("strata.governance.proposals")
_STRICTNESS = {"automatic": 0, "review": 1, "admin_review": 2}
SYSTEM_ACTOR = "governance"


class ProposalError(ValueError):
    pass


class ProposalForbidden(PermissionError):
    """The API maps this error to HTTP 403."""


# ---------- policy ----------


def event_policy(event: dict, *, force_review: bool = False) -> str:
    """The policy of one proposed event from config/approval-policy.yaml."""
    entry = approval_policy()["policies"].get(event["event_type"])
    if entry is None:
        return "review"
    policy = entry["policy"]
    cond = entry.get("automatic_if")
    if cond and policy != "automatic":
        ok = True
        if "certainty" in cond and event.get("certainty") != cond["certainty"]:
            ok = False
        if cond.get("new_entity") and not event.get("payload", {}).get("new_entity"):
            ok = False
        if "min_resolution_confidence" in cond:
            conf = event.get("payload", {}).get("resolution_confidence")
            if conf is None or float(conf) < float(cond["min_resolution_confidence"]):
                ok = False
        if ok:
            policy = "automatic"
    if force_review and policy == "automatic":
        policy = "review"
    return policy


def proposal_policy(events: list[dict], *, force_review: bool = False) -> str:
    policies = [event_policy(e, force_review=force_review) for e in events]
    return max(policies, key=lambda p: _STRICTNESS[p]) if policies else "review"


# ---------- writing ----------


def _clean_event(ev: dict) -> dict:
    out = {
        "stream_type": ev["stream_type"], "stream_id": ev["stream_id"], "event_type": ev["event_type"],
        "payload": ev["payload"], "evidence_ids": list(ev.get("evidence_ids") or []), "certainty": ev.get("certainty"),
    }
    if ev.get("occurred_at") is not None:
        out["occurred_at"] = ev["occurred_at"].isoformat() if hasattr(ev["occurred_at"], "isoformat") else ev["occurred_at"]
    if ev.get("new_entity"):
        out["new_entity"] = ev["new_entity"]
    return out


def _ensure_registry(conn: psycopg.Connection, ev: dict) -> None:
    """A new entity gets its registry row when its EntityIdentified event is written."""
    if ev["event_type"] != "EntityIdentified":
        return
    etype = ev["payload"]["entity_type"]
    conn.execute(
        "INSERT INTO entity (id, type, site_class) VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING",
        (ev["stream_id"], etype, ev["payload"].get("site_class") if etype == "site" else None),
    )


def _write_events(conn: psycopg.Connection, proposal: dict, events: list[dict], *, actor_type: str, actor_id: str,
                  model_id: str | None, prompt_version: str | None) -> list[dict]:
    written = []
    for ev in events:
        _ensure_registry(conn, ev)
        written.append(append_event(
            conn, stream_type=ev["stream_type"], stream_id=ev["stream_id"], event_type=ev["event_type"],
            payload=ev["payload"], actor_type=actor_type, actor_id=actor_id, evidence_ids=ev.get("evidence_ids") or [],
            certainty=ev.get("certainty"), model_id=model_id, prompt_version=prompt_version, proposal_id=proposal["id"],
            brief_version_id=proposal.get("brief_version_id"), occurred_at=ev.get("occurred_at"),
        ))
    return written


def _after_human_write(conn: psycopg.Connection, written: list[dict]) -> None:
    """The window forecaster follows each approved stage change (docs/05, window forecaster)."""
    from services.enrichment.forecaster import forecast_after_stage

    for row in written:
        if row["event_type"] == "ProjectStageChanged":
            forecast_after_stage(conn, row)


def find_by_key(conn: psycopg.Connection, key: str) -> dict | None:
    return conn.execute("SELECT * FROM proposal WHERE idempotency_key = %s", (key,)).fetchone()


def create_proposal(
    conn: psycopg.Connection,
    *,
    kind: str,
    title: str,
    events: list[dict],
    created_by_type: str,
    created_by: str,
    model_id: str | None = None,
    prompt_version: str | None = None,
    source_id: str | None = None,
    brief_version_id: str | None = None,
    summary: str | None = None,
    tier: int | None = None,
    idempotency_key: str | None = None,
    force_review: bool = False,
) -> tuple[dict, bool]:
    """Write a proposal, its ProposalCreated event and, for an automatic proposal, its events.

    Returns (proposal row, created). A proposal with a known idempotency key is returned as it is.
    The caller commits.
    """
    if idempotency_key:
        existing = find_by_key(conn, idempotency_key)
        if existing:
            return existing, False
    if not events:
        raise ProposalError("a proposal needs at least one event")
    clean = [_clean_event(e) for e in events]
    for ev in clean:
        validate_payload(ev["event_type"], ev["payload"])
    policy = proposal_policy(clean, force_review=force_review)
    proposal_id = new_id()
    evidence_ids = list(dict.fromkeys(i for ev in clean for i in ev["evidence_ids"]))
    first = clean[0]
    row = conn.execute(
        """INSERT INTO proposal (id, kind, status, policy, created_by_type, created_by, model_id, prompt_version,
             source_id, stream_type, stream_id, title, summary, events, evidence_ids, tier, brief_version_id, idempotency_key)
           VALUES (%s, %s, 'pending', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (proposal_id, kind, policy, created_by_type, created_by, model_id, prompt_version, source_id,
         first["stream_type"], first["stream_id"], title[:500], summary, Jsonb(clean), evidence_ids, tier,
         brief_version_id, idempotency_key),
    ).fetchone()
    append_event(
        conn, stream_type="proposal", stream_id=proposal_id, event_type="ProposalCreated",
        payload={"proposal_id": proposal_id, "kind": kind, "policy": policy, "title": title[:500], "events": clean,
                 "evidence_ids": evidence_ids, "source_id": source_id},
        actor_type=created_by_type, actor_id=created_by, model_id=model_id, prompt_version=prompt_version,
        proposal_id=proposal_id, brief_version_id=brief_version_id,
    )
    if policy == "automatic":
        _write_events(conn, row, clean, actor_type=created_by_type, actor_id=created_by, model_id=model_id,
                      prompt_version=prompt_version)
        row = conn.execute(
            "UPDATE proposal SET status = 'auto_approved', decided_by = %s, decided_at = clock_timestamp() "
            "WHERE id = %s RETURNING *", (SYSTEM_ACTOR, proposal_id),
        ).fetchone()
        append_event(
            conn, stream_type="proposal", stream_id=proposal_id, event_type="ProposalApproved",
            payload={"proposal_id": proposal_id, "kind": kind, "policy": policy, "automatic": True},
            actor_type="system", actor_id=SYSTEM_ACTOR, proposal_id=proposal_id, brief_version_id=brief_version_id,
        )
    log(logger, logging.INFO, "proposal created", proposal_id=proposal_id, kind=kind, policy=policy,
        status=row["status"])
    return row, True


# ---------- decisions ----------


def _pending(conn: psycopg.Connection, proposal_id: str) -> dict:
    proposal = conn.execute("SELECT * FROM proposal WHERE id = %s FOR UPDATE", (proposal_id,)).fetchone()
    if proposal is None:
        raise LookupError(f"no proposal {proposal_id}")
    if proposal["status"] != "pending":
        raise ProposalError(f"proposal {proposal_id} is {proposal['status']}")
    return proposal


def _check_not_own(proposal: dict, user_id: str) -> None:
    if proposal["created_by"] == user_id:
        raise ProposalForbidden("a user cannot approve a proposal that the same user created")


def _targets(events: list[dict]) -> list[dict]:
    return [{"event_type": e["event_type"], "stream_type": e["stream_type"], "stream_id": e["stream_id"]} for e in events]


def approve(conn: psycopg.Connection, proposal_id: str, user_id: str, reason: str | None = None) -> list[dict]:
    """Write the proposed events. The actor of each event is the author of the proposal. The caller commits."""
    proposal = _pending(conn, proposal_id)
    if proposal["kind"] == "SourceProposed":
        raise ProposalError("use services.governance.source_proposals.approve_source_proposal for a SourceProposed proposal")
    _check_not_own(proposal, user_id)
    written = _write_events(conn, proposal, proposal["events"], actor_type=proposal["created_by_type"],
                            actor_id=proposal["created_by"], model_id=proposal["model_id"],
                            prompt_version=proposal["prompt_version"])
    conn.execute(
        "UPDATE proposal SET status = 'approved', decided_by = %s, decided_at = clock_timestamp(), decision_reason = %s "
        "WHERE id = %s", (user_id, reason, proposal_id),
    )
    append_event(
        conn, stream_type="proposal", stream_id=proposal_id, event_type="ProposalApproved",
        payload={"proposal_id": proposal_id, "kind": proposal["kind"], "reason": reason,
                 "event_ids": [w["id"] for w in written]},
        actor_type="human", actor_id=user_id, proposal_id=proposal_id, brief_version_id=proposal["brief_version_id"],
    )
    _after_human_write(conn, written)
    log(logger, logging.INFO, "proposal approved", proposal_id=proposal_id, user=user_id)
    return written


def reject(conn: psycopg.Connection, proposal_id: str, user_id: str, reason: str) -> dict:
    """Reject a proposal. No event goes to the record. A rejection needs a reason. The caller commits."""
    if not reason or not reason.strip():
        raise ProposalError("a rejection needs a reason")
    proposal = _pending(conn, proposal_id)
    row = conn.execute(
        "UPDATE proposal SET status = 'rejected', decided_by = %s, decided_at = clock_timestamp(), decision_reason = %s "
        "WHERE id = %s RETURNING *", (user_id, reason.strip(), proposal_id),
    ).fetchone()
    append_event(
        conn, stream_type="proposal", stream_id=proposal_id, event_type="ProposalRejected",
        payload={"proposal_id": proposal_id, "kind": proposal["kind"], "reason": reason.strip(),
                 "targets": _targets(proposal["events"])},
        actor_type="human", actor_id=user_id, proposal_id=proposal_id, brief_version_id=proposal["brief_version_id"],
    )
    log(logger, logging.INFO, "proposal rejected", proposal_id=proposal_id, user=user_id)
    return row


def edit_and_approve(conn: psycopg.Connection, proposal_id: str, user_id: str, edited_events: list[dict[str, Any]],
                     reason: str | None = None) -> list[dict]:
    """Write the edited events as human events. Each edited event keeps the evidence of the original event.

    edited_events has one entry for each proposed event, in the same order. An entry can change the payload
    and the certainty. The stream and the event type stay. The caller commits.
    """
    proposal = _pending(conn, proposal_id)
    _check_not_own(proposal, user_id)
    original = proposal["events"]
    if len(edited_events) != len(original):
        raise ProposalError("edited_events must have one entry for each proposed event")
    final = []
    for orig, edit in zip(original, edited_events, strict=True):
        if edit.get("event_type", orig["event_type"]) != orig["event_type"] or \
                edit.get("stream_id", orig["stream_id"]) != orig["stream_id"]:
            raise ProposalError("an edit cannot change the event type or the stream")
        ev = {**orig, "payload": edit.get("payload", orig["payload"]),
              "certainty": edit.get("certainty", orig.get("certainty")), "evidence_ids": list(orig["evidence_ids"])}
        validate_payload(ev["event_type"], ev["payload"])
        final.append(ev)
    written = _write_events(conn, proposal, final, actor_type="human", actor_id=user_id, model_id=None, prompt_version=None)
    conn.execute(
        "UPDATE proposal SET status = 'edited_approved', decided_by = %s, decided_at = clock_timestamp(), "
        "decision_reason = %s, edited_events = %s WHERE id = %s",
        (user_id, reason, Jsonb(final), proposal_id),
    )
    append_event(
        conn, stream_type="proposal", stream_id=proposal_id, event_type="ProposalEditedApproved",
        payload={"proposal_id": proposal_id, "kind": proposal["kind"], "reason": reason,
                 "event_ids": [w["id"] for w in written], "edited_events": final},
        actor_type="human", actor_id=user_id, proposal_id=proposal_id, brief_version_id=proposal["brief_version_id"],
    )
    _after_human_write(conn, written)
    log(logger, logging.INFO, "proposal edited and approved", proposal_id=proposal_id, user=user_id)
    return written
