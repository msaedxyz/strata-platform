"""docs/03-data-model.md criteria 4 to 6 with the event types of M3 and M4 in the store: proposals, alerts,
alert decisions, engagement events, person entities with encrypted fields, erasure and stage changes."""

from __future__ import annotations

import time
from datetime import UTC, datetime

import pytest

from services.projections.folds import fold_deal
from services.projections.projector import projection_hashes, rebuild

from .enrichment_support import enrich_text
from .governance_support import make_deal, org_id

pytestmark = pytest.mark.db


@pytest.fixture
def full_store(api, tokens, edb):
    """Enrichment output, a pending and an approved stage change, alerts with decisions and engagement work."""
    enrich_text(edb, "Regulator suspends operations at Konkola mine\n\nThe Mines Safety Department has suspended "
                     "underground operations at the Konkola mine of Konkola Copper Mines Plc after a flood.")
    enrich_text(edb, "Diesel shortage hits the Copperbelt\n\nFilling stations in Kitwe and Ndola ran out of diesel on "
                     "Monday.")
    edb.commit()
    for alert in api.get("/api/alerts", headers=tokens("viewer")).json()["items"][:2]:
        api.post(f"/api/alerts/{alert['id']}/acknowledge", headers=tokens("analyst"))
        api.post(f"/api/alerts/{alert['id']}/confirm", headers=tokens("approver"), json={"reason": "checked"})
    deal = make_deal(edb, title="Projection test deal")
    pending = make_deal(edb, title="Projection test deal with a pending stage")
    pid = api.post(f"/api/deals/{deal['id']}/stage", headers=tokens("analyst"),
                   json={"to_stage": "qualified"}).json()["proposal_id"]
    time.sleep(0.05)
    before = datetime.now(UTC)
    time.sleep(0.05)
    api.post(f"/api/proposals/{pid}/approve", headers=tokens("approver"))
    api.post(f"/api/deals/{pending['id']}/stage", headers=tokens("analyst"), json={"to_stage": "contact_found"})
    person = api.post(f"/api/deals/{deal['id']}/contacts", headers=tokens("analyst"),
                      json={"name": "Projection Person", "role": "Buyer", "organisation_id": org_id(edb, "kcm"),
                            "email": "projection.person@kcm.example", "found_via": "Phone call"}).json()["contact_id"]
    api.post(f"/api/deals/{deal['id']}/touchpoints", headers=tokens("analyst"),
             json={"kind": "email", "date": "2026-09-23", "note": "Sent the profile", "contact_id": person})
    api.post(f"/api/deals/{deal['id']}/next-action", headers=tokens("analyst"),
             json={"action": "Follow up", "owner_user_id": "u-analyst", "due_date": "2026-10-01"})
    api.post(f"/api/deals/{deal['id']}/prequalification", headers=tokens("analyst"),
             json={"buyer_id": org_id(edb, "kcm"), "status": "submitted"})
    api.post(f"/api/persons/{person}/erase", headers=tokens("admin"), json={"reason": "test"})
    return {"deal": deal, "pending": pending, "before": before}


def test_c03_04_rebuild_gives_the_same_hashes_with_governance_events(full_store, edb):
    kinds = {r["event_type"] for r in edb.execute("SELECT DISTINCT event_type FROM event").fetchall()}
    assert {"ProposalCreated", "ProposalApproved", "AlertRaised", "AlertAcknowledged", "AlertConfirmed",
            "DealStageChanged", "ContactAdded", "TouchpointLogged", "NextActionSet", "PrequalificationStatusChanged",
            "PersonErased", "SignalScored", "DemandDriverObserved"} <= kinds
    before = projection_hashes(edb)
    pending = edb.execute("SELECT stage_pending FROM proj_deal WHERE id = %s", (full_store["pending"]["id"],)).fetchone()
    assert pending["stage_pending"] == "contact_found"
    n = rebuild(edb)
    edb.commit()
    after = projection_hashes(edb)
    assert n > 0 and before == after
    assert edb.execute("SELECT count(*) AS n FROM check_hash_chain()").fetchone()["n"] == 0


def test_c03_05_as_of_gives_the_stage_before_and_after_an_approved_move(full_store, edb):
    from services.governance.event_store import stream_events

    deal = full_store["deal"]["id"]
    assert fold_deal(stream_events(edb, "deal", deal, as_of=full_store["before"]))["stage"] == "signal"
    assert fold_deal(stream_events(edb, "deal", deal))["stage"] == "qualified"
