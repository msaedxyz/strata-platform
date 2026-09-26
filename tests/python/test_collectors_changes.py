"""docs/04-ingestion.md criteria 6 and 7: a failing source, and a new brief version on the next run."""

from __future__ import annotations

import pytest

from .collector_support import activate_fixture_brief, run_fixture

pytestmark = pytest.mark.db

FAILING = "/feeds/business.xml"


@pytest.fixture(scope="module")
def failing_run(fresh_db, fixture_server, fake_clock):
    from services.common.db import connect

    with connect(fresh_db["app_url"]) as conn:
        brief = activate_fixture_brief(conn, fixture_server)
        fixture_server.fail(FAILING)
        slept_before = len(fake_clock.slept)
        results, _client = run_fixture(conn, fixture_server, fake_clock)
        fixture_server.reset()
    return {"brief": brief, "results": {r.brief_source_id: r for r in results},
            "slept": fake_clock.slept[slept_before:]}


def test_c04_06_failure_of_one_source_does_not_stop_the_other_sources(failing_run, cdb):
    """Criterion 6: business.xml fails. The other eight sources still run and collect their documents."""
    results = failing_run["results"]
    failed = results.pop("fx_rss_business")
    assert failed.status == "failed"
    assert "HTTP 500" in failed.error
    assert len(results) == 8
    assert all(r.status == "success" for r in results.values())
    assert sum(r.new for r in results.values()) > 0
    # The source that comes after the failing source in the brief still ran.
    assert results["fx_atom_logistics"].new == 2


def test_c04_06_failed_fetch_is_retried_three_times_with_backoff_then_dead_letter(failing_run, cdb):
    """Scheduling rules 2 and 3: three retries with exponential backoff, then a dead letter row."""
    run = cdb.execute("SELECT * FROM collector_run WHERE brief_source_id = 'fx_rss_business'").fetchone()
    assert run["status"] == "failed" and run["attempts"] == 4 and run["error"]
    dead = cdb.execute("SELECT * FROM dead_letter WHERE job = 'collect_source'").fetchall()
    assert len(dead) == 1
    assert dead[0]["payload"]["brief_source_id"] == "fx_rss_business"
    assert dead[0]["attempts"] == 4
    slept = failing_run["slept"]
    assert any(slept[i:i + 3] == [2, 4, 8] for i in range(len(slept))), slept


def test_c04_06_health_api_shows_the_error(failing_run, client, auth):
    from .conftest import bearer

    rows = {s["id"]: s for s in client.get("/api/sources/health", headers=bearer(auth("viewer"))).json()["sources"]}
    assert rows["fx_rss_business"]["error_rate"] == 1.0
    assert "HTTP 500" in rows["fx_rss_business"]["last_error"]
    assert rows["fx_rss_business"]["last_success_at"] is None
    assert rows["fx_rss_mining"]["error_rate"] == 0.0


def test_c04_07_new_brief_version_takes_effect_on_the_next_run(failing_run, cdb, fixture_server, fake_clock):
    """Criterion 7: a new version removes a source and adds a query. The next run uses the new version."""
    from services.collectors.brief import activate, active_brief, derive_version

    old = active_brief(cdb)

    def change(content: dict) -> None:
        content["sources"]["news"] = [s for s in content["sources"]["news"] if s["id"] != "fx_web_lumwana"]
        content["google_news"]["queries"].append({"id": "fx_gn_lobito", "q": "Lobito corridor", "schedule": "weekly"})

    new = derive_version(cdb, old, change, created_by="test", change_note="criterion 7")
    activate(cdb, new["id"], actor_type="human", actor_id="test-admin")
    cdb.commit()
    assert new["version"] == old["version"] + 1 and new["parent_version_id"] == old["id"]

    fixture_server.reset()
    results, _ = run_fixture(cdb, fixture_server, fake_clock)
    by_id = {r.brief_source_id: r for r in results}
    assert "fx_web_lumwana" not in by_id
    assert "/news/lumwana-expansion.html" not in fixture_server.paths()
    assert by_id["fx_gn_lobito"].status == "success" and by_id["fx_gn_lobito"].new == 1
    lobito = cdb.execute("SELECT * FROM source WHERE id = %s", (by_id["fx_gn_lobito"].source_ids[0],)).fetchone()
    assert lobito["brief_version_id"] == new["id"]
    assert lobito["url"] == "https://www.railwaysafrica.com/news/lobito-rail-financial-close"
    runs = cdb.execute("SELECT DISTINCT brief_version_id FROM collector_run WHERE started_at > "
                       "(SELECT activated_at FROM brief_activation WHERE brief_version_id = %s)", (new["id"],)).fetchall()
    assert [r["brief_version_id"] for r in runs] == [new["id"]]
    # The failed source of the old run recovers in the new run.
    assert by_id["fx_rss_business"].status == "success"
    event = cdb.execute("SELECT * FROM event WHERE stream_type = 'brief' ORDER BY sequence DESC LIMIT 1").fetchone()
    assert event["event_type"] == "BriefVersionActivated" and event["payload"]["brief_version_id"] == new["id"]
