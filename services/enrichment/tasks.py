"""Enrichment jobs (docs/05-enrichment.md).

The collectors put one enrich_source job on the queue for each new source. The task runs the seven agents
through services/enrichment/pipeline.enrich. A job for a source that has a finished run returns
"already_enriched", so the stub jobs of M2 and repeated jobs are safe.

The periodic task enrich_pending enriches each source without a finished run, for example a source whose
job was not queued because the queue was not reachable (M2 risk 6).
"""

from __future__ import annotations

import logging

from services.common.config import load_yaml
from services.common.db import connect
from services.common.logging import log
from services.queue import QUEUE_ENRICH, QUEUE_MAINTENANCE, app

logger = logging.getLogger("strata.enrichment")
_PIPELINE = load_yaml("enrichment-rules.yaml")["pipeline"]


@app.task(name="enrich_source", queue=QUEUE_ENRICH)
def enrich_source(source_id: str) -> dict:
    from .pipeline import enrich

    with connect() as conn:
        result = enrich(conn, source_id)
    log(logger, logging.INFO, "enrich_source", **{k: v for k, v in result.items() if k != "counts"})
    return result


@app.periodic(cron=_PIPELINE["sweep_cron"], periodic_id="enrich_sweep")
@app.task(name="enrich_pending", queue=QUEUE_MAINTENANCE)
def enrich_pending(timestamp: int | None = None) -> int:
    from .pipeline import enrich_pending as sweep

    with connect() as conn:
        results = sweep(conn, limit=int(_PIPELINE["sweep_limit"]))
    log(logger, logging.INFO, "enrichment sweep", sources=len(results))
    return len(results)
