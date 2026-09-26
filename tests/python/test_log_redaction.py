"""CLAUDE.md rule 5: no secret in a log. The live stream takes the token as a query parameter."""

from __future__ import annotations

import logging

from services.common.logging import RedactFilter, install_redaction, redact_text


def test_query_token_and_bearer_are_redacted():
    line = 'GET /api/live?access_token=eyJhbGciOi.abc.def&x=1 HTTP/1.1 Authorization: Bearer eyJ0eXAi.x.y'
    out = redact_text(line)
    assert "eyJ" not in out and "access_token=[redacted]" in out and "&x=1" in out


def test_uvicorn_access_log_arguments_are_redacted(caplog):
    install_redaction()
    record = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
                               ("127.0.0.1:1", "GET", "/api/live?access_token=secret-token-value", "1.1", 200), None)
    RedactFilter().filter(record)
    assert "secret-token-value" not in record.getMessage()
    assert logging.getLogger("uvicorn.access").filters
