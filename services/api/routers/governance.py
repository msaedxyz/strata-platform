"""Approval queue, alert decisions, alert telemetry and personal data. Source: docs/06-governance.md and
docs/api-contract.md (write endpoints).

The API enforces each role. The frontend only hides controls. Each write by a user becomes an event with
actor type human through the governance service (services/governance).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from services.common.db import connection
from services.governance import alerts as alert_service
from services.governance import personal
from services.governance import proposals as proposal_service

from ..auth import User, require_admin, require_analyst, require_approver, require_viewer
from .errors import domain_errors
from .schemas import AlertState, ApproveResult, Proposal, ProposalList, RejectResult, Telemetry

router = APIRouter(prefix="/api", tags=["governance"])

ProposalStatus = Literal["pending", "approved", "rejected", "edited_approved", "auto_approved"]


def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_jsonable(v) for v in value]
    return value


# ---------- approval queue ----------


def _evidence_items(conn, ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    rows = conn.execute(
        "SELECT v.id, v.source_id, v.char_start, v.char_end, v.quote, v.verified, s.url, s.title, s.publisher, "
        "s.published_at, s.retention_policy FROM evidence v JOIN source s ON s.id = v.source_id WHERE v.id = ANY(%s)",
        (ids,),
    ).fetchall()
    return {r["id"]: _jsonable(dict(r)) for r in rows}


def _proposal_view(row: dict, evidence: dict[str, dict], user: User) -> dict:
    events = []
    for ev in row["events"] or []:
        events.append({**ev, "evidence": [evidence[i] for i in ev.get("evidence_ids") or [] if i in evidence]})
    all_ids = list(dict.fromkeys([*(row["evidence_ids"] or []), *(i for ev in events for i in ev.get("evidence_ids") or [])]))
    return {
        "id": row["id"], "kind": row["kind"], "status": row["status"], "policy": row["policy"], "title": row["title"],
        "summary": row["summary"], "tier": row["tier"], "created_by_type": row["created_by_type"],
        "created_by": row["created_by"], "created_by_me": row["created_by"] == user.id,
        "model_id": row["model_id"], "prompt_version": row["prompt_version"], "source_id": row["source_id"],
        "stream_type": row["stream_type"], "stream_id": row["stream_id"], "created_at": _jsonable(row["created_at"]),
        "decided_by": row["decided_by"], "decided_at": _jsonable(row["decided_at"]),
        "decision_reason": row["decision_reason"], "events": _jsonable(events),
        "evidence": [evidence[i] for i in all_ids if i in evidence],
    }


def _proposal_views(conn, rows: list[dict], user: User) -> list[dict]:
    ids = list({i for r in rows for i in [*(r["evidence_ids"] or []),
                                          *(x for ev in r["events"] or [] for x in ev.get("evidence_ids") or [])]})
    evidence = _evidence_items(conn, ids)
    return [_proposal_view(r, evidence, user) for r in rows]


@router.get("/proposals", response_model=ProposalList)
def list_proposals(
    status: list[ProposalStatus] | None = Query(None),
    kind: list[str] | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_viewer),
) -> dict:
    """The approval queue: each proposal with its proposed events and its evidence items (quote, span offsets,
    source url, title and publisher). status=pending gives the open queue."""
    where, args = ["true"], []
    if status:
        where.append("status = ANY(%s)")
        args.append(status)
    if kind:
        where.append("kind = ANY(%s)")
        args.append(kind)
    clause = " AND ".join(where)
    with connection() as conn:
        total = conn.execute(f"SELECT count(*) AS n FROM proposal WHERE {clause}", args).fetchone()["n"]
        rows = conn.execute(f"SELECT * FROM proposal WHERE {clause} ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s",
                            [*args, limit, offset]).fetchall()
        items = _proposal_views(conn, rows, user)
    return {"total": total, "items": items}


@router.get("/proposals/{proposal_id}", response_model=Proposal)
def get_proposal(proposal_id: str, user: User = Depends(require_viewer)) -> dict:
    with connection() as conn:
        row = conn.execute("SELECT * FROM proposal WHERE id = %s", (proposal_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "proposal not found")
        return _proposal_views(conn, [row], user)[0]


def _check_admin_review(conn, proposal_id: str, user: User) -> None:
    row = conn.execute("SELECT policy, kind FROM proposal WHERE id = %s", (proposal_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "proposal not found")
    if row["policy"] == "admin_review" and not user.has("admin"):
        raise HTTPException(403, "an admin decides this proposal")
    if row["kind"] == "SourceProposed":
        raise HTTPException(409, "approve a SourceProposed proposal with POST /api/proposals/{id}/approve-source")


class Decision(BaseModel):
    reason: str | None = Field(None, max_length=2000)


class Rejection(BaseModel):
    reason: str = Field(min_length=1, max_length=2000, pattern=r"\S")


class EditedEvent(BaseModel):
    payload: dict | None = None
    certainty: Literal["stated", "reported", "speculative"] | None = None


class EditApprove(BaseModel):
    events: list[EditedEvent] = Field(min_length=1)
    reason: str | None = Field(None, max_length=2000)


@router.post("/proposals/{proposal_id}/approve", response_model=ApproveResult)
def approve_proposal(proposal_id: str, body: Decision | None = None, user: User = Depends(require_approver)) -> dict:
    """Approve: the governance service writes the proposed events. 403 for the creator of the proposal."""
    with connection() as conn, domain_errors(conn):
        _check_admin_review(conn, proposal_id, user)
        written = proposal_service.approve(conn, proposal_id, user.id, reason=body.reason if body else None)
        conn.commit()
    return {"status": "approved", "proposal_id": proposal_id, "event_ids": [w["id"] for w in written]}


@router.post("/proposals/{proposal_id}/reject", response_model=RejectResult)
def reject_proposal(proposal_id: str, body: Rejection, user: User = Depends(require_approver)) -> dict:
    """Reject with a reason (422 without). No event goes to the record."""
    with connection() as conn, domain_errors(conn):
        _check_admin_review(conn, proposal_id, user)
        proposal_service.reject(conn, proposal_id, user.id, body.reason)
        conn.commit()
    return {"status": "rejected", "proposal_id": proposal_id}


@router.post("/proposals/{proposal_id}/edit-approve", response_model=ApproveResult)
def edit_approve_proposal(proposal_id: str, body: EditApprove, user: User = Depends(require_approver)) -> dict:
    """Edit and approve: human events that keep the original evidence. 403 for the creator of the proposal."""
    edits = [e.model_dump(exclude_none=True) for e in body.events]
    with connection() as conn, domain_errors(conn):
        _check_admin_review(conn, proposal_id, user)
        written = proposal_service.edit_and_approve(conn, proposal_id, user.id, edits, reason=body.reason)
        conn.commit()
    return {"status": "edited_approved", "proposal_id": proposal_id, "event_ids": [w["id"] for w in written]}


# ---------- alerts ----------


class AlertConfirm(BaseModel):
    reason: str | None = Field(None, max_length=2000)


class AlertDismiss(BaseModel):
    reason: str = Field(min_length=1, max_length=2000, pattern=r"\S")
    false_positive: bool = False


def _alert_view(row: dict) -> dict:
    return _jsonable({k: row[k] for k in ("id", "tier", "tier_rule", "title", "status", "acknowledged_at",
                                          "acknowledged_by", "decided_at", "decided_by", "decision_reason")})


@router.post("/alerts/{alert_id}/acknowledge", response_model=AlertState)
def acknowledge_alert(alert_id: str, user: User = Depends(require_analyst)) -> dict:
    """AlertAcknowledged with the user as the actor. A second acknowledgement writes nothing."""
    with connection() as conn, domain_errors(conn):
        row = alert_service.acknowledge(conn, alert_id, user.id)
        conn.commit()
    return _alert_view(row)


@router.post("/alerts/{alert_id}/confirm", response_model=AlertState)
def confirm_alert(alert_id: str, body: AlertConfirm | None = None, user: User = Depends(require_approver)) -> dict:
    """AlertConfirmed. 409 when the alert is already decided."""
    with connection() as conn, domain_errors(conn):
        row = alert_service.confirm(conn, alert_id, user.id, body.reason if body else None)
        conn.commit()
    return _alert_view(row)


@router.post("/alerts/{alert_id}/dismiss", response_model=AlertState)
def dismiss_alert(alert_id: str, body: AlertDismiss, user: User = Depends(require_approver)) -> dict:
    """AlertDismissed with a reason. false_positive marks a wrong alert (telemetry: rate for each tier rule)."""
    with connection() as conn, domain_errors(conn):
        row = alert_service.dismiss(conn, alert_id, user.id, body.reason, body.false_positive)
        conn.commit()
    return _alert_view(row)


@router.get("/telemetry/alerts", response_model=Telemetry)
def alert_telemetry(limit: int = Query(1000, ge=1, le=5000), user: User = Depends(require_viewer)) -> dict:
    """For each alert: the published, fetched and raised timestamps, the delivery time for each channel, the
    acknowledgement time and user, and the outcome with the tier rule. Metrics: latency from fetch to alert
    (median, p90), time to acknowledgement (median, p90) and the false positive rate for each tier rule."""
    with connection() as conn:
        return alert_service.telemetry(conn, limit=limit)


# ---------- personal data ----------


class Erasure(BaseModel):
    reason: str = Field(min_length=1, max_length=2000, pattern=r"\S")


@router.get("/persons/{person_id}")
def get_person(person_id: str, user: User = Depends(require_viewer)) -> dict:
    """A person entity with its business contact data. After erasure the personal fields are empty."""
    with connection() as conn, domain_errors(conn):
        if not personal.is_person(conn, person_id):
            raise HTTPException(404, "person not found")
        first = conn.execute(
            "SELECT payload FROM event WHERE stream_type = 'entity' AND stream_id = %s AND event_type = 'EntityIdentified' "
            "ORDER BY sequence LIMIT 1", (person_id,),
        ).fetchone()
        payload = first["payload"] if first else {}
        contacts = conn.execute(
            "SELECT event_id, deal_id, data, recorded_at FROM proj_engagement WHERE kind = 'contact' "
            "AND data->>'contact_id' = %s ORDER BY recorded_at", (person_id,),
        ).fetchall()
        view = personal.reader_view(conn, person_id, payload.get("personal"))
    return {
        "id": person_id, **view, "role": payload.get("role"), "organisation_id": payload.get("organisation_id"),
        "found_via": payload.get("found_via"),
        "contacts": [{"event_id": c["event_id"], "deal_id": c["deal_id"], "role": c["data"].get("role"),
                      "recorded_at": _jsonable(c["recorded_at"])} for c in contacts],
    }


@router.post("/persons/{person_id}/erase")
def erase_person(person_id: str, body: Erasure, user: User = Depends(require_admin)) -> dict:
    """Delete the key of the person. The history stays intact. The personal fields become unreadable."""
    with connection() as conn, domain_errors(conn):
        result = personal.erase(conn, person_id, user_id=user.id, reason=body.reason)
        conn.commit()
    return result
