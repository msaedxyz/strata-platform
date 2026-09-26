"""The job queue: a Procrastinate App on the PsycopgConnector. The queue tables are in schema public.

Tasks:
- collect_source(brief_source_id): collect one source of the active brief.
- enrich_source(source_id): the enrichment agents (services/enrichment/tasks.py, M3).
- purge_expired_text(): delete the text of verify_then_purge sources after the verification period.
- dispatch_due_sources(): defer a collect job for each due source. The worker runs it every minute.

services/worker.py runs the worker. Code outside the worker defers jobs with defer(), which uses a
synchronous connector, so that a web request or a collector thread can put a job on the queue.
"""

from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime

from procrastinate import App, PsycopgConnector, SyncPsycopgConnector
from procrastinate import exceptions as pq_exceptions
from procrastinate import manager as pq_manager
from procrastinate import tasks as pq_tasks

from services.common.config import load_yaml
from services.common.db import connect
from services.common.logging import log
from services.common.settings import get_settings

logger = logging.getLogger("strata.queue")

_CFG = load_yaml("collectors.yaml")

# The worker replaces this connector with one for STRATA_DATABASE_URL (see services/worker.py).
app = App(connector=PsycopgConnector(), import_paths=["services.queue", "services.enrichment.tasks"])

QUEUE_COLLECT = "collect"
QUEUE_ENRICH = "enrich"
QUEUE_MAINTENANCE = "maintenance"


# ---------- deferring from synchronous code ----------

_managers: dict[str, pq_manager.JobManager] = {}
_managers_lock = threading.Lock()


def _job_manager() -> pq_manager.JobManager:
    url = get_settings().database_url
    with _managers_lock:
        manager = _managers.get(url)
        if manager is None:
            connector = SyncPsycopgConnector(conninfo=url, min_size=1, max_size=4)
            connector.open()
            manager = pq_manager.JobManager(connector=connector)
            _managers[url] = manager
    return manager


def close_queue() -> None:
    with _managers_lock:
        for manager in _managers.values():
            manager.connector.close()
        _managers.clear()


def defer(task_name: str, *, queue: str, queueing_lock: str | None = None, delay_seconds: int = 0,
          **task_kwargs) -> int | None:
    """Put a job on the queue. Returns the job id, or None when a job with the same queueing lock waits."""
    options: dict = {"queue": queue, "queueing_lock": queueing_lock, "task_kwargs": task_kwargs}
    if delay_seconds:
        options["schedule_in"] = {"seconds": delay_seconds}
    deferrer = pq_tasks.configure_task(name=task_name, job_manager=_job_manager(), **options)
    try:
        return deferrer.defer()
    except pq_exceptions.AlreadyEnqueued:
        return None


def defer_enrichment(source_id: str) -> int | None:
    return defer("enrich_source", queue=QUEUE_ENRICH, queueing_lock=f"enrich:{source_id}", source_id=source_id)


def defer_collect(brief_source_id: str, delay_seconds: int = 0) -> int | None:
    return defer("collect_source", queue=QUEUE_COLLECT, queueing_lock=f"collect:{brief_source_id}",
                 delay_seconds=delay_seconds, brief_source_id=brief_source_id)


# ---------- tasks ----------


@app.task(name="collect_source", queue=QUEUE_COLLECT)
def collect_source(brief_source_id: str) -> dict:
    from services.collectors.runner import run_source

    with connect() as conn:
        result = run_source(conn, brief_source_id)
    return {"status": result.status, "found": result.found, "new": result.new, "error": result.error}


@app.periodic(cron=_CFG["purge_cron"], periodic_id="purge")
@app.task(name="purge_expired_text", queue=QUEUE_MAINTENANCE)
def purge_expired_text(timestamp: int | None = None) -> int:
    from services.collectors.retention import purge_expired_text as purge

    with connect() as conn:
        return purge(conn)


@app.periodic(cron=_CFG["dispatcher_cron"], periodic_id="dispatch")
@app.task(name="dispatch_due_sources", queue=QUEUE_MAINTENANCE)
def dispatch_due_sources(timestamp: int | None = None) -> list[str]:
    from services.collectors.schedule import dispatch_due

    now = datetime.fromtimestamp(timestamp, tz=UTC) if timestamp else datetime.now(UTC)
    with connect() as conn:
        deferred = dispatch_due(conn, now, lambda sid, delay: defer_collect(sid, delay) is not None)
    log(logger, logging.INFO, "dispatcher", due=len(deferred))
    return deferred


# The enrichment task module registers enrich_source on the same app.
import services.enrichment.tasks  # noqa: E402,F401
