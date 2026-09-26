"""The work of the team on an opportunity. Source: docs/03-data-model.md (relationships and engagement) and
docs/06-governance.md (approval policy, audit log, personal data).

Each function writes a proposal through services/governance/proposals.create_proposal with the user as the
creator (actor type human). The engagement events have the policy automatic in config/approval-policy.yaml,
so the governance service writes them at once. A deal stage move has the policy review: the Kanban card
shows the pending stage until an approver decides.
"""

from __future__ import annotations

import psycopg

from services.common import config

from . import personal
from .proposals import ProposalStateError, create_proposal


class EngagementError(ValueError):
    pass


def _deal(conn: psycopg.Connection, deal_id: str) -> dict:
    row = conn.execute("SELECT * FROM proj_deal WHERE id = %s", (deal_id,)).fetchone()
    if row is None:
        raise LookupError(f"no deal {deal_id}")
    return row


def _entity_of_type(conn: psycopg.Connection, entity_id: str | None, types: tuple[str, ...], field: str) -> None:
    if entity_id is None:
        return
    row = conn.execute("SELECT type FROM entity WHERE id = %s", (entity_id,)).fetchone()
    if row is None or row["type"] not in types:
        raise EngagementError(f"{field} {entity_id} is not a known {' or '.join(types)}")


def _human_event(conn: psycopg.Connection, user_id: str, deal: dict, events: list[dict], title: str) -> dict:
    row, _created = create_proposal(conn, kind=events[-1]["event_type"], title=title, events=events,
                                    created_by_type="human", created_by=user_id)
    written = conn.execute(
        "SELECT id, event_type, stream_type, stream_id FROM event WHERE proposal_id = %s AND stream_type <> 'proposal' "
        "ORDER BY recorded_at, id", (row["id"],),
    ).fetchall()
    last = next((w for w in reversed(written) if w["event_type"] == events[-1]["event_type"]), None)
    return {"status": "recorded" if row["status"] == "auto_approved" else row["status"], "proposal_id": row["id"],
            "event_type": events[-1]["event_type"], "event_id": last["id"] if last else None, "deal_id": deal["id"]}


def move_deal_stage(conn: psycopg.Connection, deal_id: str, user_id: str, to_stage: str,
                    reason: str | None = None) -> dict:
    """An analyst moves a Kanban card: a DealStageChanged proposal (policy review). The caller commits."""
    deal = _deal(conn, deal_id)
    codes = config.stage_codes()
    if to_stage not in codes:
        raise EngagementError(f"unknown deal stage {to_stage}")
    if to_stage == deal["stage"]:
        raise EngagementError(f"the deal is already at stage {to_stage}")
    if deal["stage_pending"]:
        raise ProposalStateError(f"the deal has a pending stage change to {deal['stage_pending']}")
    names = {s["code"]: s["name"] for s in config.stages()}
    text = (reason or "").strip() or f"Moved from {names.get(deal['stage'], deal['stage'])} to {names[to_stage]} by an analyst"
    event = {"stream_type": "deal", "stream_id": deal_id, "event_type": "DealStageChanged",
             "payload": {"from_stage": deal["stage"], "to_stage": to_stage, "reason": text}, "evidence_ids": [],
             "certainty": None}
    row, _created = create_proposal(conn, kind="DealStageChanged", title=f"{deal['title']}: {names[to_stage]}",
                                    events=[event], created_by_type="human", created_by=user_id)
    return {"status": "pending" if row["status"] == "pending" else "approved", "proposal_id": row["id"],
            "deal_id": deal_id, "stage": deal["stage"], "stage_pending": to_stage if row["status"] == "pending" else None}


def add_contact(conn: psycopg.Connection, deal_id: str, user_id: str, *, name: str | None, role: str,
                organisation_id: str | None, email: str | None, phone: str | None, found_via: str,
                person_id: str | None = None) -> dict:
    """ContactAdded. A new person gets a person entity (EntityIdentified with encrypted fields only).

    The same business email (or name and organisation) gives the existing person. The caller commits.
    """
    deal = _deal(conn, deal_id)
    _entity_of_type(conn, organisation_id, ("organisation",), "organisation_id")
    fields = {"name": (name or "").strip() or None, "email": (email or "").strip() or None,
              "phone": (phone or "").strip() or None, "organisation_id": organisation_id}
    events: list[dict] = []
    if person_id:
        _entity_of_type(conn, person_id, ("person",), "person_id")
        if personal.is_erased(conn, person_id):
            raise EngagementError(f"person {person_id} is erased")
    else:
        if not fields["name"]:
            raise EngagementError("a new contact needs a name")
        person_id = personal.find_person(conn, fields)
    if person_id is None:
        person_id = personal.create_person(conn, fields)
        values = fields
        events.append({"stream_type": "entity", "stream_id": person_id, "event_type": "EntityIdentified",
                       "payload": {"entity_type": "person", "name": personal.policy()["placeholder_name"],
                                   "personal": personal.encrypt(conn, person_id, values), "role": role,
                                   "organisation_id": organisation_id, "found_via": found_via, "new_entity": True,
                                   "resolution_confidence": 1.0},
                       "evidence_ids": [], "certainty": None})
    else:
        values = _current_fields(conn, person_id, fields)
    blob = personal.encrypt(conn, person_id, values)
    events.append({"stream_type": "deal", "stream_id": deal_id, "event_type": "ContactAdded",
                   "payload": {"contact_id": person_id, "role": role, "organisation_id": organisation_id,
                               "found_via": found_via, "personal": blob},
                   "evidence_ids": [], "certainty": None})
    result = _human_event(conn, user_id, deal, events, f"Contact added to {deal['title']}")
    return {**result, "contact_id": person_id}


def _current_fields(conn: psycopg.Connection, person_id: str, given: dict) -> dict:
    """The fields of an existing person when the user gives only the person id: the last known values."""
    row = conn.execute(
        "SELECT payload FROM event WHERE stream_type = 'entity' AND stream_id = %s AND event_type = 'EntityIdentified' "
        "ORDER BY sequence LIMIT 1", (person_id,),
    ).fetchone()
    known = personal.decrypt(conn, person_id, (row or {}).get("payload", {}).get("personal")) or {}
    return {f: given.get(f) or known.get(f) for f in personal.encrypted_fields()}


def log_touchpoint(conn: psycopg.Connection, deal_id: str, user_id: str, *, kind: str, date: str, note: str,
                   contact_id: str | None = None) -> dict:
    deal = _deal(conn, deal_id)
    _entity_of_type(conn, contact_id, ("person",), "contact_id")
    event = {"stream_type": "deal", "stream_id": deal_id, "event_type": "TouchpointLogged",
             "payload": {"kind": kind, "date": date, "note": note, "contact_id": contact_id},
             "evidence_ids": [], "certainty": None}
    return _human_event(conn, user_id, deal, [event], f"Touchpoint ({kind}) for {deal['title']}")


def set_next_action(conn: psycopg.Connection, deal_id: str, user_id: str, *, action: str, owner_user_id: str,
                    due_date: str) -> dict:
    deal = _deal(conn, deal_id)
    event = {"stream_type": "deal", "stream_id": deal_id, "event_type": "NextActionSet",
             "payload": {"action": action, "owner_user_id": owner_user_id, "due_date": due_date},
             "evidence_ids": [], "certainty": None}
    return _human_event(conn, user_id, deal, [event], f"Next action for {deal['title']}")


def set_prequalification(conn: psycopg.Connection, deal_id: str, user_id: str, *, buyer_id: str, status: str) -> dict:
    deal = _deal(conn, deal_id)
    _entity_of_type(conn, buyer_id, ("organisation",), "buyer_id")
    event = {"stream_type": "deal", "stream_id": deal_id, "event_type": "PrequalificationStatusChanged",
             "payload": {"buyer_id": buyer_id, "status": status}, "evidence_ids": [], "certainty": None}
    return _human_event(conn, user_id, deal, [event], f"Prequalification {status} for {deal['title']}")
