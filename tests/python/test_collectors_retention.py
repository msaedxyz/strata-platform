"""docs/04-ingestion.md criterion 9 and the licence and retention table."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from .collector_support import activate_fixture_brief, run_fixture

pytestmark = pytest.mark.db

FETCHED = datetime(2026, 9, 1, 8, 0, tzinfo=UTC)


@pytest.fixture(scope="module")
def collected(fresh_db, fixture_server, fake_clock):
    from services.common.db import connect

    with connect(fresh_db["app_url"]) as conn:
        activate_fixture_brief(conn, fixture_server)
        results, _ = run_fixture(conn, fixture_server, fake_clock, now=FETCHED)
    assert all(r.status == "success" for r in results)
    return results


def _by_policy(conn, policy):
    return conn.execute("SELECT * FROM source WHERE retention_policy = %s ORDER BY id", (policy,)).fetchall()


def test_c04_09_verify_then_purge_source_has_no_text_after_the_verification_period(collected, cdb):
    """Criterion 9: after the verification period, a verify_then_purge source has no text in storage."""
    from services.collectors.retention import purge_expired_text
    from services.common.settings import get_settings
    from services.common.storage import get_storage

    storage = get_storage()
    period = timedelta(days=get_settings().verification_period_days)
    sources = _by_policy(cdb, "verify_then_purge")
    assert sources
    for s in sources:
        assert s["purge_after"] == FETCHED + period
        assert storage.exists(s["text_uri"])
    kept = {s["id"]: s for s in sources}

    # One day before the end of the period nothing is purged.
    assert purge_expired_text(cdb, now=FETCHED + period - timedelta(days=1)) == 0
    assert all(storage.exists(s["text_uri"]) for s in sources)

    assert purge_expired_text(cdb, now=FETCHED + period + timedelta(minutes=1)) == len(sources)
    for s in _by_policy(cdb, "verify_then_purge"):
        before = kept[s["id"]]
        assert s["text_uri"] is None and s["raw_uri"] is None and s["purged_at"] is not None
        assert not storage.exists(before["text_uri"])
        if before["raw_uri"]:
            assert not storage.exists(before["raw_uri"])
        # The hashes and the excerpt stay.
        assert s["content_hash"] == before["content_hash"] and s["simhash"] == before["simhash"]
        assert s["excerpt"] == before["excerpt"]


def test_c04_09_full_and_link_only_sources_keep_their_text(collected, cdb):
    from services.common.storage import get_storage

    storage = get_storage()
    full = _by_policy(cdb, "full")
    assert full and all(s["purge_after"] is None and storage.exists(s["text_uri"]) for s in full)
    link_only = _by_policy(cdb, "link_only")
    assert link_only
    for s in link_only:
        assert s["raw_uri"] is None and s["purge_after"] is None
        text = storage.get(s["text_uri"]).decode()
        assert len(text.split("\n\n")) <= 2  # title and description only


def test_c04_09_purged_source_still_deduplicates(collected, cdb, fixture_server, fake_clock):
    """The hash stays after the purge, so the same document does not come back as a new source."""
    cdb.execute("DELETE FROM fetch_state")
    cdb.commit()
    results, _ = run_fixture(cdb, fixture_server, fake_clock)
    assert sum(r.new for r in results) == 0


def test_c04_09_evidence_quotes_stay_after_the_purge(collected, cdb):
    from services.collectors.retention import purge_expired_text
    from services.common.ids import new_id, sha256_hex

    s = cdb.execute("SELECT * FROM source WHERE retention_policy = 'verify_then_purge' LIMIT 1").fetchone()
    quote = s["excerpt"][:40]
    eid = new_id()
    cdb.execute("INSERT INTO evidence (id, source_id, char_start, char_end, quote, quote_hash, verified) "
                "VALUES (%s, %s, 0, %s, %s, %s, true)", (eid, s["id"], len(quote), quote, sha256_hex(quote)))
    cdb.commit()
    purge_expired_text(cdb, now=datetime.now(UTC) + timedelta(days=400))
    assert cdb.execute("SELECT quote FROM evidence WHERE id = %s", (eid,)).fetchone()["quote"] == quote
