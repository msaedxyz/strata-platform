"""Helpers for the M6 tests: projects, facts and relationships written through the governance service."""

from __future__ import annotations

from datetime import UTC, datetime

from services.common.ids import new_id
from services.governance.proposals import approve, create_proposal

from .helpers import make_evidence, make_source

AGENT = {"created_by_type": "agent", "created_by": "test.lifecycle", "model_id": "test-model", "prompt_version": "test/v1"}


def evidence(conn, text: str, quote: str | None = None) -> str:
    src = make_source(conn, text, title=text[:80])
    return make_evidence(conn, src, text, quote or text)


def today() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


def new_project(conn, name: str, stage: str | None, *, occurred_at: datetime | None = None, site_id: str | None = None,
                certainty: str = "stated") -> dict:
    """A new project with its stage. The proposal is automatic (stated, confidence 0.99), so the follow-up steps run:
    the forecast, the opportunity proposal and the demand estimate."""
    text = f"{name} reached the stage {stage or 'unknown'} according to the developer."
    ev = evidence(conn, text)
    pid = new_id()
    when = occurred_at or today()
    events = [{"stream_type": "project", "stream_id": pid, "event_type": "EntityIdentified",
               "payload": {"entity_type": "project", "name": name, "site_id": site_id, "new_entity": True,
                           "resolution_confidence": 0.99},
               "evidence_ids": [ev], "certainty": "stated", "occurred_at": when}]
    if stage:
        events.append({"stream_type": "project", "stream_id": pid, "event_type": "ProjectStageChanged",
                       "payload": {"from_stage": None, "to_stage": stage, "name": name, "site_id": site_id},
                       "evidence_ids": [ev], "certainty": certainty, "occurred_at": when})
    row, _ = create_proposal(conn, kind="EntityIdentified", title=f"New project: {name}", events=events, **AGENT)
    return {"id": pid, "evidence_id": ev, "proposal": row}


def change_stage(conn, project_id: str, name: str, to_stage: str, *, occurred_at: datetime | None = None) -> dict:
    text = f"{name} moved to the stage {to_stage}."
    ev = evidence(conn, text)
    row, _ = create_proposal(
        conn, kind="ProjectStageChanged", title=f"{name}: {to_stage}",
        events=[{"stream_type": "project", "stream_id": project_id, "event_type": "ProjectStageChanged",
                 "payload": {"to_stage": to_stage, "name": name}, "evidence_ids": [ev], "certainty": "stated",
                 "occurred_at": occurred_at or today()}], **AGENT)
    return {"proposal": row, "evidence_id": ev}


def assert_fact(conn, stream_type: str, stream_id: str, predicate: str, value, text: str, quote: str) -> str:
    """A stated fact: the policy is automatic, so the follow-up steps run. Returns the evidence id."""
    ev = evidence(conn, text, quote)
    create_proposal(conn, kind="EntityAttributeAsserted", title=f"{predicate} {value}",
                    events=[{"stream_type": stream_type, "stream_id": stream_id, "event_type": "EntityAttributeAsserted",
                             "payload": {"predicate": predicate, "value": value, "value_text": quote},
                             "evidence_ids": [ev], "certainty": "stated"}], **AGENT)
    return ev


def relationship(conn, subject_id: str, predicate: str, object_id: str, stream: tuple[str, str], text: str) -> str:
    """A reviewed relationship, approved by an approver."""
    ev = evidence(conn, text)
    row, _ = create_proposal(conn, kind="RelationshipAsserted", title=f"{subject_id} {predicate} {object_id}",
                             events=[{"stream_type": stream[0], "stream_id": stream[1], "event_type": "RelationshipAsserted",
                                      "payload": {"subject_id": subject_id, "predicate": predicate, "object_id": object_id},
                                      "evidence_ids": [ev], "certainty": "stated"}], **AGENT)
    approve(conn, row["id"], "u-approver")
    return ev


def pending(conn, kind: str, **payload_match) -> list[dict]:
    rows = conn.execute("SELECT * FROM proposal WHERE kind = %s AND status = 'pending' ORDER BY created_at, id",
                        (kind,)).fetchall()
    out = []
    for r in rows:
        payload = r["events"][0]["payload"]
        if all(payload.get(k) == v for k, v in payload_match.items()):
            out.append(r)
    return out


def approve_opportunity(conn, project_id: str) -> str:
    """Approve the diesel supply opportunity of a project. Returns the deal id."""
    [row] = pending(conn, "DealIdentified", project_id=project_id)
    approve(conn, row["id"], "u-approver")
    return row["events"][0]["stream_id"]
