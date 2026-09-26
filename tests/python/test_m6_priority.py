"""Priority list (docs/05 scorer rules 5 and 6), docs/09 scenario 17 (full) and the provenance fields of the read API
(docs/07 rule 1). The calculator is services/projections/priority.py, a projector hook."""

from __future__ import annotations

import pytest

from services.common import config
from services.governance.proposals import approve
from services.projections.projector import projection_hashes, rebuild

from .enrichment_support import org_id, site_id
from .m6_support import AGENT, approve_opportunity, assert_fact, evidence, new_project, pending, relationship

pytestmark = pytest.mark.db


def _priority(api, tokens) -> list[dict]:
    return api.get("/api/priority", params={"limit": 500}, headers=tokens("viewer")).json()["items"]


def _item(items: list[dict], deal_id: str) -> dict:
    return next(i for i in items if i["id"] == deal_id)


@pytest.fixture(scope="module")
def world(edb_setup):
    """Two projects in the engagement window, each with an approved diesel supply opportunity.

    Project A has no buyer role and no demand estimate. Project B has a mining contractor and an approved demand
    estimate, so its opportunity has the higher score before the "no contact found" rule."""
    from services.common.db import connect

    with connect(edb_setup["app_url"]) as conn:
        a = new_project(conn, "Priority Alpha Copper Project", "feasibility")
        b = new_project(conn, "Priority Beta Copper Project", "feasibility", site_id=site_id(conn, "kansanshi"))
        relationship(conn, b["id"], "buyer_role_mining_contractor", org_id(conn, "kcm"), ("project", b["id"]),
                     "Priority Beta Copper Project appointed a mining contractor for load and haul.")
        assert_fact(conn, "project", b["id"], "fleet_trucks", "30", "The fleet has 30 haul trucks.", "30 haul trucks")
        [est] = [r for r in pending(conn, "DemandEstimated") if r["stream_id"] == b["id"]]
        approve(conn, est["id"], "u-approver")
        deal_a = approve_opportunity(conn, a["id"])
        deal_b = approve_opportunity(conn, b["id"])
        conn.commit()
    return {"a": a, "b": b, "deal_a": deal_a, "deal_b": deal_b}


def test_breakdown_has_each_part_with_value_weight_contribution_and_evidence(api, tokens, world):
    item = _item(_priority(api, tokens), world["deal_b"])
    b = item["priority_breakdown"]
    weights = config.priority()["weights"]
    assert b["parts"] == ["lead_time", "demand", "confidence", "buyer_fit", "no_contact_boost"]
    for part in ("lead_time", "demand", "confidence", "buyer_fit"):
        p = b[part]
        assert p["weight"] == weights[part]
        assert p["contribution"] == pytest.approx(p["score"] * p["weight"], abs=1e-6)
        assert "event_ids" in p and "evidence_ids" in p
    assert b["weighted_score"] == pytest.approx(sum(b[p]["contribution"] for p in weights), abs=1e-6)
    assert item["priority_score"] == pytest.approx(b["total"])
    # Each input has its provenance (docs/07 rule 1).
    assert b["lead_time"]["event_ids"] and b["lead_time"]["evidence_ids"] == [world["b"]["evidence_id"]]
    assert b["lead_time"]["forecast_start"] and item["lead_time_days"] == b["lead_time"]["value"]
    assert b["demand"]["value"] == 30 * 90 * 500 and item["demand_litres_month"] == 30 * 90 * 500
    assert b["demand"]["label"] == "estimate" and b["demand"]["inputs"]["trucks"]["evidence_ids"]
    assert len(b["demand"]["event_ids"]) == 2  # the DemandEstimated event and the fact event of the input
    assert b["confidence"]["value"] == "stated" and item["confidence"] == 1.0 and b["confidence"]["evidence_ids"]
    assert b["buyer_fit"]["value"] == "buyer_role_mining_contractor" and item["buyer_fit"] == 1.0
    assert b["buyer_fit"]["event_ids"] and b["buyer_fit"]["evidence_ids"]
    assert b["group"]["id"] == "early" and item["priority_group"] == "early" and item["group_rank"] >= 1
    a = _item(_priority(api, tokens), world["deal_a"])["priority_breakdown"]
    assert a["demand"]["value"] is None and a["demand"]["score"] == config.priority()["demand"]["unknown_score"]
    assert a["buyer_fit"]["value"] == "unknown"


def test_scenario_17_touchpoint_and_next_action_show_and_the_no_contact_rank_goes_down(api, tokens, world, edb):
    """docs/09 scenario 17 (full): an analyst logs a touchpoint with a contact and a next action for an
    opportunity. The relationship panel shows both. The priority list lowers the rank that the rule
    "project in the engagement window with no contact found" gave."""
    deal_a, deal_b = world["deal_a"], world["deal_b"]
    # Deal B has a contact, so the rule does not apply to it.
    api.post(f"/api/deals/{deal_b}/contacts", headers=tokens("analyst"),
             json={"name": "Beta Contact", "role": "Fleet manager", "organisation_id": org_id(edb, "kcm"),
                   "email": "beta.contact@kcm.example", "found_via": "Site visit"})
    items = _priority(api, tokens)
    a, b = _item(items, deal_a), _item(items, deal_b)
    assert a["priority_breakdown"]["no_contact_boost"]["applied"] is True and a["no_contact_rule"] is True
    assert b["priority_breakdown"]["no_contact_boost"]["applied"] is False
    assert a["priority_breakdown"]["weighted_score"] < b["priority_breakdown"]["weighted_score"]
    assert a["priority_group"] == b["priority_group"] and a["group_rank"] == 1 and a["rank"] < b["rank"]
    rule = a["priority_breakdown"]["no_contact_boost"]
    assert rule["in_engagement_window"] is True and rule["evidence_ids"] == [world["a"]["evidence_id"]]
    # The analyst adds a contact, logs a touchpoint with the contact and sets the next action.
    contact = api.post(f"/api/deals/{deal_a}/contacts", headers=tokens("analyst"),
                       json={"name": "Alpha Contact", "role": "Procurement lead", "organisation_id": org_id(edb, "kcm"),
                             "email": "alpha.contact@kcm.example", "found_via": "Industry event"}).json()["contact_id"]
    r1 = api.post(f"/api/deals/{deal_a}/touchpoints", headers=tokens("analyst"),
                  json={"kind": "meeting", "date": "2026-09-24", "note": "Met the procurement lead", "contact_id": contact})
    r2 = api.post(f"/api/deals/{deal_a}/next-action", headers=tokens("analyst"),
                  json={"action": "Send the supplier profile", "owner_user_id": "u-analyst", "due_date": "2026-10-08"})
    assert r1.status_code == r2.status_code == 200
    rel = api.get(f"/api/deals/{deal_a}/relationship", headers=tokens("viewer")).json()
    assert [t["data"]["note"] for t in rel["touchpoints"]] == ["Met the procurement lead"]
    assert rel["touchpoints"][0]["data"]["contact_id"] == contact
    assert rel["next_action"]["data"]["action"] == "Send the supplier profile"
    assert rel["contacts"] and rel["contacts"][0]["data"]["name"] == "Alpha Contact"
    items = _priority(api, tokens)
    a2, b2 = _item(items, deal_a), _item(items, deal_b)
    assert a2["priority_breakdown"]["no_contact_boost"]["applied"] is False and a2["no_contact_rule"] is False
    assert a2["priority_breakdown"]["no_contact_boost"]["contact_found"] is True
    assert a2["priority_score"] < a["priority_score"]
    assert a2["rank"] > b2["rank"] and a2["group_rank"] > a["group_rank"]
    assert a2["has_contact"] is True


def test_rule_6_needs_the_engagement_window(api, tokens, edb):
    early = new_project(edb, "Exploration Stage Rule Project", "exploration")
    deal = approve_opportunity(edb, early["id"])
    edb.commit()
    item = _item(_priority(api, tokens), deal)
    rule = item["priority_breakdown"]["no_contact_boost"]
    assert rule["in_engagement_window"] is False and rule["applied"] is False
    assert item["priority_score"] == pytest.approx(item["priority_breakdown"]["weighted_score"])


def test_a_stage_move_changes_the_group_after_approval(api, tokens, edb):
    project = new_project(edb, "Stage Group Move Project", "feasibility")
    deal = approve_opportunity(edb, project["id"])
    edb.commit()
    pid = api.post(f"/api/deals/{deal}/stage", headers=tokens("analyst"), json={"to_stage": "relationship_active"}).json()
    assert pid["status"] == "pending"
    assert _item(_priority(api, tokens), deal)["priority_group"] == "early"
    assert api.post(f"/api/proposals/{pid['proposal_id']}/approve", headers=tokens("approver")).status_code == 200
    item = _item(_priority(api, tokens), deal)
    assert item["priority_group"] == "engaged" and item["stage"] == "relationship_active"
    assert item["stage_event_id"] and item["priority_breakdown"]["group"]["order"] == 2


def test_rebuild_gives_the_same_projection_hashes_with_priority_values(world, edb):
    """docs/03 criterion 4 with the priority calculator: the derived columns come back the same after a replay."""
    assert edb.execute("SELECT count(*) AS n FROM proj_deal WHERE priority_breakdown IS NOT NULL").fetchone()["n"] >= 2
    before = projection_hashes(edb)
    rows_before = edb.execute("SELECT id, priority_score, priority_breakdown FROM proj_deal ORDER BY id").fetchall()
    rebuild(edb)
    edb.commit()
    assert projection_hashes(edb) == before
    assert edb.execute("SELECT id, priority_score, priority_breakdown FROM proj_deal ORDER BY id").fetchall() == rows_before


# ---------- provenance fields of the read API (docs/07 rule 1) ----------


def test_sites_give_status_identity_operator_and_last_signal_evidence(api, tokens, edb):
    from services.governance.proposals import create_proposal

    site = site_id(edb, "kansanshi")
    text = "Kansanshi mine operations were suspended after a flood."
    ev = evidence(edb, text)
    row, _ = create_proposal(edb, kind="SiteStatusChanged", title="status", events=[
        {"stream_type": "entity", "stream_id": site, "event_type": "SiteStatusChanged",
         "payload": {"from_status": None, "to_status": "suspended"}, "evidence_ids": [ev], "certainty": "stated"}], **AGENT)
    approve(edb, row["id"], "u-approver")
    edb.commit()
    s = next(x for x in api.get("/api/sites", headers=tokens("viewer")).json()["items"] if x["id"] == site)
    assert s["status"] == "suspended" and s["status_evidence_ids"] == [ev] and s["status_event_id"]
    assert s["status_certainty"] == "stated"
    status_event = edb.execute("SELECT id FROM event WHERE stream_id = %s AND event_type = 'SiteStatusChanged' "
                               "ORDER BY sequence DESC LIMIT 1", (site,)).fetchone()
    assert s["status_event_id"] == status_event["id"]
    for field in ("identity_evidence_ids", "operator_evidence_ids", "last_signal_evidence_ids"):
        assert isinstance(s[field], list), field
    detail = api.get(f"/api/entities/{site}", headers=tokens("viewer")).json()["entity"]
    assert detail["status_evidence_ids"] == [ev]


def test_map_items_give_site_status_and_deal_evidence(api, tokens, world, edb):
    body = api.get("/api/map", headers=tokens("viewer")).json()
    for s in body["sites"]:
        assert {"identity_evidence_ids", "status_evidence_ids", "status_event_id", "geometry_source"} <= set(s)
    deal = next(d for d in body["deals"] if d["id"] == world["deal_b"])
    assert deal["evidence_ids"] and deal["stage_event_id"] and "stage_evidence_ids" in deal
    project = next(p for p in body["projects"] if p["id"] == world["b"]["id"])
    assert project["stage_evidence_ids"] and project["stage_event_id"] and project["forecast_evidence_ids"]


def test_deals_give_the_stage_event_evidence_and_reason(api, tokens, world, edb):
    project = new_project(edb, "Stage Reason Project", "feasibility")
    deal = approve_opportunity(edb, project["id"])
    edb.commit()
    pid = api.post(f"/api/deals/{deal}/stage", headers=tokens("analyst"), json={"to_stage": "qualified"}).json()
    api.post(f"/api/proposals/{pid['proposal_id']}/approve", headers=tokens("approver"))
    deals = api.get("/api/deals", headers=tokens("viewer")).json()["items"]
    moved = next(d for d in deals if d["id"] == deal)
    assert moved["stage_event_id"] and moved["stage_actor_type"] == "human" and moved["stage_reason"]
    fresh = next(d for d in deals if d["id"] == world["deal_a"])
    assert fresh["stage_evidence_ids"] == fresh["evidence_ids"] and fresh["certainty"] == "stated"
