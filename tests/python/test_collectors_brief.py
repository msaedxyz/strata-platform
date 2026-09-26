"""docs/04-ingestion.md: Monitoring Brief versions, criteria 10 and 14, and the start-up steps.

The start-up job (services.common.bootstrap) loads brief v1, registers the watch lists as entities with
evidence spans in the brief text, loads the proposed sources as proposals and loads the snapshot.
"""

from __future__ import annotations

import copy
import re
from pathlib import Path

import pytest
import yaml

pytestmark = pytest.mark.db

REPO = Path(__file__).resolve().parents[2]
V1 = REPO / "config" / "monitoring-brief" / "v1.yaml"


def _v1() -> dict:
    return yaml.safe_load(V1.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def booted(fresh_db):
    from services.common import bootstrap

    bootstrap.run()
    bootstrap.run()  # idempotent
    return fresh_db


# ---------- criteria 10 and 14 (files only) ----------


def test_c04_10_v1_contains_no_from_argo_value_or_each_has_an_assumption():
    """Criterion 10: v1.yaml has no value "from_argo", or each remaining value has an assumption row."""
    text = V1.read_text(encoding="utf-8")
    remaining = text.count("from_argo")
    if remaining:
        assumptions = (REPO / "docs" / "assumptions.md").read_text(encoding="utf-8")
        ids = re.findall(r"id: (\w+)[^\n]*from_argo", text)
        assert len(ids) == remaining
        for source_id in ids:
            assert source_id in assumptions, f"{source_id} has from_argo and no row in docs/assumptions.md"
    else:
        assert "from_argo" not in yaml.safe_dump(_v1())


def test_c04_14_each_early_signal_type_is_collected_or_a_known_gap_with_a_reason():
    """Criterion 14: each of the nine early signal types is in sources.early_signal or in known_gaps."""
    from services.collectors.text import collectors_config

    brief = _v1()
    types = collectors_config()["early_signal_types"]
    assert len(types) == 9
    collected = {s["source_type"] for s in brief["sources"]["early_signal"]}
    gaps = {g["name"]: g for g in brief["known_gaps"]}
    for t in types:
        covered = collected & set(t["source_types"])
        gap_rows = [gaps[name] for name in t["known_gaps"] if name in gaps]
        assert covered or gap_rows, f"{t['code']} is neither collected nor a known gap"
        for g in gap_rows:
            assert g["reason"].strip(), f"known gap {g['name']} has no reason"
        if not covered:
            assert gap_rows, t["code"]
    # Each source type code in the brief maps to one of the nine types, or is the extra market_regulator type.
    mapped = {code for t in types for code in t["source_types"]}
    assert collected - mapped <= {"market_regulator"}


def test_c04_brief_v1_and_fixture_brief_pass_the_schema():
    from services.collectors.brief import validate_brief
    from tests.fixtures.server import fixture_brief_text

    validate_brief(_v1())
    validate_brief(yaml.safe_load(fixture_brief_text("http://localhost:8765")))


@pytest.mark.parametrize("mutate, message", [
    (lambda b: b.pop("sources"), "sources"),
    (lambda b: b["watch"]["daily"][0].update(site_class="castle"), "castle"),
    (lambda b: b["sources"]["news"][0].update(licence_code="nope"), "unknown licence code nope"),
    (lambda b: b["sources"]["news"][1].update(id=b["sources"]["news"][0]["id"]), "duplicate source ids"),
    (lambda b: b["google_news"]["queries"][0].update(schedule="sometimes"), "invalid schedule"),
    (lambda b: b["watch"]["daily"][0].update(operator="nobody_ltd"), "unknown organisation nobody_ltd"),
    (lambda b: b["watch"]["daily"][0].update(geometry={"lat": -12.1, "lon": 26.3}), "geometry"),
])
def test_c04_brief_schema_rejects_invalid_versions(mutate, message):
    from services.collectors.brief import BriefValidationError, validate_brief

    brief = _v1()
    mutate(brief)
    with pytest.raises(BriefValidationError) as err:
        validate_brief(brief)
    assert message in str(err.value) or any(message in e for e in err.value.errors)


def test_c04_brief_diff_matches_entries_by_id():
    from services.collectors.brief import diff

    old = _v1()
    new = copy.deepcopy(old)
    new["sources"]["news"][0]["schedule"] = "weekly"
    new["sources"]["news"].append({"id": "news_extra", "name": "Extra", "type": "rss", "url": "https://x.test/feed",
                                   "schedule": "daily", "licence_code": "verify_then_purge"})
    new["google_news_only"].remove("ft.com")
    changes = diff(old, new)
    paths = {(c["path"], c["op"]) for c in changes}
    assert (f"sources.news[id={old['sources']['news'][0]['id']}].schedule", "changed") in paths
    assert ("sources.news[id=news_extra]", "added") in paths
    assert any(c["path"] == "google_news_only" and c["removed"] == ["ft.com"] for c in changes)
    assert diff(old, copy.deepcopy(old)) == []


# ---------- start-up steps ----------


def test_c04_bootstrap_loads_v1_and_activates_it_once(booted, cdb):
    rows = cdb.execute("SELECT * FROM monitoring_brief_version").fetchall()
    assert [r["version"] for r in rows] == [1]
    assert rows[0]["content"]["name"] == _v1()["name"]
    activations = cdb.execute("SELECT * FROM brief_activation").fetchall()
    assert len(activations) == 1
    events = cdb.execute("SELECT * FROM event WHERE stream_type = 'brief' AND stream_id = 'main'").fetchall()
    assert [e["event_type"] for e in events] == ["BriefVersionActivated"]
    assert events[0]["payload"] == {"brief_version_id": rows[0]["id"], "version": 1}


def test_c04_bootstrap_registers_the_brief_text_as_a_full_source(booted, cdb):
    from services.collectors.text import normalise
    from services.common.storage import get_storage

    src = cdb.execute("SELECT * FROM source WHERE publisher = 'Strata Monitoring Brief v1'").fetchone()
    assert src["type"] == "manual" and src["licence_code"] == "full" and src["retention_policy"] == "full"
    assert get_storage().get(src["text_uri"]).decode() == normalise(V1.read_text(encoding="utf-8"))


def test_c04_bootstrap_creates_watch_list_entities_with_verified_evidence(booted, cdb):
    """Rule 1: each entity links to the brief text span that names it. Geometry only from the brief."""
    from services.common.storage import get_storage

    brief = _v1()
    sites = [(s, level) for level in ("daily", "weekly") for s in brief["watch"][level]]
    src = cdb.execute("SELECT * FROM source WHERE publisher = 'Strata Monitoring Brief v1'").fetchone()
    text = get_storage().get(src["text_uri"]).decode()
    entities = {(e["type"], e["brief_key"]): e for e in cdb.execute("SELECT * FROM entity").fetchall()}
    assert len([k for k in entities if k[0] == "site"]) == len(sites)
    assert len([k for k in entities if k[0] == "organisation"]) == len(brief["organisations"])
    # A site and an organisation can share an id in the brief.
    assert ("site", "tazara") in entities and ("organisation", "tazara") in entities
    null_geometry = 0
    for site, level in sites:
        e = entities[("site", site["id"])]
        assert e["watch"] == level and e["site_class"] == site["site_class"]
        if site["geometry"] is None:
            assert e["geometry"] is None and e["geometry_source"] is None
            null_geometry += 1
        else:
            assert e["geometry_source"]["dataset"] == site["geometry"]["dataset"]
            assert e["geometry_source"]["licence"] == site["geometry"]["licence"]
            assert e["geometry_source"]["approximate"] == site["geometry"]["approximate"]
            point = cdb.execute("SELECT ST_X(geometry) AS lon, ST_Y(geometry) AS lat FROM entity WHERE id = %s",
                                (e["id"],)).fetchone()
            assert point["lat"] == pytest.approx(site["geometry"]["lat"]) and point["lon"] == pytest.approx(site["geometry"]["lon"])
        ev = cdb.execute("SELECT * FROM event WHERE stream_type = 'entity' AND stream_id = %s "
                         "AND event_type = 'EntityIdentified'", (e["id"],)).fetchall()
        assert len(ev) == 1 and ev[0]["payload"]["name"] == site["name"]
        evidence = cdb.execute("SELECT * FROM evidence WHERE id = ANY(%s)", (ev[0]["evidence_ids"],)).fetchall()
        assert len(evidence) == 1
        span = evidence[0]
        assert span["verified"] and span["source_id"] == src["id"]
        assert text[span["char_start"]:span["char_end"]] == span["quote"]
        assert site["name"] in span["quote"] and len(span["quote"]) <= 500
    assert null_geometry == sum(1 for s, _ in sites if s["geometry"] is None)
    projected = cdb.execute("SELECT count(*) AS n FROM proj_entity WHERE type = 'site'").fetchone()["n"]
    assert projected == len(sites)


def test_c04_bootstrap_creates_operator_and_owner_relationships(booted, cdb):
    brief = _v1()
    expected = sum((1 if s.get("operator") else 0) + len(s.get("owners") or [])
                   for level in ("daily", "weekly") for s in brief["watch"][level])
    rels = cdb.execute("SELECT * FROM event WHERE event_type = 'RelationshipAsserted'").fetchall()
    assert len(rels) == expected
    assert {r["payload"]["predicate"] for r in rels} == {"operates", "owns"}
    kansanshi = cdb.execute("SELECT id FROM entity WHERE type = 'site' AND brief_key = 'kansanshi'").fetchone()["id"]
    fqm = cdb.execute("SELECT id FROM entity WHERE type = 'organisation' AND brief_key = 'first_quantum'").fetchone()["id"]
    owns = [r for r in rels if r["payload"] == {"subject_id": fqm, "predicate": "owns", "object_id": kansanshi}]
    assert len(owns) == 1
    quote = cdb.execute("SELECT quote FROM evidence WHERE id = %s", (owns[0]["evidence_ids"][0],)).fetchone()["quote"]
    assert "first_quantum" in quote and "Kansanshi mine" in quote
    assert cdb.execute("SELECT count(*) AS n FROM check_hash_chain()").fetchone()["n"] == 0


def test_c04_bootstrap_loads_the_two_proposed_sources_as_admin_proposals(booted, cdb):
    """Sources that an agent finds, step 4: the two entries in sources.proposed become proposals."""
    brief = _v1()
    rows = cdb.execute("SELECT * FROM proposal WHERE kind = 'SourceProposed' ORDER BY title").fetchall()
    assert len(rows) == 2
    assert {r["events"][0]["payload"]["source"]["id"] for r in rows} == {s["id"] for s in brief["sources"]["proposed"]}
    for r in rows:
        assert r["policy"] == "admin_review" and r["status"] == "pending" and r["evidence_ids"]
        created = cdb.execute("SELECT * FROM event WHERE stream_type = 'proposal' AND stream_id = %s", (r["id"],)).fetchall()
        assert [e["event_type"] for e in created] == ["ProposalCreated"]


def test_c04_bootstrap_loads_the_snapshot_once_as_link_only_sources(booted, cdb):
    items = (REPO / "data" / "snapshots" / "2026-09-26" / "items.jsonl").read_text(encoding="utf-8").splitlines()
    runs = cdb.execute("SELECT * FROM collector_run WHERE brief_source_id = 'snapshot:2026-09-26'").fetchall()
    assert len(runs) == 1 and runs[0]["status"] == "success" and runs[0]["documents_found"] == len(items)
    snaps = cdb.execute("SELECT * FROM source WHERE type = 'snapshot'").fetchall()
    assert len(snaps) == runs[0]["documents_new"]
    assert all(s["read_at_source"] and s["retention_policy"] == "link_only" for s in snaps)
    month = [s for s in snaps if s["metadata"].get("date_precision") == "month"]
    for s in month:
        assert s["published_at"].day == 1
    assert cdb.execute("SELECT count(*) AS n FROM source_url WHERE brief_source_id = 'snapshot:2026-09-26'"
                       ).fetchone()["n"] >= len(snaps)
    # Each new snapshot source has an enrichment job on the queue.
    jobs = cdb.execute("SELECT count(*) AS n FROM public.procrastinate_jobs WHERE task_name = 'enrich_source'").fetchone()
    assert jobs["n"] == len(snaps)
