"""docs/09 scenario 6: the analyst who created a proposal tries to approve it. HTTP 403.

An approver has the permissions of an analyst too. The approver who creates a proposal also gets 403, and a second
approver can approve it.
"""

from __future__ import annotations

from .stack import approved_deal


def test_s06_the_creator_of_a_proposal_cannot_approve_it(api, acceptance):
    card = approved_deal(api, "kansanshi-diesel-supply-tender", "Fuel supply contract:", q="Kansanshi invites bids")
    deal_id = card["id"]
    r = api.post(f"/api/deals/{deal_id}/stage", "analyst", {"to_stage": "qualified"})
    assert r.status_code == 200, r.text
    pid = r.json()["proposal_id"]
    assert api.ok(f"/api/proposals/{pid}", "analyst")["created_by_me"] is True
    # The analyst has no approve permission at all: 403.
    assert api.post(f"/api/proposals/{pid}/approve", "analyst").status_code == 403
    assert api.post(f"/api/proposals/{pid}/reject", "approver", {"reason": "Not yet qualified"}).status_code == 200
    # The approver creates a proposal and tries to approve it: 403. A second approver approves it.
    r = api.post(f"/api/deals/{deal_id}/stage", "approver", {"to_stage": "qualified"})
    assert r.status_code == 200, r.text
    pid = r.json()["proposal_id"]
    r = api.post(f"/api/proposals/{pid}/approve", "approver")
    assert r.status_code == 403, r.text
    r = api.post(f"/api/proposals/{pid}/edit-approve", "approver", {"events": [{"certainty": "stated"}]})
    assert r.status_code == 403, r.text
    assert api.ok(f"/api/proposals/{pid}")["status"] == "pending"
    assert api.post(f"/api/proposals/{pid}/approve", "approver2").status_code == 200
    assert next(d for d in api.ok("/api/deals")["items"] if d["id"] == deal_id)["stage"] == "qualified"
