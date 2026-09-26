"""Read endpoints of the Strata modules (docs/07). Each endpoint answers with projection data."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from services.collectors.brief import load_brief_files
from services.common.ids import new_id
from services.governance.bootstrap import bootstrap_brief
from services.governance.event_store import append_event

from .conftest import bearer
from .helpers import make_evidence, make_source

pytestmark = pytest.mark.db


@pytest.fixture(scope="module")
def seeded(fresh_db):
    from services.common.db import connect

    with connect() as conn:
        load_brief_files(conn)
        conn.commit()
        bootstrap_brief(conn)
        text = "Mopani Copper Mines invited bids for a haulage contract at Mufulira."
        src = make_source(conn, text, title=text)
        ev = make_evidence(conn, src, text, "invited bids for a haulage contract")
        deal = new_id()
        append_event(conn, stream_type="deal", stream_id=deal, event_type="DealIdentified",
                     payload={"title": "Mufulira haulage contract", "deal_type": "haulage_contract"},
                     evidence_ids=[ev], certainty="stated", actor_type="system", actor_id="test")
        append_event(conn, stream_type="source", stream_id=src["id"], event_type="SignalScored",
                     payload={"source_id": src["id"], "title": text, "url": src["url"], "tier": 0,
                              "tier_rule": "t0_open_procurement_notice", "score": 9.5, "breakdown": {"x": 1},
                              "sectors": ["mining"], "geographies": [], "themes": [], "entity_ids": []},
                     evidence_ids=[ev], certainty="stated", actor_type="system", actor_id="test")
        conn.commit()
    return {"deal": deal, "evidence": ev}


@pytest.fixture
def api(seeded, auth):
    from services.api.main import app

    with TestClient(app) as c:
        c.headers.update(bearer(auth("viewer", sub="u-read")))
        yield c


@pytest.mark.parametrize("path", [
    "/api/config/stages", "/api/config/taxonomy", "/api/ticker", "/api/signals", "/api/demand-drivers",
    "/api/alerts", "/api/sites", "/api/sites?watch=daily", "/api/entities?q=kansanshi", "/api/map",
    "/api/projects", "/api/calendar", "/api/deals", "/api/priority",
])
def test_read_endpoint_answers(api, path):
    r = api.get(path)
    assert r.status_code == 200, r.text


def test_watch_lists_come_from_the_brief(api):
    daily = api.get("/api/sites?watch=daily").json()["items"]
    weekly = api.get("/api/sites?watch=weekly").json()["items"]
    assert len(daily) >= 10 and len(weekly) >= 10
    assert any(s["name"].startswith("Kansanshi") for s in daily)


def test_deal_detail_relationship_timeline_and_evidence(api, seeded):
    deal = seeded["deal"]
    assert api.get(f"/api/deals/{deal}").json()["deal"]["stage"] == "signal"
    rel = api.get(f"/api/deals/{deal}/relationship").json()
    assert rel["contacts"] == [] and rel["next_action"] is None
    tl = api.get("/api/timeline", params={"stream_type": "deal", "stream_id": deal}).json()
    assert tl["items"][0]["event_type"] == "DealIdentified" and tl["items"][0]["evidence_ids"]
    ev = api.get("/api/evidence", params={"ids": [seeded["evidence"]]}).json()["items"][0]
    assert ev["quote"] == "invited bids for a haulage contract" and ev["url"]


def test_ticker_shows_tier_0(api):
    body = api.get("/api/ticker").json()
    assert any(i["tier"] == 0 for i in body["items"])
