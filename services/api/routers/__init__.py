"""Each service track adds its router module here."""

from __future__ import annotations

import importlib
import logging
import pkgutil

from fastapi import FastAPI

logger = logging.getLogger("strata.api")


def include_routers(app: FastAPI) -> None:
    """Include every module in this package that defines `router`."""
    for info in sorted(pkgutil.iter_modules(__path__), key=lambda i: i.name):
        module = importlib.import_module(f"{__name__}.{info.name}")
        router = getattr(module, "router", None)
        if router is not None:
            app.include_router(router)
