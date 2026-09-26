"""The pipeline for each document. Source: docs/04-ingestion.md, steps 1 to 10.

1. The collector fetches the document and extracts the text (steps 1 and 3).
2. ingest() stores the raw file and the normalised text in object storage (step 2).
3. It normalises the text to NFC with \\n line endings (step 4) and calculates content_hash and simhash (step 5).
4. An exact duplicate gives only a new source_url row (step 6). A near duplicate gets duplicate_of (step 7).
5. It detects the language (step 8), creates the source row (step 9) and puts an enrichment job on the queue (step 10).

Collected text is data. The pipeline never interprets it.
"""

from __future__ import annotations

import logging
import mimetypes
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from services.common.ids import new_id
from services.common.logging import log
from services.common.settings import get_settings
from services.common.storage import Storage, get_storage

from .text import collectors_config, content_hash, detect_language, excerpt, normalise, simhash

logger = logging.getLogger("strata.collectors.pipeline")


@dataclass
class Document:
    url: str
    source_type: str                     # rss, web, pdf, manual, google_news or snapshot
    text: str                            # extracted text; link_only sources give title and description only
    title: str | None = None
    publisher: str | None = None
    published_at: datetime | None = None
    raw: bytes | None = None
    raw_content_type: str | None = None
    page_map: list[dict] | None = None   # PDF: start offset of each page in the normalised text
    ocr: bool = False
    read_at_source: bool = False
    extra_urls: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class IngestContext:
    brief_version_id: str | None
    brief_source_id: str | None
    licence_code: str
    retention_policy: str
    storage: Storage | None = None
    enqueue: Callable[[str], None] | None = None
    now: datetime | None = None
    store_raw: bool = True


@dataclass
class IngestResult:
    status: str                          # new, near_duplicate, duplicate_url, known_url or empty
    source_id: str | None
    duplicate_of: str | None = None


def _ext(content_type: str | None, url: str) -> str:
    if content_type:
        guessed = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if guessed:
            return guessed
    tail = url.rsplit("/", 1)[-1]
    return "." + tail.rsplit(".", 1)[-1][:8] if "." in tail else ".bin"


def _add_url(conn: psycopg.Connection, source_id: str, url: str, brief_source_id: str | None) -> bool:
    row = conn.execute(
        "INSERT INTO source_url (id, source_id, url, brief_source_id) VALUES (%s, %s, %s, %s) "
        "ON CONFLICT (source_id, url) DO NOTHING RETURNING id",
        (new_id(), source_id, url, brief_source_id),
    ).fetchone()
    return row is not None


def find_near_duplicate(conn: psycopg.Connection, value: int, now: datetime | None = None) -> str | None:
    cfg = collectors_config()["pipeline"]
    row = conn.execute(
        """SELECT id FROM source
           WHERE simhash IS NOT NULL AND duplicate_of IS NULL
             AND fetched_at >= coalesce(%s::timestamptz, clock_timestamp()) - make_interval(days => %s)
             AND bit_count((simhash # %s)::bit(64)) <= %s
           ORDER BY bit_count((simhash # %s)::bit(64)), fetched_at LIMIT 1""",
        (now, cfg["near_duplicate_window_days"], value, cfg["hamming_distance"], value),
    ).fetchone()
    return row["id"] if row else None


def ingest(conn: psycopg.Connection, doc: Document, ctx: IngestContext) -> IngestResult:
    """Store one document. Commits the transaction, then puts the enrichment job on the queue."""
    text = normalise(doc.text or "")
    if not text:
        return IngestResult("empty", None)
    digest = content_hash(text)

    # Step 6: an exact duplicate gives only a new URL.
    existing = conn.execute(
        "SELECT id FROM source WHERE content_hash = %s ORDER BY fetched_at, id LIMIT 1", (digest,)
    ).fetchone()
    if existing:
        added = False
        for url in [doc.url, *doc.extra_urls]:
            added = _add_url(conn, existing["id"], url, ctx.brief_source_id) or added
        conn.commit()
        return IngestResult("duplicate_url" if added else "known_url", existing["id"])

    storage = ctx.storage or get_storage()
    source_id = new_id()
    # Step 2: raw file and normalised text in object storage.
    raw_uri = None
    if doc.raw is not None and ctx.store_raw and ctx.retention_policy != "link_only":
        raw_uri = storage.put(f"sources/{source_id}/raw{_ext(doc.raw_content_type, doc.url)}", doc.raw,
                              doc.raw_content_type or "application/octet-stream")
    text_uri = storage.put(f"sources/{source_id}/text.txt", text.encode("utf-8"), "text/plain; charset=utf-8")

    # Step 7: near duplicate.
    fingerprint = simhash(text)
    duplicate_of = find_near_duplicate(conn, fingerprint, ctx.now)
    language = detect_language(text)
    fetched_at = ctx.now
    purge_after = None
    if ctx.retention_policy == "verify_then_purge":
        base = fetched_at or datetime.now().astimezone()
        purge_after = base + timedelta(days=get_settings().verification_period_days)

    conn.execute(
        """INSERT INTO source (id, type, url, title, publisher, published_at, fetched_at, licence_code,
             retention_policy, brief_version_id, brief_source_id, content_hash, simhash, duplicate_of, raw_uri,
             text_uri, text_length, excerpt, page_map, language, ocr, read_at_source, purge_after, metadata)
           VALUES (%s, %s, %s, %s, %s, %s, coalesce(%s, clock_timestamp()), %s, %s, %s, %s, %s, %s, %s, %s,
             %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (source_id, doc.source_type, doc.url, doc.title, doc.publisher, doc.published_at, fetched_at,
         ctx.licence_code, ctx.retention_policy, ctx.brief_version_id, ctx.brief_source_id, digest, fingerprint,
         duplicate_of, raw_uri, text_uri, len(text), excerpt(text), Jsonb(doc.page_map) if doc.page_map else None,
         language, doc.ocr, doc.read_at_source, purge_after, Jsonb(doc.metadata)),
    )
    for url in dict.fromkeys([doc.url, *doc.extra_urls]):
        _add_url(conn, source_id, url, ctx.brief_source_id)
    conn.commit()
    log(logger, logging.INFO, "source created", source_id=source_id, url=doc.url, near_duplicate_of=duplicate_of)

    # Step 10: the enrichment job, after the commit so that the worker can read the row.
    if ctx.enqueue is not None:
        try:
            ctx.enqueue(source_id)
        except Exception as exc:  # the source stays; a later sweep can enqueue it
            log(logger, logging.ERROR, "enrichment job not queued", source_id=source_id, error=str(exc))
    return IngestResult("near_duplicate" if duplicate_of else "new", source_id, duplicate_of)
