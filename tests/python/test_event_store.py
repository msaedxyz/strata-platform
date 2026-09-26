"""docs/03-data-model.md criteria 1, 2, 3, 7 and 8, and docs/09 scenario 7."""

from __future__ import annotations

import psycopg
import pytest

from services.common.ids import new_id
from services.governance.event_store import EventValidationError, append_event

from .helpers import make_evidence, make_source

pytestmark = pytest.mark.db


def _event(conn, **kw):
    base = dict(stream_type="entity", stream_id=new_id(), event_type="EntityIdentified",
                payload={"entity_type": "organisation", "name": "Test Mining Ltd"}, actor_type="system",
                actor_id="test")
    base.update(kw)
    return append_event(conn, **base)


def _seed(conn):
    text = "First Quantum Minerals operates the Kansanshi mine in Solwezi."
    src = make_source(conn, text)
    ev = make_evidence(conn, src, text, "First Quantum Minerals operates the Kansanshi mine")
    row = _event(conn, evidence_ids=[ev])
    conn.commit()
    return row


@pytest.mark.parametrize("statement", [
    "UPDATE event SET payload = '{}'::jsonb",
    "DELETE FROM event",
    "TRUNCATE event",
])
@pytest.mark.parametrize("role", ["app", "owner", "admin"])
def test_event_table_rejects_change_for_every_role(database, db, statement, role):
    """Criterion 03-1 and scenario 7: UPDATE, DELETE and TRUNCATE fail for every role."""
    _seed(db)
    url = {"app": database["app_url"], "owner": database["owner_url"], "admin": database["admin_url"]}[role]
    with psycopg.connect(url) as conn:
        conn.execute("SET search_path = strata, public")
        with pytest.raises(psycopg.Error):
            conn.execute(statement)


def test_fact_without_evidence_is_rejected_by_database(db):
    """Criterion 03-2: an insert of a fact event with no evidence fails."""
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute(
            "INSERT INTO event (id, stream_type, stream_id, sequence, event_type, payload, actor_type, actor_id, hash) "
            "VALUES (%s, 'entity', %s, 0, 'EntityAttributeAsserted', '{\"predicate\":\"x\",\"value\":1}', 'system', 't', '')",
            (new_id(), new_id()),
        )


def test_fact_with_unverified_evidence_is_rejected(db):
    text = "Barrick said Lumwana will expand."
    src = make_source(db, text)
    ev = make_evidence(db, src, text, "Lumwana will expand", verified=False)
    with pytest.raises(psycopg.errors.CheckViolation):
        _event(db, evidence_ids=[ev])


def test_hash_chain_has_no_breaks(db):
    """Criterion 03-3: the chain check reports zero breaks."""
    text = "Mopani Copper Mines awarded a raise boring contract."
    src = make_source(db, text)
    ev = make_evidence(db, src, text, "Mopani Copper Mines")
    stream = new_id()
    for i in range(3):
        _event(db, stream_id=stream, event_type="EntityAttributeAsserted",
               payload={"predicate": "employees", "value": i}, evidence_ids=[ev], certainty="stated")
    db.commit()
    rows = db.execute("SELECT sequence, prev_hash, hash FROM event WHERE stream_id = %s ORDER BY sequence", (stream,)).fetchall()
    assert [r["sequence"] for r in rows] == [1, 2, 3]
    assert rows[1]["prev_hash"] == rows[0]["hash"] and rows[2]["prev_hash"] == rows[1]["hash"]
    assert db.execute("SELECT count(*) AS n FROM check_hash_chain()").fetchone()["n"] == 0


def test_engagement_event_with_agent_actor_fails(db):
    """Criterion 03-7."""
    with pytest.raises(psycopg.errors.CheckViolation):
        _event(db, stream_type="deal", event_type="TouchpointLogged",
               payload={"kind": "call", "date": "2026-09-01", "note": "x"}, actor_type="agent",
               actor_id="extractor", model_id="m", prompt_version="v1")


def test_demand_estimate_without_input_evidence_fails(db):
    """Criterion 03-8."""
    text = "The mine runs 40 haul trucks."
    src = make_source(db, text)
    ev = make_evidence(db, src, text, "40 haul trucks")
    payload = {"formula_id": "haul_fleet", "expression": "trucks * a * b", "value": 1.0, "unit": "litres_per_month",
               "label": "estimate", "inputs": {"trucks": {"value": 40, "evidence_ids": []}}}
    with pytest.raises((psycopg.errors.CheckViolation, EventValidationError)):
        _event(db, stream_type="project", event_type="DemandEstimated", payload=payload, evidence_ids=[ev])
    db.rollback()
    # The same insert straight to the database also fails.
    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute(
            "INSERT INTO event (id, stream_type, stream_id, sequence, event_type, payload, evidence_ids, actor_type, actor_id, hash) "
            "VALUES (%s, 'project', %s, 0, 'DemandEstimated', %s, %s, 'system', 't', '')",
            (new_id(), new_id(), psycopg.types.json.Jsonb(payload), [ev]),
        )


def test_payload_schema_is_checked_before_insert(db):
    with pytest.raises(EventValidationError):
        _event(db, payload={"entity_type": "organisation"})
