"""docs/04-ingestion.md pipeline step 10 and scheduling: the job queue runs the collect and enrich jobs."""

from __future__ import annotations

import pytest

from .collector_support import activate_fixture_brief

pytestmark = pytest.mark.db


def _run_worker(app_url: str) -> None:
    from procrastinate import PsycopgConnector

    from services.queue import app

    with app.replace_connector(PsycopgConnector(conninfo=app_url, min_size=1, max_size=3)):
        app.run_worker(wait=False, install_signal_handlers=False, listen_notify=False, concurrency=1)


def test_c04_worker_runs_a_collect_job_and_the_enrichment_jobs(fresh_db, cdb, fixture_server, fake_clock, monkeypatch):
    from services.common.settings import get_settings
    from services.queue import defer_collect

    monkeypatch.setenv("STRATA_GOOGLE_NEWS_BASE_URL", f"{fixture_server.base_url}/rss/search")
    # Jobs that the periodic dispatcher defers wait 60 seconds, so this worker run does not start them.
    monkeypatch.setattr("services.collectors.schedule.jitter_seconds", lambda: 60)
    get_settings.cache_clear()
    activate_fixture_brief(cdb, fixture_server)
    assert defer_collect("fx_rss_mining") is not None
    assert defer_collect("fx_rss_mining") is None  # the queueing lock stops a second waiting job
    _run_worker(fresh_db["app_url"])

    run = cdb.execute("SELECT * FROM collector_run WHERE brief_source_id = 'fx_rss_mining'").fetchone()
    assert run["status"] == "success" and run["documents_new"] == 3
    jobs = cdb.execute("SELECT task_name, status, args FROM public.procrastinate_jobs ORDER BY id").fetchall()
    collect = [j for j in jobs if j["task_name"] == "collect_source"]
    enrich = [j for j in jobs if j["task_name"] == "enrich_source"]
    mining = [j for j in collect if j["args"]["brief_source_id"] == "fx_rss_mining"]
    assert [j["status"] for j in mining] == ["succeeded"]
    # The worker can also run the periodic dispatcher. It never defers the source that has a job or a run.
    dispatched = {j["args"]["brief_source_id"] for j in collect if j["status"] == "todo"}
    assert "fx_rss_mining" not in dispatched
    sources = {r["id"] for r in cdb.execute("SELECT id FROM source").fetchall()}
    assert {j["args"]["source_id"] for j in enrich} == sources
    assert all(j["status"] == "succeeded" for j in enrich)
    get_settings.cache_clear()


def test_c04_collect_job_for_a_source_outside_the_active_brief_is_skipped(fresh_db, cdb):
    from services.queue import collect_source

    result = collect_source("not_in_brief")
    assert result["status"] == "skipped"
    row = cdb.execute("SELECT status FROM collector_run WHERE brief_source_id = 'not_in_brief'").fetchone()
    assert row["status"] == "skipped"
