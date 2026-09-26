"""docs/09 scenario 14: a fixture item reports a fuel shortage. A DemandDriverObserved event in the market stream and
a Tier 0 alert.

The item is in tests/fixtures/site/feeds/business.xml: filling stations on the Copperbelt ran out of diesel.
"""

from __future__ import annotations

from .stack import wait_for, wait_signal


def test_s14_a_fuel_shortage_gives_a_market_demand_driver_and_a_tier0_alert(api, acceptance):
    signal = wait_signal(api, "copperbelt-fuel-shortage", q="Fuel shortage")
    assert signal["tier"] == 0 and signal["tier_rule"] == "t0_market_demand_driver"
    market = api.timeline("market", "zm")["items"]
    drivers = [e for e in market if e["event_type"] == "DemandDriverObserved"
               and e["payload"].get("source_id") == signal["source_id"]]
    assert "fuel_shortage" in {d["payload"]["driver_type"] for d in drivers}, [d["payload"] for d in drivers]
    assert all(d["evidence_ids"] for d in drivers)
    listed = [d for d in api.ok("/api/demand-drivers", limit=500)["items"] if d["source_id"] == signal["source_id"]]
    assert listed, "the demand drivers module does not list the driver"
    alert = wait_for(lambda: next((a for a in api.alerts(tier=0) if a["source_id"] == signal["source_id"]), None),
                     timeout=60, what="the Tier 0 alert of the fuel shortage")
    assert alert["stream_type"] == "market" and alert["tier_rule"] == "t0_market_demand_driver"
    assert alert["status"] == "unconfirmed"
