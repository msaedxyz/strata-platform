"""Fixtures and helpers for the enrichment tests (docs/05-enrichment.md). conftest.py imports the fixtures.

Each enrichment test module gets a fresh database with brief v1 active and the governance start-up step
done, so that the watched sites and organisations of v1 are canonical entities.
"""

from __future__ import annotations

import itertools
from datetime import UTC, datetime

import pytest

_COUNTER = itertools.count(1)


@pytest.fixture(scope="module")
def edb_setup(fresh_db) -> dict:
    """Brief v1 active, watch lists loaded as entities (services/governance/bootstrap.py)."""
    from services.collectors.brief import load_brief_files
    from services.common.db import connect
    from services.governance.bootstrap import bootstrap_brief

    with connect(fresh_db["app_url"]) as conn:
        load_brief_files(conn)
        conn.commit()
        result = bootstrap_brief(conn)
        conn.commit()
    return {**fresh_db, "bootstrap": result}


@pytest.fixture
def edb(edb_setup):
    from services.common.db import connect

    conn = connect(edb_setup["app_url"])
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


def add_source(conn, text: str, *, title: str | None = None, source_type: str = "rss", url: str | None = None,
               publisher: str = "Synthetic Test Wire", published_at: datetime | None = None,
               retention_policy: str = "verify_then_purge", licence_code: str = "verify_then_purge",
               read_at_source: bool = False, brief_source_id: str | None = None, metadata: dict | None = None) -> dict:
    """Store a synthetic document through the collector pipeline (object storage, NFC text, source row)."""
    from services.collectors.brief import active_brief
    from services.collectors.pipeline import Document, IngestContext, ingest

    n = next(_COUNTER)
    brief = active_brief(conn)
    doc = Document(
        url=url or f"https://synthetic.test/article/{n}",
        source_type=source_type,
        text=text,
        title=title if title is not None else text.split("\n", 1)[0],
        publisher=publisher,
        published_at=published_at or datetime(2026, 9, 20, 8, 0, tzinfo=UTC),
        read_at_source=read_at_source,
        metadata=metadata or {"synthetic": True},
    )
    ctx = IngestContext(brief_version_id=brief["id"] if brief else None, brief_source_id=brief_source_id,
                        licence_code=licence_code, retention_policy=retention_policy, enqueue=None,
                        now=datetime(2026, 9, 21, 6, 0, tzinfo=UTC))
    result = ingest(conn, doc, ctx)
    assert result.source_id, result
    return conn.execute("SELECT * FROM source WHERE id = %s", (result.source_id,)).fetchone()


def enrich_text(conn, text: str, backend=None, force: bool = False, **kw) -> tuple[dict, dict]:
    from services.enrichment.backends import DeterministicBackend
    from services.enrichment.pipeline import enrich

    source = add_source(conn, text, **kw)
    result = enrich(conn, source["id"], backend=backend or DeterministicBackend(), force=force)
    return source, result


def proposals_of(conn, source_id: str) -> list[dict]:
    return conn.execute("SELECT * FROM proposal WHERE source_id = %s ORDER BY created_at, id", (source_id,)).fetchall()


def events_of(conn, stream_type: str, stream_id: str) -> list[dict]:
    return conn.execute("SELECT * FROM event WHERE stream_type = %s AND stream_id = %s ORDER BY sequence",
                        (stream_type, stream_id)).fetchall()


def site_id(conn, key: str) -> str:
    return conn.execute("SELECT id FROM entity WHERE type = 'site' AND brief_key = %s", (key,)).fetchone()["id"]


def org_id(conn, key: str) -> str:
    return conn.execute("SELECT id FROM entity WHERE type = 'organisation' AND brief_key = %s", (key,)).fetchone()["id"]
