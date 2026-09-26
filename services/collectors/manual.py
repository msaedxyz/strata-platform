"""Manual collector: an analyst uploads a file or a URL. Source: docs/04-ingestion.md, collectors table.

The known gaps (for example the Government Gazette and the PACRA register) come in this way.
A URL goes through the same HTTP client as the other collectors, so robots.txt, the rate limit and the
google_news_only guard apply. Until Mohamed sets the licence of a source, the licence is verify_then_purge.
"""

from __future__ import annotations

from collections.abc import Callable

import psycopg

from services.common.ids import new_id

from .base import CollectContext
from .brief import BriefSource, active_brief, retention_for
from .http import FetchResult, HttpClient
from .pipeline import Document, IngestContext, IngestResult, ingest
from .text import normalise
from .web import document_from_response

MANUAL_SOURCE_ID = "manual"
DEFAULT_LICENCE = "verify_then_purge"


class ManualUploadError(ValueError):
    pass


def _context(conn: psycopg.Connection, licence_code: str | None, publisher: str | None,
             client: HttpClient | None) -> tuple[dict, CollectContext, str, str]:
    brief = active_brief(conn)
    if brief is None:
        raise ManualUploadError("no active brief")
    content = brief["content"]
    licence = licence_code or DEFAULT_LICENCE
    if licence not in content["licences"]:
        raise ManualUploadError(f"unknown licence code {licence}")
    retention = retention_for(content, licence)
    source = BriefSource(id=MANUAL_SOURCE_ID, name="Manual upload", kind="web", url="", schedule="manual",
                         licence_code=licence, retention_policy=retention, section="manual", publisher=publisher)
    client = client or HttpClient(google_news_only=list(content.get("google_news_only") or []))
    ctx = CollectContext(conn=conn, client=client, source=source, brief=content)
    return brief, ctx, licence, retention


def _ingest(conn, brief: dict, licence: str, retention: str, doc: Document,
            enqueue: Callable[[str], None] | None) -> IngestResult:
    ctx = IngestContext(brief_version_id=brief["id"], brief_source_id=MANUAL_SOURCE_ID, licence_code=licence,
                        retention_policy=retention, enqueue=enqueue)
    return ingest(conn, doc, ctx)


def _default_enqueue(source_id: str) -> None:
    from services.queue import defer_enrichment

    defer_enrichment(source_id)


def ingest_file(
    conn: psycopg.Connection,
    *,
    data: bytes,
    filename: str,
    content_type: str | None,
    user_id: str,
    title: str | None = None,
    publisher: str | None = None,
    licence_code: str | None = None,
    url: str | None = None,
    enqueue: Callable[[str], None] | None = _default_enqueue,
) -> IngestResult:
    brief, ctx, licence, retention = _context(conn, licence_code, publisher, None)
    ctx.client.close()
    target = url or f"upload://{new_id()}/{filename}"
    ctype = (content_type or "").split(";")[0].strip().lower()
    if ctype in ("text/plain", "text/markdown", "text/csv") or filename.lower().endswith((".txt", ".md", ".csv")):
        text = data.decode("utf-8", errors="replace")
        doc = Document(url=target, source_type="manual", text=text,
                       title=title or next((line for line in normalise(text).split("\n") if line), None),
                       publisher=publisher, raw=data, raw_content_type=ctype or "text/plain")
    else:
        result = FetchResult(url=target, status=200, content=data, headers={"content-type": ctype})
        doc = document_from_response(ctx, result, target)
        if doc is None:
            raise ManualUploadError("the file gives no text")
        doc.source_type = "manual"
    if title:
        doc.title = title
    doc.metadata.update(kind="file", filename=filename, uploaded_by=user_id, content_type=ctype or None)
    return _ingest(conn, brief, licence, retention, doc, enqueue)


def ingest_url(
    conn: psycopg.Connection,
    *,
    url: str,
    user_id: str,
    title: str | None = None,
    publisher: str | None = None,
    licence_code: str | None = None,
    client: HttpClient | None = None,
    enqueue: Callable[[str], None] | None = _default_enqueue,
) -> IngestResult:
    brief, ctx, licence, retention = _context(conn, licence_code, publisher, client)
    try:
        result = ctx.fetch(url, conditional=False)
    finally:
        if client is None:
            ctx.client.close()
    doc = document_from_response(ctx, result, url)
    if doc is None:
        raise ManualUploadError("the page gives no text")
    doc.source_type = "manual"
    if title:
        doc.title = title
    doc.metadata.update(kind="url", uploaded_by=user_id)
    return _ingest(conn, brief, licence, retention, doc, enqueue)
