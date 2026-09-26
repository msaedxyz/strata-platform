"""Source text and document data for the agents.

The agents and the evidence check read the normalised text from object storage (services/common/storage.py).
A source without stored text uses the text in its metadata (test sources), and a link_only source uses
its stored title and description (docs/04: Google News items keep the title and description only).
"""

from __future__ import annotations

import logging

import psycopg

from services.collectors.text import normalise
from services.common.logging import log
from services.common.storage import get_storage

from .analysis import Doc

logger = logging.getLogger("strata.enrichment.sources")


def load_text(source: dict) -> str | None:
    if source.get("text_uri"):
        try:
            return get_storage().get(source["text_uri"]).decode("utf-8")
        except (OSError, ValueError) as exc:
            log(logger, logging.WARNING, "source text not readable", source_id=source["id"], error=str(exc))
        except Exception as exc:  # the S3 client raises its own error classes
            log(logger, logging.WARNING, "source text not readable", source_id=source["id"], error=str(exc))
    metadata = source.get("metadata") or {}
    if metadata.get("text"):
        return normalise(metadata["text"])
    if source.get("retention_policy") == "link_only" and source.get("title"):
        parts = [source["title"], metadata.get("description") or ""]
        return normalise("\n\n".join(p for p in parts if p))
    return None


def brief_for(conn: psycopg.Connection, source: dict) -> dict:
    """The content of the active brief, else the brief that collected the source."""
    from services.collectors.brief import active_brief

    active = active_brief(conn)
    if active:
        return active["content"]
    if source.get("brief_version_id"):
        row = conn.execute("SELECT content FROM monitoring_brief_version WHERE id = %s", (source["brief_version_id"],)).fetchone()
        if row:
            return row["content"]
    return {}


def early_signal_ids(brief: dict) -> set[str]:
    return {s["id"] for s in ((brief.get("sources") or {}).get("early_signal") or [])}


def build_doc(source: dict, text: str, brief: dict) -> Doc:
    return Doc(
        text=text,
        title=source.get("title"),
        url=source.get("url"),
        publisher=source.get("publisher"),
        source_type=source.get("type") or "manual",
        source_id=source["id"],
        published_at=source.get("published_at"),
        fetched_at=source.get("fetched_at"),
        read_at_source=bool(source.get("read_at_source")),
        early_signal=bool(source.get("brief_source_id")) and source["brief_source_id"] in early_signal_ids(brief),
        brief=brief,
    )
