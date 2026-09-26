"""docs/09 scenario 4 (API part): an analyst moves a Kanban card to the next stage. The card shows Pending approval.
An approver approves. The timeline shows the event with evidence. The "as of" view before the approval shows the old
stage. The browser suite (tests/e2e/browser/scenario-04.spec.ts) does the same with a drag in the Kanban board.

The deal comes from the ZPPA tender notice (a PDF on the fixture server): an approver approves its DealIdentified
proposal first. The database sets recorded_at, so "the previous day" is a time between the deal and the approval
(assumption 163).
"""

from __future__ import annotations

import time
from datetime import UTC, datetime

from .stack import approved_deal


def test_s04_a_stage_move_waits_for_approval_and_the_timeline_and_as_of_view_show_it(api, acceptance):
    card = approved_deal(api, "zppa-haulage-tender.pdf", "Tender:", q="ZPPA")
    deal_id = card["id"]
    assert card["stage"] == "signal" and card["stage_pending"] is None
    time.sleep(1)
    before = datetime.now(UTC).isoformat()
    time.sleep(1)
    r = api.post(f"/api/deals/{deal_id}/stage", "analyst", {"to_stage": "qualified"})
    assert r.status_code == 200 and r.json()["status"] == "pending", r.text
    card = next(d for d in api.ok("/api/deals")["items"] if d["id"] == deal_id)
    assert card["stage"] == "signal" and card["stage_pending"] == "qualified" and card["pending_proposal_id"]
    queue = api.proposals(status="pending", kind="DealStageChanged")
    proposal = next(p for p in queue if p["id"] == card["pending_proposal_id"])
    assert proposal["created_by_type"] == "human"
    r = api.post(f"/api/proposals/{proposal['id']}/approve", "approver", {"reason": "Buyer confirmed the need"})
    assert r.status_code == 200, r.text
    card = next(d for d in api.ok("/api/deals")["items"] if d["id"] == deal_id)
    assert card["stage"] == "qualified" and card["stage_pending"] is None
    # The timeline shows the event, with the evidence of the deal.
    timeline = api.timeline("deal", deal_id)
    change = next(i for i in timeline["items"] if i["event_type"] == "DealStageChanged")
    assert change["payload"]["from_stage"] == "signal" and change["payload"]["to_stage"] == "qualified"
    assert change["actor_type"] == "human" and change["proposal_id"] == proposal["id"]
    identified = next(i for i in timeline["items"] if i["event_type"] == "DealIdentified")
    evidence = api.ok("/api/evidence", ids=identified["evidence_ids"])["items"]
    assert evidence and all(e["verified"] and e["quote"] and "zppa-haulage-tender.pdf" in e["url"] for e in evidence)
    # The "as of" view before the approval shows the old stage.
    old = api.ok(f"/api/deals/{deal_id}", as_of=before)
    assert old["deal"]["stage"] == "signal"
    old_timeline = api.timeline("deal", deal_id, as_of=before)
    assert "DealStageChanged" not in [i["event_type"] for i in old_timeline["items"]]
    assert api.ok(f"/api/deals/{deal_id}")["deal"]["stage"] == "qualified"
