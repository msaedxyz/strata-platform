"""docs/09 scenario 1: an admin activates a new brief version. The collectors run. A fixture article describes a sale
process at a watched entity. A Tier 0 alert appears as Unconfirmed within 15 minutes of the collector run. An approver
confirms it. Telemetry shows every timestamp.

The article is tests/fixtures/site/feeds/deals.xml: KCM starts a sale process for the fuel supply contract of the
Nchanga mine (daily watch list) and invites expressions of interest (assumption 162).
"""

from __future__ import annotations

from datetime import datetime, timedelta

from .stack import wait_for

ARTICLE = "kcm-sale-process-nchanga-diesel"
TIMESTAMPS = ("published_at", "fetched_at", "raised_at", "acknowledged_at", "acknowledged_by", "decided_at",
              "decided_by", "outcome", "tier_rule", "latency_fetch_to_alert_seconds", "time_to_acknowledgement_seconds")


def test_s01_new_brief_version_collectors_and_a_tier0_alert_confirmed_with_telemetry(
        api, acceptance, live, fixture_server, mailpit, results_timeout):
    # 1. The admin activated the new brief version through the API. The activation is a human event.
    brief = acceptance["brief"]
    assert api.ok("/api/briefs")["active_version"] == brief["version"]
    events = api.timeline("brief", "main")["items"]
    activation = [e for e in events if e["event_type"] == "BriefVersionActivated"
                  and e["payload"]["brief_version_id"] == brief["id"]]
    assert activation and activation[-1]["actor_type"] == "human"

    # 2. The collectors ran against the fixture server.
    run = acceptance["health"]["fx_rss_deals"]
    assert run["last_status"] == "success" and run["last_success_at"], run
    assert "/feeds/deals.xml" in fixture_server.paths()

    # 3. A Tier 0 alert appears as unconfirmed, with no approval.
    def alert():
        return next((a for a in api.alerts(tier=0) if ARTICLE in (a.get("url") or "")), None)

    found = wait_for(alert, timeout=results_timeout, what="a Tier 0 alert for the sale process article")
    assert found["status"] == "unconfirmed" and found["tier_rule"] == "t0_open_procurement_notice", found
    collector_run_end = datetime.fromisoformat(run["last_success_at"])
    raised = datetime.fromisoformat(found["raised_at"])
    assert raised - collector_run_end < timedelta(minutes=15), (raised, collector_run_end)
    # The live stream sent the alert as unconfirmed.
    message = wait_for(lambda: live.find(lambda m: m.event == "AlertRaised" and m.data.get("stream_id") == found["id"]),
                       timeout=30, interval=0.5, what="the AlertRaised live message")
    assert message.data["alert_status"] == "unconfirmed"
    # The signal carries the alert status in the feed and the ticker.
    signal = next(s for s in api.signals(q="KCM starts sale process") if ARTICLE in s["url"])
    assert signal["tier"] == 0 and signal["alert_status"] == "unconfirmed"
    # The opportunity waits for approval: an alert needs no approval, a deal does.
    deals = api.proposals(source_id=found["source_id"], kind="DealIdentified")
    assert deals and {p["status"] for p in deals} == {"pending"}

    # 4. An analyst acknowledges. An approver confirms.
    r = api.post(f"/api/alerts/{found['id']}/acknowledge", "analyst")
    assert r.status_code == 200, r.text
    r = api.post(f"/api/alerts/{found['id']}/confirm", "approver", {"reason": "The notice is real"})
    assert r.status_code == 200 and r.json()["status"] == "confirmed", r.text
    assert next(a for a in api.alerts() if a["id"] == found["id"])["status"] == "confirmed"

    # 5. Telemetry shows every timestamp, the delivery to the frontend and to email, and the metrics.
    def telemetry():
        items = api.ok("/api/telemetry/alerts")["items"]
        item = next(i for i in items if i["id"] == found["id"])
        return item if item["delivered"]["frontend"] and item["delivered"]["email"] else None

    item = wait_for(telemetry, timeout=60, what="frontend and email delivery times in the telemetry")
    for name in TIMESTAMPS:
        assert item[name] is not None, name
    assert item["outcome"] == "confirmed" and item["acknowledged_by"] and item["decided_by"]
    metrics = api.ok("/api/telemetry/alerts")["metrics"]
    assert metrics["latency_fetch_to_alert_seconds"]["n"] >= 1
    assert any(rule["tier_rule"] == "t0_open_procurement_notice" for rule in metrics["false_positive_rate_by_tier_rule"])
    # The alert email reached the local mail server.
    assert any("sale process" in s.lower() or "tier 0" in s.lower() for s in mailpit.subjects()), mailpit.subjects()[:5]
