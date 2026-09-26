"""Enrichment jobs. M3 fills enrich_source with the agent pipeline (docs/05-enrichment.md).

The collectors put one enrich_source job on the queue for each new source. Until M3, the task only
checks that the source exists and logs it.
"""

from __future__ import annotations

import logging

from services.common.db import connect
from services.common.logging import log
from services.queue import QUEUE_ENRICH, app

logger = logging.getLogger("strata.enrichment")


@app.task(name="enrich_source", queue=QUEUE_ENRICH)
def enrich_source(source_id: str) -> dict:
    with connect() as conn:
        row = conn.execute("SELECT id, type, url FROM source WHERE id = %s", (source_id,)).fetchone()
    if row is None:
        log(logger, logging.WARNING, "enrich_source: source not found", source_id=source_id)
        return {"source_id": source_id, "status": "not_found"}
    log(logger, logging.INFO, "enrich_source: stub until M3", source_id=source_id, type=row["type"])
    return {"source_id": source_id, "status": "stub"}
