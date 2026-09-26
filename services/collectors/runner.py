"""Collector runs. Each run reads the active brief at its start and stamps its id on each source.

A failure of one source does not stop the other sources. Each run gets a collector_run row.
A fetch that fails after its retries gives a dead_letter row.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime

import psycopg
from psycopg.types.json import Jsonb

from services.common.ids import new_id
from services.common.logging import log
from services.common.storage import Storage

from .base import CollectContext
from .brief import BriefSource, active_brief, brief_sources
from .feeds import collect_feed, collect_google_news
from .http import FetchError, ForbiddenDomainError, HttpClient, RobotsDisallowedError
from .pipeline import IngestContext, ingest
from .web import collect_pdf, collect_web

logger = logging.getLogger("strata.collectors.runner")

COLLECTORS: dict[str, Callable[[CollectContext], Iterable]] = {
    "google_news": collect_google_news,
    "rss": collect_feed,
    "atom": collect_feed,
    "web": collect_web,
    "sitemap": collect_web,
    "pdf": collect_pdf,
}


@dataclass
class RunResult:
    brief_source_id: str
    status: str
    run_id: str | None = None
    brief_version_id: str | None = None
    found: int = 0
    new: int = 0
    duplicate: int = 0
    failed: int = 0
    error: str | None = None
    source_ids: list[str] = field(default_factory=list)


def default_enqueue(source_id: str) -> None:
    from services.queue import defer_enrichment

    defer_enrichment(source_id)


def _start_run(conn: psycopg.Connection, brief_version_id: str, source_id: str) -> str:
    run_id = new_id()
    conn.execute(
        "INSERT INTO collector_run (id, brief_version_id, brief_source_id, status) VALUES (%s, %s, %s, 'running')",
        (run_id, brief_version_id, source_id),
    )
    conn.commit()
    return run_id


def _finish_run(conn: psycopg.Connection, result: RunResult, attempts: int, detail: dict) -> None:
    conn.execute(
        """UPDATE collector_run SET finished_at = clock_timestamp(), status = %s, attempts = %s,
             documents_found = %s, documents_new = %s, documents_duplicate = %s, documents_failed = %s,
             error = %s, detail = %s WHERE id = %s""",
        (result.status, attempts, result.found, result.new, result.duplicate, result.failed, result.error,
         Jsonb(detail), result.run_id),
    )
    conn.commit()


def _dead_letter(conn: psycopg.Connection, source: BriefSource, error: str, attempts: int, run_id: str) -> None:
    conn.execute(
        "INSERT INTO dead_letter (id, job, payload, error, attempts) VALUES (%s, 'collect_source', %s, %s, %s)",
        (new_id(), Jsonb({"brief_source_id": source.id, "url": source.url, "run_id": run_id}), error, attempts),
    )
    conn.commit()


def run_brief_source(
    conn: psycopg.Connection,
    brief: dict,
    source: BriefSource,
    *,
    client: HttpClient,
    storage: Storage | None = None,
    enqueue: Callable[[str], None] | None = default_enqueue,
    now: datetime | None = None,
) -> RunResult:
    """Collect one source of the given brief version. Never raises for a source failure."""
    result = RunResult(brief_source_id=source.id, status="running", brief_version_id=brief["id"])
    result.run_id = _start_run(conn, brief["id"], source.id)
    # The guard always uses the google_news_only list of the brief of this run.
    client.google_news_only = list(brief["content"].get("google_news_only") or [])
    ctx = CollectContext(conn=conn, client=client, source=source, brief=brief["content"])
    ingest_ctx = IngestContext(
        brief_version_id=brief["id"], brief_source_id=source.id, licence_code=source.licence_code,
        retention_policy=source.retention_policy, storage=storage, enqueue=enqueue, now=now,
    )
    attempts = 1
    try:
        collector = COLLECTORS[source.kind]
        for doc in collector(ctx):
            result.found += 1
            try:
                outcome = ingest(conn, doc, ingest_ctx)
            except Exception as exc:  # one bad document does not stop the source
                conn.rollback()
                result.failed += 1
                ctx.fail(doc.url, exc)
                log(logger, logging.ERROR, "document failed", source=source.id, url=doc.url, error=str(exc))
                continue
            if outcome.status in ("new", "near_duplicate"):
                result.new += 1
                result.source_ids.append(outcome.source_id)
            elif outcome.status in ("duplicate_url", "known_url"):
                result.duplicate += 1
        attempts = max([1, *[r.attempts for _u, r in ctx.pending_state]])
        ctx.save_state()
        result.status = "success"
        if ctx.errors:
            result.error = "; ".join(f"{e['url']}: {e['error']}" for e in ctx.errors)[:2000]
    except (ForbiddenDomainError, RobotsDisallowedError) as exc:
        conn.rollback()
        result.status, result.error, attempts = "failed", str(exc), 1
    except FetchError as exc:
        conn.rollback()
        result.status, result.error, attempts = "failed", str(exc), exc.attempts
        _dead_letter(conn, source, str(exc), exc.attempts, result.run_id)
    except Exception as exc:  # a parser error or a bug: record it and continue with the other sources
        conn.rollback()
        result.status, result.error = "failed", f"{type(exc).__name__}: {exc}"
        _dead_letter(conn, source, result.error, attempts, result.run_id)
        log(logger, logging.ERROR, "collector failed", source=source.id, error=result.error)
    _finish_run(conn, result, attempts, {"skipped": ctx.skipped, "errors": ctx.errors, "url": source.url})
    log(logger, logging.INFO, "collector run done", source=source.id, status=result.status, found=result.found,
        new=result.new, duplicate=result.duplicate, failed=result.failed)
    return result


def make_client(brief_content: dict, **kw) -> HttpClient:
    return HttpClient(google_news_only=list(brief_content.get("google_news_only") or []), **kw)


def run_source(
    conn: psycopg.Connection,
    brief_source_id: str,
    *,
    client: HttpClient | None = None,
    google_news_base_url: str | None = None,
    **kw,
) -> RunResult:
    """Collect one source of the active brief. The collect_source job calls this."""
    brief = active_brief(conn)
    if brief is None:
        return RunResult(brief_source_id=brief_source_id, status="skipped", error="no active brief")
    source = next((s for s in brief_sources(brief["content"], google_news_base_url=google_news_base_url)
                   if s.id == brief_source_id), None)
    if source is None:
        run_id = new_id()
        conn.execute(
            "INSERT INTO collector_run (id, brief_version_id, brief_source_id, status, finished_at, error) "
            "VALUES (%s, %s, %s, 'skipped', clock_timestamp(), 'not in the active brief')",
            (run_id, brief["id"], brief_source_id),
        )
        conn.commit()
        return RunResult(brief_source_id=brief_source_id, status="skipped", run_id=run_id,
                         error="not in the active brief")
    own_client = client is None
    client = client or make_client(brief["content"])
    try:
        return run_brief_source(conn, brief, source, client=client, **kw)
    finally:
        if own_client:
            client.close()


def run_all(
    conn: psycopg.Connection,
    *,
    client: HttpClient | None = None,
    google_news_base_url: str | None = None,
    only: Iterable[str] | None = None,
    **kw,
) -> list[RunResult]:
    """Collect every source of the active brief once, in sequence. One failure does not stop the others."""
    brief = active_brief(conn)
    if brief is None:
        return []
    wanted = set(only) if only is not None else None
    own_client = client is None
    client = client or make_client(brief["content"])
    results = []
    try:
        for source in brief_sources(brief["content"], google_news_base_url=google_news_base_url):
            if wanted is not None and source.id not in wanted:
                continue
            results.append(run_brief_source(conn, brief, source, client=client, **kw))
    finally:
        if own_client:
            client.close()
    return results
