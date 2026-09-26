"""Snapshot collector: loads data/snapshots/*/items.jsonl as sources of type snapshot.

The build environment cannot reach the live sources. A research snapshot of real items fills the
dashboard until the collectors run on a machine with normal network access. Each item is like a Google
News item: title, link, publisher and date only. The licence is link_only and read_at_source is true.
A date "YYYY-MM" gives the first day of the month and the metadata date_precision month.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from services.common.ids import new_id
from services.common.logging import log, setup_logging
from services.common.settings import REPO_ROOT

from .brief import active_brief, retention_for
from .pipeline import Document, IngestContext, ingest
from .text import collectors_config

logger = logging.getLogger("strata.collectors.snapshot")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MONTH = re.compile(r"^\d{4}-\d{2}$")


def parse_snapshot_date(value: str | None) -> tuple[datetime | None, str | None]:
    if not value:
        return None, None
    if _DAY.match(value):
        return datetime.fromisoformat(value).replace(tzinfo=UTC), "day"
    if _MONTH.match(value):
        return datetime.fromisoformat(value + "-01").replace(tzinfo=UTC), "month"
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None, None
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)), "time"


def snapshot_dirs() -> list[Path]:
    root = REPO_ROOT / collectors_config()["snapshot"]["dir"]
    return sorted(p for p in root.glob("*") if (p / "items.jsonl").is_file())


def load_snapshot(
    conn: psycopg.Connection, directory: Path, *, enqueue: Callable[[str], None] | None = None
) -> dict:
    """Load one snapshot directory. Idempotent: a snapshot that loaded before is skipped."""
    source_id = f"snapshot:{directory.name}"
    done = conn.execute(
        "SELECT 1 FROM collector_run WHERE brief_source_id = %s AND status = 'success' LIMIT 1", (source_id,)
    ).fetchone()
    if done:
        return {"snapshot": directory.name, "status": "already_loaded"}
    brief = active_brief(conn)
    if brief is None:
        raise RuntimeError("no active brief: load the brief first")
    licence = collectors_config()["snapshot"]["licence_code"]
    retention = retention_for(brief["content"], licence)
    run_id = new_id()
    conn.execute(
        "INSERT INTO collector_run (id, brief_version_id, brief_source_id, status) VALUES (%s, %s, %s, 'running')",
        (run_id, brief["id"], source_id),
    )
    conn.commit()
    ctx = IngestContext(brief_version_id=brief["id"], brief_source_id=source_id, licence_code=licence,
                        retention_policy=retention, enqueue=enqueue)
    counts = {"found": 0, "new": 0, "duplicate": 0}
    with open(directory / "items.jsonl", encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            item = json.loads(line)
            counts["found"] += 1
            published_at, precision = parse_snapshot_date(item.get("published_at"))
            doc = Document(
                url=item["url"],
                source_type="snapshot",
                text=item["title"],
                title=item["title"],
                publisher=item.get("publisher"),
                published_at=published_at,
                read_at_source=True,
                metadata={
                    "snapshot": directory.name,
                    "snapshot_id": item.get("id"),
                    "search_query": item.get("search_query"),
                    "topic": item.get("topic"),
                    "date_basis": item.get("date_basis"),
                    "date_precision": precision,
                },
            )
            result = ingest(conn, doc, ctx)
            if result.status in ("new", "near_duplicate"):
                counts["new"] += 1
            else:
                counts["duplicate"] += 1
    conn.execute(
        """UPDATE collector_run SET status = 'success', finished_at = clock_timestamp(), documents_found = %s,
             documents_new = %s, documents_duplicate = %s, detail = %s WHERE id = %s""",
        (counts["found"], counts["new"], counts["duplicate"], Jsonb({"dir": str(directory.name)}), run_id),
    )
    conn.commit()
    return {"snapshot": directory.name, "status": "loaded", **counts}


def bootstrap() -> None:
    """Load each snapshot once. The compose migrate service calls this."""
    from services.common.db import connect
    from services.queue import defer_enrichment

    setup_logging()

    def enqueue(source_id: str) -> None:
        defer_enrichment(source_id)

    with connect() as conn:
        for directory in snapshot_dirs():
            result = load_snapshot(conn, directory, enqueue=enqueue)
            log(logger, logging.INFO, "snapshot", **result)
