"""The write API of docs/api-contract.md and docs/06-governance.md criteria 1 and 2, and the audit log."""

from __future__ import annotations

import re

import pytest
from fastapi.routing import APIRoute

from services.common.ids import new_id
from services.governance import proposals as gp

from .governance_support import make_deal, org_id
from .helpers import make_evidence, make_source

pytestmark = pytest.mark.db

# Routes that change no data of the record. The session routes write the security log only (docs/06, audit
# log rule 2). Each role, a viewer too, must be able to log in and out.
NOT_DATA_WRITES = {("POST", "/api/session/login"), ("POST", "/api/session/logout")}

# The write endpoints of docs/api-contract.md. The walk below must find each of them.
CONTRACT_WRITES = {
    ("POST", "/api/proposals/{proposal_id}/approve"), ("POST", "/api/proposals/{proposal_id}/reject"),
    ("POST", "/api/proposals/{proposal_id}/edit-approve"), ("POST", "/api/deals/{deal_id}/stage"),
    ("POST", "/api/deals/{deal_id}/contacts"), ("POST", "/api/deals/{deal_id}/touchpoints"),
    ("POST", "/api/deals/{deal_id}/next-action"), ("POST", "/api/deals/{deal_id}/prequalification"),
    ("POST", "/api/alerts/{alert_id}/acknowledge"), ("POST", "/api/alerts/{alert_id}/confirm"),
    ("POST", "/api/alerts/{alert_id}/dismiss"), ("POST", "/api/persons/{person_id}/erase"),
    ("POST", "/api/sources/manual"), ("POST", "/api/briefs"), ("POST", "/api/briefs/{version}/activate"),
    ("POST", "/api/proposals/{proposal_id}/approve-source"),
}


def _write_routes() -> list[tuple[str, str]]:
    """Every non-GET route of the app, from the OpenAPI schema (it lists the routes of every included router)."""
    from services.api.main import app

    out = []
    for route in app.routes:
        if isinstance(route, APIRoute):
            for method in route.methods - {"GET", "HEAD", "OPTIONS"}:
                out.append((method, route.path))
    for path, operations in app.openapi()["paths"].items():
        for method in operations:
            if method.upper() not in ("GET", "HEAD", "OPTIONS"):
                out.append((method.upper(), path))
    return sorted(set(out) - NOT_DATA_WRITES)


WRITE_ROUTES = _write_routes()


def test_the_route_walk_finds_every_contract_write_endpoint():
    assert CONTRACT_WRITES <= set(WRITE_ROUTES), CONTRACT_WRITES - set(WRITE_ROUTES)


@pytest.mark.parametrize("method,path", WRITE_ROUTES, ids=[f"{m} {p}" for m, p in WRITE_ROUTES])
def test_c06_01_viewer_gets_403_on_each_write_endpoint(api, tokens, method, path):
    """Criterion 06-1 and scenario 5: a Viewer gets HTTP 403 on every write endpoint of the app."""
    url = re.sub(r"\{[^}]+\}", "1", path)
    r = api.request(method, url, headers=tokens("viewer"), json={})
    assert r.status_code == 403, (method, path, r.status_code, r.text)


# ---------- approval queue ----------


def _pending_driver(conn, created_by: str, created_by_type: str = "human") -> dict:
    text = "Sources say that filling stations in Kitwe ran out of diesel on Monday."
    src = make_source(conn, text, title="Kitwe diesel", url=f"https://example.test/kitwe/{new_id()}")
    eid = make_evidence(conn, src, text, "filling stations in Kitwe ran out of diesel")
    row, _ = gp.create_proposal(
        conn, kind="DemandDriverObserved", title="Fuel shortage in Kitwe", created_by_type=created_by_type,
        created_by=created_by, source_id=src["id"],
        events=[{"stream_type": "market", "stream_id": "zm", "event_type": "DemandDriverObserved",
                 "payload": {"driver_type": "fuel_shortage", "title": "Fuel shortage in Kitwe", "direction": "demand_up"},
                 "evidence_ids": [eid], "certainty": "reported"}],
        **({"model_id": "deterministic-v1", "prompt_version": "rules-v1"} if created_by_type == "agent" else {}))
    conn.commit()
    assert row["status"] == "pending"
    return {"proposal": row, "evidence_id": eid, "source": src}


def test_approval_queue_lists_proposals_with_events_and_evidence(api, tokens, edb):
    item = _pending_driver(edb, "enrichment.classifier", "agent")
    r = api.get("/api/proposals", params={"status": "pending"}, headers=tokens("viewer"))
    assert r.status_code == 200
    found = next(p for p in r.json()["items"] if p["id"] == item["proposal"]["id"])
    assert found["status"] == "pending" and found["kind"] == "DemandDriverObserved"
    ev = found["events"][0]
    assert ev["event_type"] == "DemandDriverObserved" and ev["certainty"] == "reported"
    evidence = ev["evidence"][0]
    assert evidence["quote"] == "filling stations in Kitwe ran out of diesel"
    text = item["source"]["metadata"]["text"]
    assert text[evidence["char_start"]:evidence["char_end"]] == evidence["quote"]
    assert evidence["url"] == item["source"]["url"] and evidence["title"] == "Kitwe diesel"
    assert evidence["publisher"] == "Test"
    assert found["evidence"][0]["id"] == item["evidence_id"]
    one = api.get(f"/api/proposals/{found['id']}", headers=tokens("viewer")).json()
    assert one["id"] == found["id"] and one["events"][0]["evidence"]
    assert api.get("/api/proposals/unknown", headers=tokens("viewer")).status_code == 404


def test_c06_02_a_user_cannot_approve_an_own_proposal(api, tokens, edb):
    """Criterion 06-2 and scenario 6: the creator gets HTTP 403 on approve and on edit and approve."""
    item = _pending_driver(edb, "u-approver")
    pid = item["proposal"]["id"]
    r = api.post(f"/api/proposals/{pid}/approve", headers=tokens("approver"))
    assert r.status_code == 403
    r = api.post(f"/api/proposals/{pid}/edit-approve", headers=tokens("approver"), json={"events": [{"certainty": "stated"}]})
    assert r.status_code == 403
    assert edb.execute("SELECT status FROM proposal WHERE id = %s", (pid,)).fetchone()["status"] == "pending"
    r = api.post(f"/api/proposals/{pid}/approve", headers=tokens("approver2"))
    assert r.status_code == 200 and r.json()["status"] == "approved"
    written = edb.execute("SELECT * FROM event WHERE proposal_id = %s AND event_type = 'DemandDriverObserved'",
                          (pid,)).fetchone()
    assert written is not None
    decision = edb.execute("SELECT * FROM event WHERE stream_type = 'proposal' AND stream_id = %s "
                           "AND event_type = 'ProposalApproved'", (pid,)).fetchone()
    assert decision["actor_type"] == "human" and decision["actor_id"] == "u-approver2"
    assert api.post(f"/api/proposals/{pid}/approve", headers=tokens("admin")).status_code == 409


def test_reject_needs_a_reason_and_writes_no_event(api, tokens, edb):
    item = _pending_driver(edb, "enrichment.classifier", "agent")
    pid = item["proposal"]["id"]
    assert api.post(f"/api/proposals/{pid}/reject", headers=tokens("approver"), json={}).status_code == 422
    assert api.post(f"/api/proposals/{pid}/reject", headers=tokens("approver"), json={"reason": "  "}).status_code == 422
    assert api.post(f"/api/proposals/{pid}/reject", headers=tokens("analyst"), json={"reason": "x"}).status_code == 403
    r = api.post(f"/api/proposals/{pid}/reject", headers=tokens("approver"), json={"reason": "The story is a rumour"})
    assert r.status_code == 200 and r.json() == {"status": "rejected", "proposal_id": pid}
    assert edb.execute("SELECT count(*) AS n FROM event WHERE proposal_id = %s AND stream_type <> 'proposal'",
                       (pid,)).fetchone()["n"] == 0
    rejected = edb.execute("SELECT * FROM event WHERE stream_type = 'proposal' AND stream_id = %s "
                           "AND event_type = 'ProposalRejected'", (pid,)).fetchone()
    assert rejected["actor_type"] == "human" and rejected["payload"]["reason"] == "The story is a rumour"


def test_edit_and_approve_writes_a_human_event_that_keeps_the_evidence(api, tokens, edb):
    item = _pending_driver(edb, "enrichment.classifier", "agent")
    pid = item["proposal"]["id"]
    body = {"events": [{"payload": {"driver_type": "fuel_shortage", "title": "Diesel shortage in Kitwe (edited)",
                                    "direction": "demand_up"}, "certainty": "reported"}], "reason": "Clearer title"}
    r = api.post(f"/api/proposals/{pid}/edit-approve", headers=tokens("approver"), json=body)
    assert r.status_code == 200 and r.json()["status"] == "edited_approved"
    ev = edb.execute("SELECT * FROM event WHERE id = %s", (r.json()["event_ids"][0],)).fetchone()
    assert ev["actor_type"] == "human" and ev["actor_id"] == "u-approver"
    assert ev["evidence_ids"] == [item["evidence_id"]]
    assert ev["payload"]["title"] == "Diesel shortage in Kitwe (edited)"
    bad = _pending_driver(edb, "enrichment.classifier", "agent")
    r = api.post(f"/api/proposals/{bad['proposal']['id']}/edit-approve", headers=tokens("approver"),
                 json={"events": [{"payload": {"title": "no driver type"}}]})
    assert r.status_code == 422


def test_an_admin_review_proposal_needs_an_admin(api, tokens, edb):
    from services.governance.source_proposals import create_source_proposal

    text = "A new feed: https://example.test/admin-review/feed"
    src = make_source(edb, text)
    ev = make_evidence(edb, src, text, "https://example.test/admin-review/feed")
    row, _ = create_source_proposal(
        edb, {"id": "admin_review_feed", "name": "Admin review feed", "type": "rss",
              "url": "https://example.test/admin-review/feed", "schedule": "daily", "licence_code": "verify_then_purge"},
        created_by_type="agent", created_by="enrichment.sources", evidence_ids=[ev], source_id=src["id"],
        model_id="deterministic-v1", prompt_version="rules-v1")
    edb.commit()
    assert row["policy"] == "admin_review"
    assert api.post(f"/api/proposals/{row['id']}/approve", headers=tokens("approver")).status_code == 403
    assert api.post(f"/api/proposals/{row['id']}/reject", headers=tokens("approver"),
                    json={"reason": "no"}).status_code == 403
    assert api.post(f"/api/proposals/{row['id']}/approve", headers=tokens("admin")).status_code == 409


def test_unknown_ids_give_404(api, tokens):
    assert api.post("/api/proposals/nope/approve", headers=tokens("approver")).status_code == 404
    assert api.post("/api/alerts/nope/acknowledge", headers=tokens("analyst")).status_code == 404
    assert api.post("/api/deals/nope/stage", headers=tokens("analyst"), json={"to_stage": "qualified"}).status_code == 404
    assert api.post("/api/persons/nope/erase", headers=tokens("admin"), json={"reason": "request"}).status_code == 404


# ---------- engagement and the audit log ----------


def test_engagement_endpoints_write_human_events(api, tokens, edb):
    """docs/06 audit log: each user action that changes data is an event with actor type human."""
    deal = make_deal(edb)
    kcm = org_id(edb, "kcm")
    calls = [
        ("/touchpoints", {"kind": "call", "date": "2026-09-24", "note": "Called the supply chain office"},
         "TouchpointLogged"),
        ("/next-action", {"action": "Send the capability statement", "owner_user_id": "u-analyst",
                          "due_date": "2026-10-02"}, "NextActionSet"),
        ("/prequalification", {"buyer_id": kcm, "status": "submitted"}, "PrequalificationStatusChanged"),
        ("/contacts", {"name": "Test Contact", "role": "Procurement manager", "organisation_id": kcm,
                       "email": "buyer@kcm.example", "phone": "+260 211 000000", "found_via": "Supplier day"},
         "ContactAdded"),
    ]
    for suffix, body, event_type in calls:
        r = api.post(f"/api/deals/{deal['id']}{suffix}", headers=tokens("analyst"), json=body)
        assert r.status_code == 200, r.text
        assert r.json()["event_type"] == event_type and r.json()["status"] == "recorded"
        ev = edb.execute("SELECT * FROM event WHERE id = %s", (r.json()["event_id"],)).fetchone()
        assert ev["actor_type"] == "human" and ev["actor_id"] == "u-analyst"
        assert ev["stream_type"] == "deal" and ev["stream_id"] == deal["id"]
        proposal = edb.execute("SELECT * FROM proposal WHERE id = %s", (r.json()["proposal_id"],)).fetchone()
        assert proposal["status"] == "auto_approved" and proposal["created_by_type"] == "human"
    state = edb.execute("SELECT * FROM proj_deal WHERE id = %s", (deal["id"],)).fetchone()
    assert state["has_contact"] and state["prequalification_status"] == "submitted"
    assert state["next_action"]["action"] == "Send the capability statement"
    # Validation: unknown kind, unknown buyer, unknown stage.
    assert api.post(f"/api/deals/{deal['id']}/touchpoints", headers=tokens("analyst"),
                    json={"kind": "lunch", "date": "2026-09-24", "note": "x"}).status_code == 422
    assert api.post(f"/api/deals/{deal['id']}/prequalification", headers=tokens("analyst"),
                    json={"buyer_id": "nope", "status": "submitted"}).status_code == 422
    assert api.post(f"/api/deals/{deal['id']}/stage", headers=tokens("analyst"),
                    json={"to_stage": "nope"}).status_code == 422


def test_manual_upload_and_brief_version_write_human_events(api, tokens, edb):
    r = api.post("/api/sources/manual", headers=tokens("analyst"),
                 files={"file": ("note.txt", b"Kansanshi Mining Plc invited bids for diesel supply.", "text/plain")},
                 data={"title": "Analyst note"})
    assert r.status_code == 201, r.text
    source_id = r.json()["source_id"]
    ev = edb.execute("SELECT * FROM event WHERE stream_type = 'source' AND stream_id = %s AND event_type = 'SourceAdded'",
                     (source_id,)).fetchone()
    assert ev["actor_type"] == "human" and ev["actor_id"] == "u-analyst"
    current = api.get("/api/briefs", headers=tokens("viewer")).json()["active_version"]
    yaml_text = api.get(f"/api/briefs/{current}", headers=tokens("viewer")).json()["yaml"]
    r = api.post("/api/briefs", headers=tokens("admin"),
                 json={"yaml": yaml_text.replace('name: "Zambia mining and industrials"',
                                                 'name: "Zambia mining and industrials (audit test)"')})
    assert r.status_code == 201, r.text
    ev = edb.execute("SELECT * FROM event WHERE event_type = 'BriefVersionCreated' AND payload->>'version' = %s",
                     (str(r.json()["version"]),)).fetchone()
    assert ev["actor_type"] == "human" and ev["actor_id"] == "u-admin"
