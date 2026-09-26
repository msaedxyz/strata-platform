"""Structured JSON logs. Never log a secret."""

from __future__ import annotations

import json
import logging
import re
import sys
from datetime import UTC, datetime

from .settings import get_settings

_SECRET_KEYS = ("password", "secret", "token", "api_key", "authorization", "key")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        extra = getattr(record, "extra_fields", None)
        if isinstance(extra, dict):
            for k, v in extra.items():
                payload[k] = "[redacted]" if any(s in k.lower() for s in _SECRET_KEYS) else v
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


# Tokens in URLs, for example the access_token query parameter of the live stream (EventSource cannot send headers).
_TOKEN_IN_TEXT = re.compile(r"((?:access_token|id_token|refresh_token|token|code)=)[^&\s\"']+", re.IGNORECASE)
_BEARER = re.compile(r"(Bearer\s+)[A-Za-z0-9._~+/=-]+", re.IGNORECASE)


def redact_text(text: str) -> str:
    return _BEARER.sub(r"\1[redacted]", _TOKEN_IN_TEXT.sub(r"\1[redacted]", text))


class RedactFilter(logging.Filter):
    """Remove tokens from log messages and their arguments (CLAUDE.md rule 5)."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_text(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(redact_text(a) if isinstance(a, str) else a for a in record.args)
        elif isinstance(record.args, dict):
            record.args = {k: redact_text(v) if isinstance(v, str) else v for k, v in record.args.items()}
        return True


_REDACT = RedactFilter()
_LOGGERS_WITH_OWN_HANDLERS = ("uvicorn", "uvicorn.access", "uvicorn.error", "httpx", "httpx2", "httpcore")


def install_redaction() -> None:
    """Add the redaction filter to every handler that can write a request URL."""
    for name in ("", *_LOGGERS_WITH_OWN_HANDLERS):
        lg = logging.getLogger(name)
        if _REDACT not in lg.filters:
            lg.addFilter(_REDACT)
        for h in lg.handlers:
            if _REDACT not in h.filters:
                h.addFilter(_REDACT)


def setup_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(_REDACT)
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(get_settings().log_level)
    install_redaction()


def log(logger: logging.Logger, level: int, msg: str, **fields) -> None:
    logger.log(level, msg, extra={"extra_fields": fields})
