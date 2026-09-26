"""docs/09-acceptance.md scenarios that belong to governance: 1, 4 (API part), 5, 6, 10 and 17 (API part).

Each test runs on a module database with brief v1 active and the deterministic backend. M7 runs the same
scenarios on the full stack in tests/e2e.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta

import pytest
import yaml

from services.common.ids import new_id
from services.governance.event_store import append_event

from .collector_support import run_fixture
from .governance_support import SSEReader, make_deal, org_id

pytestmark = pytest.mark.db


def test_scenario_01_new_brief_version_collectors_and_a_tier0_alert_confirmed_with_telemetry(
        api, tokens, auth, edb, fixture_server, fake_clock, smtp_stub, live_server):
    """An admin activates a new brief version. The collectors run on the fixture server. A fixture article
    describes a sale process at a watched entity (KCM, Nchanga mine). A Tier 0 alert appears as unconfirmed
    within 15 minutes of the collector run. An approver confirms it. Telemetry shows every timestamp."""
    from services.enrichment.backends import DeterministicBackend
    from services.enrichment.pipeline import enrich
    from tests.fixtures.server import fixture_brief_text

    # 1. The admin activates a new brief version with one more source.
    content = yaml.safe_load(fixture_brief_text(fixture_server.base_url))
    content["sources"]["news"].append({
        "id": "fx_rss_deals", "name": "Copperbelt Deals Wire (fixture)", "type": "rss",
        "url": f"{fixture_server.base_url}/feeds/deals.xml", "schedule": "daily", "licence_code": "verify_then_purge",
        "rate_limit_seconds": 0.2})
    r = api.post("/api/briefs", headers=tokens("admin"),
                 json={"yaml": yaml.safe_dump(content, sort_keys=False), "change_note": "Add the deals wire",
                       "activate": True})
    assert r.status_code == 201, r.text
    version = r.json()["version"]
    assert api.get("/api/briefs", headers=tokens("viewer")).json()["active_version"] == version
    # 2. The collectors run. A viewer has the live stream open.
    reader = SSEReader(live_server.url, auth("viewer", sub="u-viewer-s1")).start()
    try:
        results, _client = run_fixture(edb, fixture_server, fake_clock)
        assert {x.brief_source_id: x.status for x in results}["fx_rss_deals"] == "success"
        run = edb.execute("SELECT * FROM collector_run WHERE brief_source_id = 'fx_rss_deals' ORDER BY started_at DESC "
                          "LIMIT 1").fetchone()
        source = edb.execute("SELECT s.* FROM source s JOIN source_url u ON u.source_id = s.id WHERE u.url LIKE %s",
                             ("%kcm-sale-process-nchanga-diesel%",)).fetchone()
        assert source is not None and source["brief_version_id"] == r.json()["id"]
        # 3. Enrichment raises the Tier 0 alert at once, with no approval.
        result = enrich(edb, source["id"], backend=DeterministicBackend())
        assert result["tier"] == 0 and result["tier_rule"] == "t0_open_procurement_notice", result
        message = reader.wait_for(lambda m: m["event"] == "AlertRaised" and m["data"]["alert"]["source_id"] == source["id"])
    finally:
        reader.stop()
    alert_id = message["data"]["stream_id"]
    assert message["data"]["alert_status"] == "unconfirmed"
    alert = next(a for a in api.get("/api/alerts", headers=tokens("viewer")).json()["items"] if a["id"] == alert_id)
    assert alert["status"] == "unconfirmed"
    raised = datetime.fromisoformat(alert["raised_at"])
    assert raised - run["finished_at"] < timedelta(minutes=15)
    deal_proposals = edb.execute("SELECT status FROM proposal WHERE source_id = %s AND kind = 'DealIdentified'",
                                 (source["id"],)).fetchall()
    assert deal_proposals and {p["status"] for p in deal_proposals} == {"pending"}
    # 4. An analyst acknowledges and an approver confirms the alert.
    assert api.post(f"/api/alerts/{alert_id}/acknowledge", headers=tokens("analyst")).status_code == 200
    r = api.post(f"/api/alerts/{alert_id}/confirm", headers=tokens("approver"), json={"reason": "Notice is real"})
    assert r.status_code == 200 and r.json()["status"] == "confirmed"
    # 5. Telemetry shows every timestamp.
    deadline = time.time() + 10
    item = None
    while time.time() < deadline:
        items = api.get("/api/telemetry/alerts", headers=tokens("viewer")).json()["items"]
        item = next(i for i in items if i["id"] == alert_id)
        if item["delivered"]["frontend"]:
            break
        time.sleep(0.1)
    for field in ("published_at", "fetched_at", "raised_at", "acknowledged_at", "acknowledged_by", "decided_at",
                  "decided_by", "outcome", "tier_rule", "latency_fetch_to_alert_seconds",
                  "time_to_acknowledgement_seconds"):
        assert item[field] is not None, field
    assert item["delivered"]["frontend"] and item["delivered"]["email"], item["delivered"]
    assert item["outcome"] == "confirmed" and item["tier_rule"] == "t0_open_procurement_notice"
    assert any("sale process" in m.lower() or "Tier 0" in m for m in smtp_stub.messages)
    edb.commit()


def test_scenario_04_a_stage_move_waits_for_approval_and_the_timeline_and_as_of_view_show_it(api, tokens, edb):
    """An analyst moves a Kanban card. The card shows the pending stage. An approver approves. The timeline shows
    the event with its reason. The "as of" view before the approval shows the old stage."""
    deal = make_deal(edb, title="Scenario 4 haulage contract")
    time.sleep(0.05)
    before = datetime.now(UTC)
    time.sleep(0.05)
    r = api.post(f"/api/deals/{deal['id']}/stage", headers=tokens("analyst"), json={"to_stage": "qualified"})
    assert r.status_code == 200 and r.json()["status"] == "pending" and r.json()["stage_pending"] == "qualified"
    card = next(d for d in api.get("/api/deals", headers=tokens("viewer")).json()["items"] if d["id"] == deal["id"])
    assert card["stage"] == "signal" and card["stage_pending"] == "qualified" and card["pending_proposal_id"]
    queue = api.get("/api/proposals", params={"status": "pending", "kind": "DealStageChanged"},
                    headers=tokens("viewer")).json()["items"]
    proposal = next(p for p in queue if p["id"] == card["pending_proposal_id"])
    assert proposal["created_by"] == "u-analyst"
    # A second move while one waits is refused.
    assert api.post(f"/api/deals/{deal['id']}/stage", headers=tokens("analyst"),
                    json={"to_stage": "contact_found"}).status_code == 409
    r = api.post(f"/api/proposals/{proposal['id']}/approve", headers=tokens("approver"))
    assert r.status_code == 200
    card = next(d for d in api.get("/api/deals", headers=tokens("viewer")).json()["items"] if d["id"] == deal["id"])
    assert card["stage"] == "qualified" and card["stage_pending"] is None
    timeline = api.get("/api/timeline", params={"stream_type": "deal", "stream_id": deal["id"]},
                       headers=tokens("viewer")).json()
    change = next(i for i in timeline["items"] if i["event_type"] == "DealStageChanged")
    assert change["payload"]["to_stage"] == "qualified" and change["payload"]["from_stage"] == "signal"
    assert change["payload"]["reason"] and change["actor_type"] == "human" and change["proposal_id"] == proposal["id"]
    assert timeline["items"][0]["evidence_ids"] == [deal["evidence_id"]]
    old = api.get(f"/api/deals/{deal['id']}", params={"as_of": before.isoformat()}, headers=tokens("viewer")).json()
    assert old["deal"]["stage"] == "signal"
    old_timeline = api.get("/api/timeline", params={"stream_type": "deal", "stream_id": deal["id"],
                                                    "as_of": before.isoformat()}, headers=tokens("viewer")).json()
    assert [i["event_type"] for i in old_timeline["items"]] == ["DealIdentified"]
    assert api.get(f"/api/deals/{deal['id']}", headers=tokens("viewer")).json()["deal"]["stage"] == "qualified"


def test_scenario_05_a_viewer_calls_the_approve_endpoint(api, tokens, edb):
    deal = make_deal(edb, title="Scenario 5 deal")
    r = api.post(f"/api/deals/{deal['id']}/stage", headers=tokens("analyst"), json={"to_stage": "qualified"})
    pid = r.json()["proposal_id"]
    assert api.post(f"/api/proposals/{pid}/approve", headers=tokens("viewer")).status_code == 403
    assert api.post(f"/api/deals/{deal['id']}/stage", headers=tokens("viewer"), json={"to_stage": "lost"}).status_code == 403
    assert edb.execute("SELECT status FROM proposal WHERE id = %s", (pid,)).fetchone()["status"] == "pending"


def test_scenario_06_the_creator_of_a_proposal_cannot_approve_it(api, tokens, edb):
    deal = make_deal(edb, title="Scenario 6 deal")
    # An analyst creates the proposal and tries to approve it.
    pid = api.post(f"/api/deals/{deal['id']}/stage", headers=tokens("analyst"),
                   json={"to_stage": "qualified"}).json()["proposal_id"]
    assert api.post(f"/api/proposals/{pid}/approve", headers=tokens("analyst")).status_code == 403
    api.post(f"/api/proposals/{pid}/reject", headers=tokens("approver"), json={"reason": "Not yet qualified"})
    # An approver has the analyst permissions too: the approver moves a card and cannot approve the own proposal.
    pid = api.post(f"/api/deals/{deal['id']}/stage", headers=tokens("approver"),
                   json={"to_stage": "qualified"}).json()["proposal_id"]
    r = api.post(f"/api/proposals/{pid}/approve", headers=tokens("approver"))
    assert r.status_code == 403
    assert edb.execute("SELECT status FROM proposal WHERE id = %s", (pid,)).fetchone()["status"] == "pending"
    assert api.post(f"/api/proposals/{pid}/approve", headers=tokens("approver2")).status_code == 200


def test_scenario_10_an_admin_erases_a_person(api, tokens, edb):
    deal = make_deal(edb, title="Scenario 10 deal")
    body = {"name": "Mutale Scenario Ten", "role": "Fleet manager", "organisation_id": org_id(edb, "kcm"),
            "email": "mutale.ten@kcm.example", "phone": "+260 966 101010", "found_via": "Site visit"}
    person = api.post(f"/api/deals/{deal['id']}/contacts", headers=tokens("analyst"), json=body).json()["contact_id"]
    api.post(f"/api/deals/{deal['id']}/touchpoints", headers=tokens("analyst"),
             json={"kind": "site_visit", "date": "2026-09-20", "note": "Met the fleet manager", "contact_id": person})
    assert api.get(f"/api/persons/{person}", headers=tokens("viewer")).json()["email"] == body["email"]
    r = api.post(f"/api/persons/{person}/erase", headers=tokens("admin"), json={"reason": "Erasure request"})
    assert r.status_code == 200
    person_view = api.get(f"/api/persons/{person}", headers=tokens("viewer")).json()
    relationship = api.get(f"/api/deals/{deal['id']}/relationship", headers=tokens("viewer")).json()
    text = repr(person_view) + repr(relationship)
    for value in (body["name"], body["email"], body["phone"], "Mutale"):
        assert value not in text
    assert person_view["erased"] is True
    assert edb.execute("SELECT count(*) AS n FROM check_hash_chain()").fetchone()["n"] == 0


def test_scenario_17_touchpoint_and_next_action_show_in_the_relationship_panel(api, tokens, edb):
    deal = make_deal(edb, title="Scenario 17 deal")
    r1 = api.post(f"/api/deals/{deal['id']}/touchpoints", headers=tokens("analyst"),
                  json={"kind": "meeting", "date": "2026-09-22", "note": "Met the procurement team in Chingola"})
    r2 = api.post(f"/api/deals/{deal['id']}/next-action", headers=tokens("analyst"),
                  json={"action": "Send the prequalification pack", "owner_user_id": "u-analyst", "due_date": "2026-10-05"})
    assert r1.status_code == r2.status_code == 200
    rel = api.get(f"/api/deals/{deal['id']}/relationship", headers=tokens("viewer")).json()
    assert [t["data"]["note"] for t in rel["touchpoints"]] == ["Met the procurement team in Chingola"]
    assert rel["touchpoints"][0]["actor_id"] == "u-analyst"
    assert rel["next_action"]["data"]["action"] == "Send the prequalification pack"
    assert rel["next_action"]["data"]["due_date"] == "2026-10-05"


def test_scenarios_leave_the_hash_chain_and_the_evidence_check_clean(edb):
    append_event(edb, stream_type="deal", stream_id=new_id(), event_type="NextActionSet",
                 payload={"action": "check", "owner_user_id": "u", "due_date": "2026-10-01"},
                 actor_type="human", actor_id="u-analyst")
    edb.commit()
    assert edb.execute("SELECT count(*) AS n FROM check_hash_chain()").fetchone()["n"] == 0
    assert edb.execute("SELECT count_facts_without_verified_evidence() AS n").fetchone()["n"] == 0
