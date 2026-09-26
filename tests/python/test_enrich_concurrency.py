"""M7 bug B1: two enrichment runs on one source at the same time must give one run and no error."""

from __future__ import annotations

import threading

import pytest

from services.common.db import connect
from services.enrichment.pipeline import enrich

from .helpers import make_source

pytestmark = pytest.mark.db


def test_parallel_enrich_of_one_source_runs_once(database):
    with connect(database["app_url"]) as conn:
        src = make_source(conn, "Diesel shortage hits Lusaka as fuel imports fall.", title="Diesel shortage hits Lusaka")
        conn.commit()
    results = []

    def run():
        with connect(database["app_url"]) as c:
            results.append(enrich(c, src["id"]))

    threads = [threading.Thread(target=run) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=120)
    statuses = sorted(r["status"] for r in results)
    assert statuses.count("already_enriched") == 3, statuses
    assert "failed" not in statuses
    with connect(database["app_url"]) as c:
        n = c.execute("SELECT count(*) AS n FROM enrichment_run WHERE source_id = %s", (src["id"],)).fetchone()["n"]
    assert n == 1


def test_brief_activation_through_api_creates_new_watch_entities(client, auth, database):
    """M7 bug B5: an admin activates a brief with a new watched site. The site entity exists at once."""
    import yaml

    from services.collectors.brief import load_brief_files

    from .conftest import bearer

    with connect(database["app_url"]) as conn:
        load_brief_files(conn)
        conn.commit()
    admin = bearer(auth("admin", sub="u-admin-b5"))
    version = client.get("/api/briefs", headers=admin).json()["active_version"]
    content = client.get(f"/api/briefs/{version}", headers=admin).json()
    doc = yaml.safe_load(content["yaml"])
    # dict() keeps shared lists, so safe_dump writes YAML anchors and aliases. The bootstrap must accept them.
    new_site = dict(doc["watch"]["weekly"][0])
    new_site.update(id="b5_test_site", name="B5 Test Quarry", aliases=[], geometry=None)
    doc["watch"]["weekly"].append(new_site)
    r = client.post("/api/briefs", headers=admin, json={"yaml": yaml.safe_dump(doc, sort_keys=False),
                                                        "change_note": "B5 test", "activate": True})
    assert r.status_code in (200, 201), r.text
    with connect(database["app_url"]) as conn:
        row = conn.execute("SELECT id FROM entity WHERE brief_key = 'b5_test_site'").fetchone()
    assert row is not None
