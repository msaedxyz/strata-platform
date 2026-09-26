"""Licence and retention. Source: docs/04-ingestion.md, licence and retention.

full: keep the text. verify_then_purge: keep the text for the verification period
(STRATA_VERIFICATION_PERIOD_DAYS), then delete the text and the raw file. Keep the hashes, the excerpt
and the evidence quotes. link_only: keep the metadata, the excerpt, the evidence quotes and the link.
"""

from __future__ import annotations

import logging
from datetime import datetime

import psycopg

from services.common.logging import log
from services.common.storage import Storage, get_storage

logger = logging.getLogger("strata.collectors.retention")


def purge_expired_text(conn: psycopg.Connection, *, now: datetime | None = None, storage: Storage | None = None) -> int:
    """Delete the text and raw objects of verify_then_purge sources after the verification period."""
    storage = storage or get_storage()
    rows = conn.execute(
        """SELECT id, raw_uri, text_uri FROM source
           WHERE retention_policy = 'verify_then_purge' AND purged_at IS NULL
             AND purge_after <= coalesce(%s::timestamptz, clock_timestamp())
           ORDER BY purge_after LIMIT 1000""",
        (now,),
    ).fetchall()
    count = 0
    for row in rows:
        for uri in (row["raw_uri"], row["text_uri"]):
            if uri:
                storage.delete(uri)
        conn.execute(
            """UPDATE source SET raw_uri = NULL, text_uri = NULL, purged_at = coalesce(%s::timestamptz, clock_timestamp()),
                 metadata = metadata - 'text' WHERE id = %s""",
            (now, row["id"]),
        )
        conn.commit()
        count += 1
    if count:
        log(logger, logging.INFO, "expired text purged", sources=count)
    return count


def text_is_public(retention_policy: str) -> bool:
    """The API gives the full text only for a source with the policy full."""
    return retention_policy == "full"
