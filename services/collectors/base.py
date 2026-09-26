"""Shared parts of the collectors: the collect context and the conditional GET state."""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import psycopg

from .brief import BriefSource
from .http import FetchError, FetchResult, HttpClient
from .pipeline import Document


class CollectError(Exception):
    pass


@dataclass
class CollectContext:
    conn: psycopg.Connection
    client: HttpClient
    source: BriefSource
    brief: dict
    pending_state: list[tuple[str, FetchResult]] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)

    @property
    def link_only(self) -> bool:
        return self.source.retention_policy == "link_only"

    def fetch(self, url: str, *, conditional: bool = True) -> FetchResult:
        etag = last_modified = None
        if conditional:
            row = self.conn.execute("SELECT etag, last_modified FROM fetch_state WHERE url = %s", (url,)).fetchone()
            if row:
                etag, last_modified = row["etag"], row["last_modified"]
        result = self.client.fetch(url, rate_limit_seconds=self.source.rate_limit_seconds, etag=etag,
                                   last_modified=last_modified)
        if conditional:
            self.pending_state.append((url, result))
        return result

    def save_state(self) -> None:
        """Save the validators after the documents of the responses are stored."""
        for url, result in self.pending_state:
            self.conn.execute(
                """INSERT INTO fetch_state (url, etag, last_modified, last_status, last_fetched_at)
                   VALUES (%s, %s, %s, %s, now())
                   ON CONFLICT (url) DO UPDATE SET
                     etag = CASE WHEN EXCLUDED.last_status = 304 THEN fetch_state.etag ELSE EXCLUDED.etag END,
                     last_modified = CASE WHEN EXCLUDED.last_status = 304 THEN fetch_state.last_modified
                                          ELSE EXCLUDED.last_modified END,
                     last_status = EXCLUDED.last_status, last_fetched_at = now()""",
                (url, result.etag, result.last_modified, result.status),
            )
        self.pending_state.clear()
        self.conn.commit()

    def skip(self, url: str, reason: str) -> None:
        self.skipped.append({"url": url, "reason": reason})

    def fail(self, url: str, error: Exception) -> None:
        self.errors.append({"url": url, "error": str(error)})


def struct_to_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime(*value[:6], tzinfo=UTC)
    except (TypeError, ValueError):
        return None


def parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    from dateutil import parser as dateparser

    try:
        parsed = dateparser.parse(value)
    except (ValueError, OverflowError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


def raw_json(data: dict) -> bytes:
    return json.dumps(data, ensure_ascii=False, default=str, sort_keys=True).encode("utf-8")


Collector = Iterator[Document]
__all__ = ["CollectContext", "CollectError", "Collector", "FetchError", "parse_date", "raw_json",
           "struct_to_datetime"]
