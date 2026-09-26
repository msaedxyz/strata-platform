"""Enrichment pipeline on the database: proposals, events, alerts, idempotency (docs/05-enrichment.md)."""

from __future__ import annotations

from .enrichment_support import enrich_text, proposals_of, site_id

ZEMA = """Public notice: Environmental Impact Statement for the proposed Kitumba Copper Project

The Zambia Environmental Management Agency (ZEMA) gives notice that the developer of the proposed Kitumba Copper Project in Mumbwa district, Central Province, has submitted an Environmental Impact Statement (EIS) for review.

The project includes an open pit mine, an underground mine, a concentrator with a capacity of 2.5 million tonnes of ore each year, a tailings storage facility and a 45 kilometre access road. The developer plans to start construction after the environmental approval and the grant of a large-scale mining licence.

Public disclosure meetings will take place at Mumbwa Council Chambers on 6 October 2026 and at Kitumba Primary School on 7 October 2026."""


def test_enrichment_writes_proposals_evidence_and_run_record(edb):
    source, result = enrich_text(edb, ZEMA, source_type="web")
    assert result["status"] == "in_scope", result
    props = proposals_of(edb, source["id"])
    kinds = {p["kind"] for p in props}
    assert {"SignalScored", "EntityIdentified"} <= kinds
    run = edb.execute("SELECT * FROM enrichment_run WHERE id = %s", (result["run_id"],)).fetchone()
    assert run["status"] == "in_scope"
    assert set(run["agent_statuses"]) == {"classifier", "extractor", "resolver", "lifecycle", "window_forecaster",
                                          "summariser", "scorer"}
    evidence = edb.execute("SELECT * FROM evidence WHERE source_id = %s", (source["id"],)).fetchall()
    assert evidence and all(e["verified"] for e in evidence)
    for e in evidence:
        assert ZEMA[e["char_start"]:e["char_end"]] == e["quote"]
    calls = edb.execute("SELECT * FROM agent_call_log WHERE source_id = %s", (source["id"],)).fetchall()
    assert {c["model_id"] for c in calls} == {"deterministic-v1"}
    assert {c["prompt_version"] for c in calls} == {"rules-v1"}


def test_second_run_does_not_duplicate_proposals_or_alerts(edb):
    from services.enrichment.backends import DeterministicBackend
    from services.enrichment.pipeline import enrich

    text = ZEMA.replace("Kitumba", "Kitumba").replace("2.5 million", "3.0 million")
    source, first = enrich_text(edb, text, source_type="web")
    before = len(proposals_of(edb, source["id"]))
    alerts_before = edb.execute("SELECT count(*) AS n FROM event WHERE event_type = 'AlertRaised'").fetchone()["n"]
    again = enrich(edb, source["id"], backend=DeterministicBackend())
    assert again["status"] == "already_enriched"
    forced = enrich(edb, source["id"], backend=DeterministicBackend(), force=True)
    assert forced["status"] == "in_scope"
    assert forced["counts"]["proposals"] == 0
    assert len(proposals_of(edb, source["id"])) == before
    assert edb.execute("SELECT count(*) AS n FROM event WHERE event_type = 'AlertRaised'").fetchone()["n"] == alerts_before


def test_sweep_enriches_sources_without_a_finished_run(edb):
    from services.enrichment.backends import DeterministicBackend
    from services.enrichment.pipeline import enrich_pending

    from .enrichment_support import add_source

    waiting = add_source(edb, "Diesel shortage in Kabwe\n\nFilling stations in Kabwe ran out of diesel.")
    results = enrich_pending(edb, backend=DeterministicBackend())
    assert waiting["id"] in {r["source_id"] for r in results}
    assert all(r["status"] in ("in_scope", "out_of_scope", "skipped", "quarantined") for r in results)
    assert not [r for r in enrich_pending(edb, backend=DeterministicBackend()) if r["source_id"] == waiting["id"]]


def test_the_brief_document_is_not_enriched(edb):
    from services.enrichment.backends import DeterministicBackend
    from services.enrichment.pipeline import enrich

    brief_source = edb.execute("SELECT id FROM source WHERE metadata->>'kind' = 'monitoring_brief'").fetchone()
    assert enrich(edb, brief_source["id"], backend=DeterministicBackend())["status"] in ("skipped", "already_enriched")
    assert enrich(edb, "no-such-source")["status"] == "not_found"


def test_watch_site_suspension_gives_pending_status(edb):
    text = ("Mines regulator suspends Mopani's Mufulira mine pending a compliance review\n\n"
            "The Mines Safety Department has suspended underground operations at the Mufulira mine of Mopani Copper "
            "Mines Plc in Mufulira district, Copperbelt Province.")
    source, result = enrich_text(edb, text)
    assert result["tier"] == 0
    sid = site_id(edb, "mopani_mufulira")
    row = edb.execute("SELECT status, status_pending FROM proj_entity WHERE id = %s", (sid,)).fetchone()
    assert row["status_pending"] == "suspended"
