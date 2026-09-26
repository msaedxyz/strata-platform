"""Worker process: runs the job queue and the schedules.

The periodic task dispatch_due_sources runs every minute. It reads the active brief and defers a collect
job for each due source (daily: each day, weekly: each Monday, or the cron of the source, all in
Africa/Lusaka), with random jitter of up to 60 seconds. purge_expired_text runs each hour.
"""

from __future__ import annotations

import logging

from procrastinate import PsycopgConnector

from services.common.config import load_yaml
from services.common.logging import log, setup_logging
from services.common.settings import get_settings

logger = logging.getLogger("strata.worker")


def main() -> None:
    setup_logging()
    from services.queue import app

    cfg = load_yaml("collectors.yaml")["worker"]
    connector = PsycopgConnector(conninfo=get_settings().database_url, min_size=1, max_size=cfg["concurrency"] + 2)
    log(logger, logging.INFO, "worker starts", concurrency=cfg["concurrency"])
    with app.replace_connector(connector):
        app.run_worker(concurrency=cfg["concurrency"], wait=True, name="strata-worker")


if __name__ == "__main__":
    main()
