"""Enrichment jobs (docs/05-enrichment.md).

The collectors put one enrich_source job on the queue for each new source. The task runs the seven agents
through services/enrichment/pipeline.enrich. A job for a source that has a finished run returns
"already_enriched", so the stub jobs of M2 and repeated jobs are safe.
"""

from __future__ import annotations

import logging

from services.common.db import connect
from services.common.logging import log
from services.queue import QUEUE_ENRICH, app

logger = logging.getLogger("strata.enrichment")


@app.task(name="enrich_source", queue=QUEUE_ENRICH)
def enrich_source(source_id: str) -> dict:
    from .pipeline import enrich

    with connect() as conn:
        result = enrich(conn, source_id)
    log(logger, logging.INFO, "enrich_source", **{k: v for k, v in result.items() if k != "counts"})
    return result
