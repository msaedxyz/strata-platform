"""docs/03-data-model.md criteria 4, 5 and 6, and docs/09 scenario 9."""

from __future__ import annotations

import time
from datetime import UTC, datetime

import pytest

from services.common.ids import new_id
from services.governance.event_store import append_event, stream_events
from services.projections.folds import fold_deal
from services.projections.projector import projection_hashes, rebuild

from .helpers import make_evidence, make_source

pytestmark = pytest.mark.db


def _deal_with_stage_change(db):
    text = "Lumwana Mining Company invited bids for a haulage contract."
    src = make_source(db, text)
    ev = make_evidence(db, src, text, "invited bids for a haulage contract")
    deal = new_id()
    append_event(db, stream_type="deal", stream_id=deal, event_type="DealIdentified",
                 payload={"title": "Lumwana haulage contract", "deal_type": "haulage_contract"},
                 evidence_ids=[ev], certainty="stated", actor_type="system", actor_id="test")
    db.commit()
    time.sleep(0.05)
    before_change = datetime.now(UTC)
    time.sleep(0.05)
    append_event(db, stream_type="deal", stream_id=deal, event_type="DealStageChanged",
                 payload={"from_stage": "signal", "to_stage": "qualified", "reason": "Approved by approver"},
                 actor_type="human", actor_id="approver-1")
    db.commit()
    return deal, before_change, ev


def test_rebuild_gives_same_projection_hashes(db):
    """Criterion 03-4 and scenario 9."""
    _deal_with_stage_change(db)
    before = projection_hashes(db)
    n = rebuild(db)
    db.commit()
    after = projection_hashes(db)
    assert n > 0
    assert before == after


def test_as_of_returns_stage_before_and_after_change(db):
    """Criterion 03-5."""
    deal, before_change, _ = _deal_with_stage_change(db)
    old = fold_deal(stream_events(db, "deal", deal, as_of=before_change))
    new = fold_deal(stream_events(db, "deal", deal, as_of=datetime.now(UTC)))
    assert old["stage"] == "signal"
    assert new["stage"] == "qualified"
    assert db.execute("SELECT stage FROM proj_deal WHERE id = %s", (deal,)).fetchone()["stage"] == "qualified"


def test_correction_supersedes_old_fact_and_keeps_history(db):
    """Criterion 03-6."""
    text = "The mine employs 1,200 people. A correction: the mine employs 1,450 people."
    src = make_source(db, text)
    ev1 = make_evidence(db, src, text, "employs 1,200 people")
    ev2 = make_evidence(db, src, text, "employs 1,450 people")
    site = new_id()
    append_event(db, stream_type="entity", stream_id=site, event_type="EntityIdentified",
                 payload={"entity_type": "site", "name": "Test Mine", "site_class": "mine"},
                 evidence_ids=[ev1], certainty="stated", actor_type="system", actor_id="test")
    old = append_event(db, stream_type="entity", stream_id=site, event_type="EntityAttributeAsserted",
                       payload={"predicate": "employees", "value": 1200}, evidence_ids=[ev1], certainty="stated",
                       actor_type="system", actor_id="test")
    new = append_event(db, stream_type="entity", stream_id=site, event_type="EntityAttributeAsserted",
                       payload={"predicate": "employees", "value": 1450}, evidence_ids=[ev2], certainty="stated",
                       actor_type="system", actor_id="test", supersedes_event_id=old["id"])
    db.commit()
    entity = db.execute("SELECT attributes FROM proj_entity WHERE id = %s", (site,)).fetchone()
    assert entity["attributes"]["employees"]["value"] == 1450
    facts = {r["event_id"]: r for r in db.execute("SELECT * FROM proj_fact WHERE stream_id = %s", (site,)).fetchall()}
    assert facts[old["id"]]["superseded_by"] == new["id"]
    assert facts[new["id"]]["superseded_by"] is None
    history = db.execute("SELECT count(*) AS n FROM event WHERE stream_id = %s", (site,)).fetchone()["n"]
    assert history == 3
