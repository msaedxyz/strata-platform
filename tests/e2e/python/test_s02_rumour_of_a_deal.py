"""docs/09 scenario 2: a fixture article reports a rumour of a deal. Each claim has certainty reported or speculative.
No deal stage changes without approval.

The article is the first item of tests/fixtures/site/feeds/acceptance.xml (Vedanta in talks to sell a stake in KCM).
"""

from __future__ import annotations

from .stack import wait_proposals, wait_signal

FACT_EVENTS = {"EntityAttributeAsserted", "RelationshipAsserted", "DealIdentified", "DealAttributeAsserted",
               "SiteStatusChanged", "DemandDriverObserved", "ProjectStageChanged", "SignalScored"}


def test_s02_a_rumour_gives_reported_or_speculative_claims_and_no_deal_stage_change(api, acceptance, compose):
    signal = wait_signal(api, "vedanta-kcm-stake-rumour", q="Vedanta reportedly")
    proposals = wait_proposals(api, signal["source_id"],
                               lambda ps: any(ev["event_type"] != "SignalScored" for p in ps for ev in p["events"]),
                               what="the claims of the rumour")
    events = [ev for p in proposals for ev in p["events"] if ev["event_type"] in FACT_EVENTS]
    claims = [ev for ev in events if ev["event_type"] != "SignalScored"]
    assert claims, "the rumour gives no claim"
    assert {ev["certainty"] for ev in events} <= {"reported", "speculative"}, [
        (ev["event_type"], ev["certainty"]) for ev in events]
    # A claim about a deal or a change of owner waits for a person. Nothing from the rumour changes a deal stage.
    for p in proposals:
        assert not any(ev["event_type"] == "DealStageChanged" for ev in p["events"]), p["title"]
        if p["kind"] in ("DealIdentified", "DealStageChanged", "EntityAttributeAsserted", "RelationshipAsserted"):
            assert p["status"] == "pending", (p["kind"], p["status"])
    # In the whole event store, each deal stage change comes from a proposal that a person approved.
    unapproved = compose.scalar(
        "SELECT count(*) FROM strata.event e LEFT JOIN strata.proposal p ON p.id = e.proposal_id "
        "WHERE e.event_type = 'DealStageChanged' AND (p.id IS NULL OR p.status NOT IN ('approved', 'edited_approved') "
        "OR p.decided_by IS NULL)")
    assert unapproved == "0"
