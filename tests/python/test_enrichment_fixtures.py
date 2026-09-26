"""docs/05 criterion 1 on the collected fixture documents and the research snapshot, and docs/09 scenario 15.

The module database has brief v1 active with its watch lists as entities. The collectors run once against
the fixture server with the fixture brief, then v1 is active again (like scripts/load_fixtures.py). The
snapshot loader stores the 146 snapshot items. Then every source goes through the seven agents on the
deterministic backend.
"""

from __future__ import annotations

import pytest

from .collector_support import activate_fixture_brief, run_fixture

AGENTS = {"classifier", "extractor", "resolver", "lifecycle", "window_forecaster", "summariser", "scorer"}


@pytest.fixture(scope="module")
def enriched(edb_setup, fixture_server, fake_clock):
    from services.collectors.brief import activate, active_brief
    from services.collectors.snapshot import load_snapshot, snapshot_dirs
    from services.common.db import connect
    from services.enrichment.backends import DeterministicBackend
    from services.enrichment.pipeline import enrich

    with connect(edb_setup["app_url"]) as conn:
        v1 = active_brief(conn)
        activate_fixture_brief(conn, fixture_server)
        run_fixture(conn, fixture_server, fake_clock)
        activate(conn, v1["id"], actor_type="system", actor_id="test")
        conn.commit()
        fixture_ids = [r["id"] for r in conn.execute(
            "SELECT id FROM source WHERE url LIKE %s OR metadata->>'google_news_link' IS NOT NULL ORDER BY fetched_at",
            (f"{fixture_server.base_url}%",)).fetchall()]
        fixture_ids += [r["id"] for r in conn.execute(
            "SELECT id FROM source WHERE type = 'google_news' AND NOT (id = ANY(%s))", (fixture_ids,)).fetchall()]
        for directory in snapshot_dirs():
            load_snapshot(conn, directory)
        snapshot_ids = [r["id"] for r in conn.execute("SELECT id FROM source WHERE type = 'snapshot'").fetchall()]
        backend = DeterministicBackend()
        results = {sid: enrich(conn, sid, backend=backend) for sid in fixture_ids + snapshot_ids}
    return {"fixture_ids": fixture_ids, "snapshot_ids": snapshot_ids, "results": results}


def test_c05_01_all_seven_agents_run_on_fixture_documents(enriched, edb):
    ids = enriched["fixture_ids"]
    assert len(ids) >= 12, ids
    ran = set()
    for sid in ids:
        result = enriched["results"][sid]
        assert result["status"] in ("in_scope", "out_of_scope", "quarantined"), result
        proposals = edb.execute("SELECT count(*) AS n FROM proposal WHERE source_id = %s", (sid,)).fetchone()["n"]
        quarantine = edb.execute("SELECT count(*) AS n FROM quarantine WHERE source_id = %s", (sid,)).fetchone()["n"]
        run = edb.execute("SELECT * FROM enrichment_run WHERE id = %s", (result["run_id"],)).fetchone()
        assert set(run["agent_statuses"]) == AGENTS
        if result["status"] == "in_scope":
            assert proposals > 0, sid
            for agent, st in run["agent_statuses"].items():
                assert st["status"] in ("ok", "no_projects", "quarantined"), (agent, st)
                if st["status"] == "ok":
                    ran.add(agent)
        else:
            assert proposals > 0 or quarantine > 0 or result["status"] == "out_of_scope", sid
    assert ran == AGENTS, ran
    in_scope = [s for s in ids if enriched["results"][s]["status"] == "in_scope"]
    assert len(in_scope) >= len(ids) - 2


def test_c05_01_snapshot_sources_enrich_without_errors(enriched, edb):
    ids = enriched["snapshot_ids"]
    assert len(ids) == 146
    statuses = [enriched["results"][s]["status"] for s in ids]
    assert "failed" not in statuses
    assert statuses.count("in_scope") >= 100, {s: statuses.count(s) for s in set(statuses)}
    signals = edb.execute("SELECT count(*) AS n FROM proj_signal WHERE source_id = ANY(%s)", (ids,)).fetchone()["n"]
    assert signals == statuses.count("in_scope")
    assert edb.execute("SELECT count(*) AS n FROM proj_signal WHERE source_id = ANY(%s) AND NOT read_at_source",
                       (ids,)).fetchone()["n"] == 0


def test_c05_02_sql_check_finds_zero_facts_without_verified_evidence_after_fixtures(enriched, edb):
    import scripts.check_evidence as check_evidence

    result = check_evidence.check(edb)
    assert result["fact_events"] > 100
    assert result["facts_without_verified_evidence"] == 0, result["problems"][:5]
    assert result["sql_count"] == 0


def test_scenario_15_google_news_only_item_uses_item_text_only_and_sets_read_at_source(enriched, edb, fixture_server):
    """docs/09 scenario 15: Mining Weekly is in google_news_only. Strata uses the item text only."""
    source = edb.execute("SELECT * FROM source WHERE type = 'google_news' AND url LIKE '%%miningweekly.com%%'").fetchone()
    assert source is not None
    assert source["read_at_source"] is True
    assert source["retention_policy"] == "link_only" and source["raw_uri"] is None
    assert not any("miningweekly" in p for p in fixture_server.paths())
    from services.enrichment.sources import load_text

    text = load_text(source)
    assert text.startswith(source["title"]) and len(text) < 400
    result = enriched["results"][source["id"]]
    assert result["status"] == "in_scope"
    signal = edb.execute("SELECT * FROM proj_signal WHERE source_id = %s", (source["id"],)).fetchone()
    assert signal["read_at_source"] is True
    for ev in edb.execute("SELECT * FROM evidence WHERE source_id = %s", (source["id"],)).fetchall():
        assert text[ev["char_start"]:ev["char_end"]] == ev["quote"]
