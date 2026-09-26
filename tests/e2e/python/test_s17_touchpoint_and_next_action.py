"""docs/09 scenario 17: an analyst logs a touchpoint and a next action for an opportunity. The relationship panel shows
both. The priority list lowers the rank for "no contact found".

Part 1 (relationship panel): the opportunity is the contract mining opportunity of the Konkola Deep plan.
Part 2 (priority list, docs/05 scorer rule 6): an opportunity at a project in the engagement window with no contact
found gets the highest rank in its group, with a "no contact" part in its breakdown. After an analyst adds a contact,
that part goes away and the rank of the opportunity goes down. The opportunity is the one at the Kasempa North project
(scenario 16). The browser suite checks the panel in the UI.
"""

from __future__ import annotations

import time

from .stack import approved_deal, wait_for, wait_signal


def test_s17_part1_the_relationship_panel_shows_the_touchpoint_and_the_next_action(api, acceptance):
    card = approved_deal(api, "business/2026/09/kcm-plan-konkola-deep", "Contract mining:", q="Konkola Deep")
    deal_id = card["id"]
    run = time.strftime("%H%M%S")
    note = f"Met the procurement team in Chingola ({run})"
    action = f"Send the prequalification pack ({run})"
    r1 = api.post(f"/api/deals/{deal_id}/touchpoints", "analyst", {"kind": "meeting", "date": "2026-09-22", "note": note})
    owner = api.ok("/api/me", "analyst")["id"]
    r2 = api.post(f"/api/deals/{deal_id}/next-action", "analyst",
                  {"action": action, "owner_user_id": owner, "due_date": "2026-10-05"})
    assert r1.status_code == 200 and r2.status_code == 200, (r1.text, r2.text)
    rel = api.ok(f"/api/deals/{deal_id}/relationship")
    touchpoint = next(t for t in rel["touchpoints"] if t["data"]["note"] == note)
    assert touchpoint["actor_id"] == owner
    assert rel["next_action"]["data"]["action"] == action
    assert rel["next_action"]["data"]["due_date"] == "2026-10-05"
    # A viewer cannot log a touchpoint.
    r = api.post(f"/api/deals/{deal_id}/touchpoints", "viewer", {"kind": "call", "date": "2026-09-23", "note": "x"})
    assert r.status_code == 403


def _no_contact_part(item: dict) -> float:
    parts = item.get("priority_breakdown") or {}
    value = next((v for k, v in parts.items() if "contact" in k), 0) or 0
    if isinstance(value, dict):
        value = value.get("contribution") or value.get("value") or value.get("score") or 0
    return float(value)


def test_s17_part2_the_priority_list_ranks_no_contact_found_first_and_lowers_it_after_a_contact(api, acceptance):
    wait_signal(api, "zema-eis-kasempa-north", q="Kasempa North")
    project = wait_for(lambda: next((p for p in api.ok("/api/projects")["items"]
                                     if p["name"] == "Kasempa North Copper Project"), None),
                       timeout=60, what="the Kasempa North project")
    assert project["in_engagement_window"] is True

    def opportunity():
        for p in api.proposals(kind="DealIdentified"):
            if any(ev["payload"].get("project_id") == project["id"] for ev in p["events"]):
                return p
        return next((d for d in api.ok("/api/deals")["items"] if d.get("project_id") == project["id"]), None)

    found = wait_for(opportunity, timeout=120,
                     what="an opportunity at the Kasempa North project (a project in the engagement window)")
    if found.get("kind") == "DealIdentified" and found["status"] == "pending":
        assert api.post(f"/api/proposals/{found['id']}/approve", "approver").status_code == 200
    deal_id = found.get("stream_id") or found["id"]

    def ranked():
        items = api.ok("/api/priority", limit=500)["items"]
        item = next((i for i in items if i["id"] == deal_id), None)
        return (items, item) if item and item["priority_score"] is not None else None

    items, item = wait_for(ranked, timeout=60, what="a priority score for the opportunity")
    assert item["has_contact"] is False and _no_contact_part(item) > 0, item["priority_breakdown"]
    rank_before = [i["id"] for i in items].index(deal_id)
    score_before = item["priority_score"]
    org = api.ok("/api/entities", q="Kasempa", type="organisation")["items"]
    body = {"name": "Chanda Priority-Test", "role": "Procurement manager", "email": "chanda.priority@developer.example",
            "phone": "+260 977 000 202", "found_via": "ZEMA public disclosure meeting"}
    if org:
        body["organisation_id"] = org[0]["id"]
    r = api.post(f"/api/deals/{deal_id}/contacts", "analyst", body)
    assert r.status_code == 200, r.text

    def rescored():
        items = api.ok("/api/priority", limit=500)["items"]
        item = next(i for i in items if i["id"] == deal_id)
        return (items, item) if item["has_contact"] else None

    items, item = wait_for(rescored, timeout=60, what="the opportunity with a contact in the priority list")
    assert _no_contact_part(item) == 0, item["priority_breakdown"]
    assert item["priority_score"] < score_before
    assert [i["id"] for i in items].index(deal_id) >= rank_before
