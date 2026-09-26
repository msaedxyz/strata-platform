"""Schedules of the brief sources. Source: docs/04-ingestion.md, scheduling and health.

"daily" and "weekly" map to cron strings in config/collectors.yaml. A brief source can also give its
own cron string. All cron strings run in the Africa/Lusaka time zone (config/collectors.yaml).
A source is due when a scheduled time has passed since its last run. A source that never ran is due now.
"""

from __future__ import annotations

import logging
import random
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import psycopg
from croniter import croniter

from services.common.logging import log

from .brief import active_brief, brief_sources
from .text import collectors_config

logger = logging.getLogger("strata.collectors.schedule")


def timezone() -> ZoneInfo:
    return ZoneInfo(collectors_config()["timezone"])


def cron_for(schedule: str) -> str:
    return collectors_config()["schedules"].get(schedule, schedule)


def previous_fire(schedule: str, now: datetime) -> datetime:
    """The latest scheduled time at or before now, in the collector time zone."""
    local = now.astimezone(timezone()) + timedelta(seconds=1)
    return croniter(cron_for(schedule), local).get_prev(datetime)


def next_fire(schedule: str, now: datetime) -> datetime:
    local = now.astimezone(timezone())
    return croniter(cron_for(schedule), local).get_next(datetime)


def is_due(schedule: str, last_run_at: datetime | None, now: datetime) -> bool:
    if last_run_at is None:
        return True
    return last_run_at < previous_fire(schedule, now)


def last_runs(conn: psycopg.Connection) -> dict[str, datetime]:
    rows = conn.execute(
        "SELECT brief_source_id, max(started_at) AS at FROM collector_run WHERE status <> 'skipped' "
        "GROUP BY brief_source_id"
    ).fetchall()
    return {r["brief_source_id"]: r["at"] for r in rows}


def due_sources(conn: psycopg.Connection, now: datetime) -> list[str]:
    brief = active_brief(conn)
    if brief is None:
        return []
    last = last_runs(conn)
    return [s.id for s in brief_sources(brief["content"]) if is_due(s.schedule, last.get(s.id), now)]


def jitter_seconds() -> int:
    return random.randint(0, int(collectors_config()["jitter_seconds"]))


def dispatch_due(conn: psycopg.Connection, now: datetime, defer) -> list[str]:
    """Defer one collect job for each due source. `defer(source_id, delay_seconds)` puts it on the queue."""
    deferred = []
    for source_id in due_sources(conn, now):
        if defer(source_id, jitter_seconds()):
            deferred.append(source_id)
    if deferred:
        log(logger, logging.INFO, "collect jobs deferred", count=len(deferred))
    return deferred
