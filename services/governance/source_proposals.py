"""SourceProposed proposals. Source: docs/04-ingestion.md, sources that an agent finds.

An agent (or the brief loader) writes a SourceProposed proposal with evidence. Only an admin approves it.
An approval makes a new brief version with the source and activates it. The next run collects the source.
"""

from __future__ import annotations

import copy
import logging

import psycopg
from psycopg.types.json import Jsonb

from services.collectors.brief import activate, active_brief, derive_version
from services.common.config import approval_policy
from services.common.ids import new_id
from services.common.logging import log

from .event_store import append_event

logger = logging.getLogger("strata.governance.sources")
KIND = "SourceProposed"


class ProposalError(ValueError):
    pass


class ProposalForbidden(PermissionError):
    pass


def policy_for_source_proposal() -> str:
    return approval_policy()["policies"][KIND]["policy"]


def find_source_proposal(conn: psycopg.Connection, brief_source_id: str) -> dict | None:
    return conn.execute(
        "SELECT * FROM proposal WHERE kind = %s AND events->0->'payload'->'source'->>'id' = %s "
        "ORDER BY created_at LIMIT 1",
        (KIND, brief_source_id),
    ).fetchone()


def create_source_proposal(
    conn: psycopg.Connection,
    entry: dict,
    *,
    created_by_type: str,
    created_by: str,
    evidence_ids: list[str],
    source_id: str | None = None,
    brief_version_id: str | None = None,
    model_id: str | None = None,
    prompt_version: str | None = None,
) -> tuple[dict, bool]:
    """Write a SourceProposed proposal and its ProposalCreated event. Idempotent by the source id.

    The caller commits.
    """
    existing = find_source_proposal(conn, entry["id"])
    if existing:
        return existing, False
    if not evidence_ids:
        raise ProposalError("a SourceProposed proposal needs evidence")
    proposal_id = new_id()
    policy = policy_for_source_proposal()
    events = [{"event_type": KIND, "stream_type": "brief", "stream_id": "main", "payload": {"source": entry}}]
    title = f"Add source: {entry.get('name') or entry['id']}"
    row = conn.execute(
        """INSERT INTO proposal (id, kind, status, policy, created_by_type, created_by, model_id, prompt_version,
             source_id, stream_type, stream_id, title, summary, events, evidence_ids, brief_version_id)
           VALUES (%s, %s, 'pending', %s, %s, %s, %s, %s, %s, 'brief', 'main', %s, %s, %s, %s, %s) RETURNING *""",
        (proposal_id, KIND, policy, created_by_type, created_by, model_id, prompt_version, source_id, title,
         entry.get("reason"), Jsonb(events), evidence_ids, brief_version_id),
    ).fetchone()
    append_event(
        conn, stream_type="proposal", stream_id=proposal_id, event_type="ProposalCreated",
        payload={"proposal_id": proposal_id, "kind": KIND, "policy": policy, "title": title, "events": events,
                 "evidence_ids": evidence_ids},
        actor_type=created_by_type, actor_id=created_by, model_id=model_id, prompt_version=prompt_version,
        proposal_id=proposal_id, brief_version_id=brief_version_id,
    )
    log(logger, logging.INFO, "source proposal created", proposal_id=proposal_id, source=entry["id"])
    return row, True


def _add_source(entry: dict):
    def change(content: dict) -> None:
        sources = content.setdefault("sources", {})
        proposed = [s for s in sources.get("proposed") or [] if s.get("id") != entry["id"]]
        sources["proposed"] = proposed
        section = "early_signal" if entry.get("source_type") else "news"
        clean = {k: v for k, v in entry.items() if k != "reason"}
        target = [s for s in sources.get(section) or [] if s.get("id") != entry["id"]]
        target.append(clean)
        sources[section] = target

    return change


def approve_source_proposal(conn: psycopg.Connection, proposal_id: str, *, user_id: str,
                            reason: str | None = None) -> dict:
    """Approve a SourceProposed proposal: new brief version with the source, activation, ProposalApproved.

    The caller commits. Raises ProposalForbidden when the user created the proposal.
    """
    proposal = conn.execute("SELECT * FROM proposal WHERE id = %s FOR UPDATE", (proposal_id,)).fetchone()
    if proposal is None or proposal["kind"] != KIND:
        raise LookupError(f"no SourceProposed proposal {proposal_id}")
    if proposal["status"] != "pending":
        raise ProposalError(f"proposal {proposal_id} is {proposal['status']}")
    if proposal["created_by"] == user_id:
        raise ProposalForbidden("a user cannot approve a proposal that the same user created")
    entry = copy.deepcopy(proposal["events"][0]["payload"]["source"])
    base = active_brief(conn)
    if base is None:
        raise ProposalError("no active brief")
    new_version = derive_version(conn, base, _add_source(entry), created_by=user_id,
                                 change_note=f"Approved SourceProposed proposal {proposal_id}: {entry['id']}")
    activate(conn, new_version["id"], actor_type="human", actor_id=user_id)
    conn.execute(
        "UPDATE proposal SET status = 'approved', decided_by = %s, decided_at = clock_timestamp(), "
        "decision_reason = %s WHERE id = %s",
        (user_id, reason, proposal_id),
    )
    append_event(
        conn, stream_type="proposal", stream_id=proposal_id, event_type="ProposalApproved",
        payload={"proposal_id": proposal_id, "kind": KIND, "brief_version_id": new_version["id"],
                 "version": new_version["version"], "source_id": entry["id"]},
        actor_type="human", actor_id=user_id, proposal_id=proposal_id, brief_version_id=new_version["id"],
    )
    log(logger, logging.INFO, "source proposal approved", proposal_id=proposal_id, version=new_version["version"])
    return new_version
