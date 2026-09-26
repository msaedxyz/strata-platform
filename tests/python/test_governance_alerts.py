"""Tier 0 alerts and alert telemetry: docs/06-governance.md criteria 4 and 5.

The criterion 4 test runs the enrichment pipeline on a Tier 0 fixture document while a client reads the real
SSE stream of the API (uvicorn in a thread). The alert arrives as unconfirmed while the related proposal is
still pending. The alert shows its status in each place where it appears: the live message, /api/alerts,
the ticker and the signal feed.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import httpx
import pytest

from services.governance import alerts as alert_service

from .enrichment_support import enrich_text, proposals_of, site_id
from .governance_support import SSEReader
from .helpers import make_evidence, make_source

pytestmark = pytest.mark.db

SUSPENSION = ("Regulator suspends operations at Nchanga mine\n\n"
              "The Mines Safety Department has suspended open pit operations at the Nchanga mine of Konkola Copper "
              "Mines Plc after a wall failure at the pit.")


def test_c06_04_tier0_alert_reaches_the_frontend_unconfirmed_before_any_approval(live_server, tokens, auth, edb):
    """Criterion 06-4: the pipeline raises the alert, the SSE stream sends it with the status unconfirmed, and
    GET /api/alerts shows it as unconfirmed while the related SiteStatusChanged proposal is still pending."""
    from .conftest import bearer

    viewer = auth("viewer", sub="u-viewer-live")
    reader = SSEReader(live_server.url, viewer).start()
    try:
        source, result = enrich_text(edb, SUSPENSION)
        assert result["tier"] == 0 and result["tier_rule"] == "t0_daily_site_status_change"
        message = reader.wait_for(lambda m: m["event"] == "AlertRaised")
    finally:
        reader.stop()
    alert_id = message["data"]["stream_id"]
    assert message["data"]["stream_type"] == "alert"
    assert message["data"]["alert_status"] == "unconfirmed"
    assert message["data"]["alert"]["tier"] == 0 and message["data"]["alert"]["source_id"] == source["id"]
    # The related proposals are still pending: no approval happened before the alert.
    status_proposals = [p for p in proposals_of(edb, source["id"]) if p["kind"] == "SiteStatusChanged"]
    assert status_proposals and all(p["status"] == "pending" for p in status_proposals)
    assert edb.execute("SELECT count(*) AS n FROM event WHERE event_type = 'SiteStatusChanged' AND stream_id = %s",
                       (site_id(edb, "kcm_nchanga"),)).fetchone()["n"] == 0
    headers = bearer(viewer)
    with httpx.Client(base_url=live_server.url, headers=headers, timeout=10) as http:
        alerts = http.get("/api/alerts", params={"status": "unconfirmed"}).json()["items"]
        alert = next(a for a in alerts if a["id"] == alert_id)
        assert alert["status"] == "unconfirmed" and alert["tier"] == 0
        ticker = http.get("/api/ticker").json()["items"]
        assert next(i for i in ticker if i["id"] == source["id"])["alert_status"] == "unconfirmed"
        feed = http.get("/api/signals", params={"tier": 0}).json()["items"]
        signal = next(i for i in feed if i["id"] == source["id"])
        assert signal["alert_status"] == "unconfirmed" and signal["alert_id"] == alert_id
    # Telemetry: the live stream recorded the delivery to a connected client.
    import time

    deadline = time.time() + 10
    delivered = None
    while time.time() < deadline and delivered is None:
        edb.rollback()
        delivered = edb.execute("SELECT * FROM alert_delivery WHERE alert_id = %s AND channel = 'frontend' "
                                "AND status = 'delivered'", (alert_id,)).fetchone()
        time.sleep(0.1)
    assert delivered is not None and delivered["detail"]["user_id"] == "u-viewer-live"
    edb.commit()


def _alert(conn, title: str, tier_rule: str = "t0_market_demand_driver", fetched_ago: timedelta = timedelta(minutes=5),
           published_ago: timedelta = timedelta(hours=2)) -> str:
    now = datetime.now(UTC)
    text = f"{title}. Filling stations ran out of diesel."
    src = make_source(conn, text, title=title, url=f"https://example.test/alert/{title.replace(' ', '-')}")
    conn.execute("UPDATE source SET fetched_at = %s, published_at = %s WHERE id = %s",
                 (now - fetched_ago, now - published_ago, src["id"]))
    src = conn.execute("SELECT * FROM source WHERE id = %s", (src["id"],)).fetchone()
    eid = make_evidence(conn, src, text, "ran out of diesel")
    row, _ = alert_service.raise_alert(conn, source=src, tier=0, tier_rule=tier_rule, title=title, evidence_ids=[eid])
    conn.commit()
    return row["stream_id"]


def test_alert_endpoints_enforce_roles_and_write_human_events(api, tokens, edb):
    alert_id = _alert(edb, "Alert roles test")
    assert api.post(f"/api/alerts/{alert_id}/acknowledge", headers=tokens("viewer")).status_code == 403
    r = api.post(f"/api/alerts/{alert_id}/acknowledge", headers=tokens("analyst"))
    assert r.status_code == 200 and r.json()["acknowledged_by"] == "u-analyst" and r.json()["status"] == "unconfirmed"
    again = api.post(f"/api/alerts/{alert_id}/acknowledge", headers=tokens("analyst2")).json()
    assert again["acknowledged_by"] == "u-analyst"
    acks = edb.execute("SELECT * FROM event WHERE stream_type = 'alert' AND stream_id = %s AND event_type = "
                       "'AlertAcknowledged'", (alert_id,)).fetchall()
    assert len(acks) == 1 and acks[0]["actor_type"] == "human"
    assert api.post(f"/api/alerts/{alert_id}/confirm", headers=tokens("analyst"), json={}).status_code == 403
    assert api.post(f"/api/alerts/{alert_id}/dismiss", headers=tokens("approver"), json={}).status_code == 422
    r = api.post(f"/api/alerts/{alert_id}/confirm", headers=tokens("approver"), json={"reason": "Checked with the buyer"})
    assert r.status_code == 200 and r.json()["status"] == "confirmed"
    confirmed = edb.execute("SELECT * FROM event WHERE stream_type = 'alert' AND stream_id = %s AND event_type = "
                            "'AlertConfirmed'", (alert_id,)).fetchone()
    assert confirmed["actor_type"] == "human" and confirmed["actor_id"] == "u-approver" and confirmed["evidence_ids"]
    assert api.post(f"/api/alerts/{alert_id}/dismiss", headers=tokens("approver"),
                    json={"reason": "late"}).status_code == 409
    other = _alert(edb, "Alert dismiss test")
    r = api.post(f"/api/alerts/{other}/dismiss", headers=tokens("approver"),
                 json={"reason": "The shortage was a rumour", "false_positive": True})
    assert r.status_code == 200 and r.json()["status"] == "false_positive"
    listed = {a["id"]: a for a in api.get("/api/alerts", headers=tokens("viewer")).json()["items"]}
    assert listed[alert_id]["status"] == "confirmed" and listed[other]["status"] == "false_positive"


def test_c06_05_telemetry_returns_every_value_and_metric_for_fixture_alerts(api, tokens, edb, smtp_stub):
    """Criterion 06-5: timestamps of each alert, delivery for each channel, acknowledgement, outcome with the
    tier rule, and the metrics: latency from fetch to alert, time to acknowledgement, false positives by rule."""
    ids = {
        "a": _alert(edb, "Telemetry alert A", "t0_market_demand_driver", timedelta(minutes=2)),
        "b": _alert(edb, "Telemetry alert B", "t0_market_demand_driver", timedelta(minutes=4)),
        "c": _alert(edb, "Telemetry alert C", "t0_open_procurement_notice", timedelta(minutes=6)),
        "d": _alert(edb, "Telemetry alert D", "t0_open_procurement_notice", timedelta(minutes=8)),
    }
    assert len(smtp_stub.messages) >= 4
    alert_service.record_frontend_delivery(edb, ids["a"], {"user_id": "u-viewer"})
    edb.commit()
    for key in ("a", "b", "c"):
        assert api.post(f"/api/alerts/{ids[key]}/acknowledge", headers=tokens("analyst")).status_code == 200
    api.post(f"/api/alerts/{ids['a']}/confirm", headers=tokens("approver"), json={"reason": "true"})
    api.post(f"/api/alerts/{ids['b']}/dismiss", headers=tokens("approver"), json={"reason": "wrong", "false_positive": True})
    api.post(f"/api/alerts/{ids['c']}/dismiss", headers=tokens("approver"), json={"reason": "old news"})
    api.post(f"/api/alerts/{ids['d']}/confirm", headers=tokens("approver"), json={})
    r = api.get("/api/telemetry/alerts", headers=tokens("viewer"))
    assert r.status_code == 200
    body = r.json()
    items = {i["id"]: i for i in body["items"]}
    a = items[ids["a"]]
    for field in ("published_at", "fetched_at", "raised_at", "acknowledged_at", "acknowledged_by", "decided_at",
                  "outcome", "tier_rule", "latency_fetch_to_alert_seconds", "time_to_acknowledgement_seconds"):
        assert a[field] is not None, field
    assert a["delivered"]["frontend"] and a["delivered"]["frontend_broadcast"] and a["delivered"]["email"]
    assert a["delivery_status"] == {"frontend": "delivered", "email": "delivered"}
    assert items[ids["b"]]["delivery_status"]["frontend"] == "broadcast"
    assert a["acknowledged_by"] == "u-analyst" and a["outcome"] == "confirmed"
    assert items[ids["b"]]["outcome"] == "false_positive" and items[ids["c"]]["outcome"] == "dismissed"
    assert items[ids["d"]]["time_to_acknowledgement_seconds"] is None
    assert 100 <= a["latency_fetch_to_alert_seconds"] <= 200  # fetched two minutes before the alert
    assert 7000 <= a["latency_publish_to_alert_seconds"] <= 7400
    metrics = body["metrics"]
    lat = metrics["latency_fetch_to_alert_seconds"]
    assert lat["n"] >= 4 and lat["median"] is not None and lat["p90"] >= lat["median"]
    tta = metrics["time_to_acknowledgement_seconds"]
    assert tta["n"] >= 3 and tta["median"] is not None and tta["p90"] is not None
    rules = {r["tier_rule"]: r for r in metrics["false_positive_rate_by_tier_rule"]}
    market = rules["t0_market_demand_driver"]
    assert market["false_positive"] >= 1 and 0 < market["false_positive_rate"] <= 1
    proc = rules["t0_open_procurement_notice"]
    assert proc["decided"] >= 2 and proc["false_positive"] == 0 and proc["false_positive_rate"] == 0


def test_percentile_uses_linear_interpolation():
    assert alert_service.percentile([], 50) is None
    assert alert_service.percentile([10.0], 90) == 10.0
    assert alert_service.percentile([1.0, 2.0, 3.0, 4.0], 50) == 2.5
    assert alert_service.percentile(list(map(float, range(1, 11))), 90) == 9.1
