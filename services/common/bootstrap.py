"""One-shot start-up job: migrations, then the steps that other services register.

docker compose runs this as the migrate service before the api and the worker start.
"""

from __future__ import annotations

import importlib
import logging

from .logging import log, setup_logging
from .migrate import migrate

logger = logging.getLogger("strata.bootstrap")

# Each step is "module:function". A step that does not exist yet is skipped.
STEPS = [
    "services.collectors.brief:bootstrap",       # load brief versions from config/monitoring-brief and activate
    "services.governance.bootstrap:bootstrap",   # watch-list entities, proposed sources
    "services.collectors.snapshot:bootstrap",    # real snapshot items when the live sources are not reachable
]


def run() -> None:
    setup_logging()
    applied = migrate()
    log(logger, logging.INFO, "migrations done", applied=applied)
    for step in STEPS:
        module_name, func_name = step.split(":")
        try:
            module = importlib.import_module(module_name)
        except ModuleNotFoundError:
            log(logger, logging.INFO, "bootstrap step not present", step=step)
            continue
        getattr(module, func_name)()
        log(logger, logging.INFO, "bootstrap step done", step=step)


if __name__ == "__main__":
    run()
