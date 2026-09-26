"""docs/09 scenario 13: a fixture item reports a suspension at a mine on the daily watch list. A SiteStatusChanged
proposal and a Tier 0 alert. The site watch list shows the pending status.

The item is in tests/fixtures/site/feeds/mining.xml: the regulator suspends the Mufulira mine of Mopani (daily watch).
The browser suite checks the pending status in the site watch list module.
"""

from __future__ import annotations

from .stack import wait_for, wait_proposals, wait_signal


def test_s13_a_suspension_at_a_daily_watch_mine_gives_a_status_proposal_a_tier0_alert_and_a_pending_status(
        api, acceptance, live):
    signal = wait_signal(api, "mufulira-suspended", q="Mufulira")
    site = next(s for s in api.ok("/api/sites", watch="daily")["items"] if s["name"] == "Mopani Mufulira mine")
    proposals = wait_proposals(api, signal["source_id"], lambda ps: any(p["kind"] == "SiteStatusChanged" for p in ps),
                               what="a SiteStatusChanged proposal")
    status = [p for p in proposals if p["kind"] == "SiteStatusChanged"]
    assert len(status) == 1 and status[0]["status"] == "pending" and status[0]["policy"] == "review"
    event = status[0]["events"][0]
    assert event["stream_id"] == site["id"] and event["payload"]["to_status"] == "suspended"
    assert event["evidence"] and all(e["verified"] for e in event["evidence"])
    alert = wait_for(lambda: next((a for a in api.alerts(tier=0) if a["source_id"] == signal["source_id"]), None),
                     timeout=60, what="the Tier 0 alert of the suspension")
    assert alert["tier_rule"] == "t0_daily_site_status_change" and alert["stream_id"] == site["id"]
    assert alert["status"] == "unconfirmed"
    assert live.find(lambda m: m.event == "AlertRaised" and m.data.get("stream_id") == alert["id"]
                     and m.data.get("alert_status") == "unconfirmed")
    # The site watch list shows the pending status. The current status does not change before approval.
    site = next(s for s in api.ok("/api/sites", watch="daily")["items"] if s["id"] == site["id"])
    assert site["status_pending"] == "suspended" and site["status"] != "suspended"
