"""Fixtures and helpers for the collector tests (docs/04-ingestion.md). conftest.py imports the fixtures.

Each collector test module gets a fresh database, a fresh object storage directory and its own
fixture server, because a collector run changes shared state (sources, fetch_state, brief versions).
The HTTP client uses a fake clock, so that the rate limit and the retry backoff do not sleep for real.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import psycopg
import pytest

ADMIN_URL = os.environ.get("STRATA_TEST_ADMIN_URL")


def _with_db(url: str, dbname: str, user: str | None = None, password: str | None = None) -> str:
    from urllib.parse import urlparse, urlunparse

    parts = urlparse(url)
    netloc = parts.netloc
    if user is not None:
        host = netloc.split("@", 1)[-1]
        netloc = f"{user}:{password}@{host}" if password else f"{user}@{host}"
    return urlunparse(parts._replace(path=f"/{dbname}", netloc=netloc))

_ENV_KEYS = ("STRATA_DATABASE_URL", "STRATA_ADMIN_DATABASE_URL", "STRATA_STORAGE_DIR", "STRATA_S3_ENDPOINT_URL")


def _reset_process_state() -> None:
    from services.collectors.http import reset_robots_cache
    from services.common.db import close_pool
    from services.common.settings import get_settings
    from services.common.storage import reset_storage
    from services.queue import close_queue

    close_pool()
    close_queue()
    get_settings.cache_clear()
    reset_storage()
    reset_robots_cache()


@pytest.fixture(scope="module")
def fresh_db(database, tmp_path_factory) -> Iterator[dict]:
    """A new database for this module, with the migrations applied. The env points at it."""
    if not ADMIN_URL:
        pytest.skip("STRATA_TEST_ADMIN_URL is not set")
    saved = {k: os.environ.get(k) for k in _ENV_KEYS}
    dbname = f"strata_test_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{dbname}"')
    admin_url = _with_db(ADMIN_URL, dbname)
    app_password = os.environ["STRATA_APP_DB_PASSWORD"]
    app_url = _with_db(ADMIN_URL, dbname, "strata_app", app_password)
    os.environ["STRATA_ADMIN_DATABASE_URL"] = admin_url
    os.environ["STRATA_DATABASE_URL"] = app_url
    os.environ["STRATA_STORAGE_DIR"] = str(tmp_path_factory.mktemp("objects"))
    os.environ.pop("STRATA_S3_ENDPOINT_URL", None)
    _reset_process_state()
    from services.common.migrate import migrate

    migrate(admin_url)
    yield {"name": dbname, "admin_url": admin_url, "app_url": app_url, "storage_dir": os.environ["STRATA_STORAGE_DIR"]}
    _reset_process_state()
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    _reset_process_state()
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{dbname}" WITH (FORCE)')


@pytest.fixture
def cdb(fresh_db) -> Iterator[psycopg.Connection]:
    """A connection as strata_app to the module database."""
    from services.common.db import connect

    conn = connect(fresh_db["app_url"])
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


@pytest.fixture(scope="module")
def fixture_server():
    from tests.fixtures.server import start_server

    server = start_server()
    yield server
    server.stop()


@pytest.fixture(scope="module")
def fake_clock():
    """A fake clock for the rate limiter and the retry backoff of the module."""
    from services.collectors.http import DomainRateLimiter, FakeClock, set_default_limiter

    clock = FakeClock()
    limiter = DomainRateLimiter(clock=clock, sleep=clock.sleep)
    set_default_limiter(limiter, sleep=clock.sleep)
    yield clock
    set_default_limiter(None)


def make_client(brief_content: dict | None = None, clock=None, **kw):
    from services.collectors.http import DomainRateLimiter, FakeClock, HttpClient

    clock = clock or FakeClock()
    return HttpClient(
        google_news_only=list((brief_content or {}).get("google_news_only") or []),
        limiter=DomainRateLimiter(clock=clock, sleep=clock.sleep),
        sleep=clock.sleep,
        **kw,
    )


def activate_fixture_brief(conn, server) -> dict:
    """Store the fixture brief (pointed at this server) as a new version and activate it."""
    from services.collectors.brief import activate, create_version_from_yaml
    from tests.fixtures.server import fixture_brief_text

    row, _ = create_version_from_yaml(conn, fixture_brief_text(server.base_url), created_by="test")
    activate(conn, row["id"], actor_type="system", actor_id="test")
    conn.commit()
    return row


def run_fixture(conn, server, clock, **kw):
    from services.collectors.runner import run_all

    client = make_client(clock=clock)
    kw.setdefault("enqueue", None)
    try:
        return run_all(conn, client=client, google_news_base_url=f"{server.base_url}/rss/search", **kw), client
    finally:
        client.close()


def fixture_url(server, path: str) -> str:
    return f"{server.base_url}{path}"
