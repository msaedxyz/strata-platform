"""Shared test fixtures.

Database tests need STRATA_TEST_ADMIN_URL: a superuser URL of a PostgreSQL server with PostGIS,
pgvector and pg_trgm, for example postgresql://postgres:<password>@localhost:55432/postgres.
The fixture creates a fresh database for the test session, runs the migrations and connects as strata_app.
"""

from __future__ import annotations

import os
import secrets
import time
import uuid
from collections.abc import Iterator
from urllib.parse import urlparse, urlunparse

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

ADMIN_URL = os.environ.get("STRATA_TEST_ADMIN_URL")


def _with_db(url: str, dbname: str, user: str | None = None, password: str | None = None) -> str:
    parts = urlparse(url)
    netloc = parts.netloc
    if user is not None:
        host = netloc.split("@", 1)[-1]
        netloc = f"{user}:{password}@{host}" if password else f"{user}@{host}"
    return urlunparse(parts._replace(path=f"/{dbname}", netloc=netloc))


@pytest.fixture(scope="session")
def database() -> Iterator[dict]:
    if not ADMIN_URL:
        pytest.skip("STRATA_TEST_ADMIN_URL is not set")
    dbname = f"strata_test_{uuid.uuid4().hex[:8]}"
    app_password = secrets.token_urlsafe(16)
    owner_password = secrets.token_urlsafe(16)
    with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{dbname}"')
    admin_db_url = _with_db(ADMIN_URL, dbname)
    os.environ["STRATA_ADMIN_DATABASE_URL"] = admin_db_url
    os.environ["STRATA_APP_DB_PASSWORD"] = app_password
    os.environ["STRATA_OWNER_DB_PASSWORD"] = owner_password
    app_url = _with_db(ADMIN_URL, dbname, "strata_app", app_password)
    os.environ["STRATA_DATABASE_URL"] = app_url
    from services.common.settings import get_settings

    get_settings.cache_clear()
    from services.common.migrate import migrate

    migrate(admin_db_url)
    info = {
        "name": dbname,
        "admin_url": admin_db_url,
        "app_url": app_url,
        "owner_url": _with_db(ADMIN_URL, dbname, "strata_owner", owner_password),
    }
    yield info
    from services.common.db import close_pool

    close_pool()
    if not os.environ.get("STRATA_KEEP_TEST_DB"):
        with psycopg.connect(ADMIN_URL, autocommit=True) as conn:
            conn.execute(f'DROP DATABASE IF EXISTS "{dbname}" WITH (FORCE)')


@pytest.fixture
def db(database) -> Iterator[psycopg.Connection]:
    """A connection as strata_app. The test commits what it needs."""
    from services.common.db import connect

    conn = connect(database["app_url"])
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


@pytest.fixture
def admin_db(database) -> Iterator[psycopg.Connection]:
    from psycopg.rows import dict_row

    conn = psycopg.connect(database["admin_url"], row_factory=dict_row)
    conn.execute("SET search_path = strata, public")
    try:
        yield conn
    finally:
        conn.rollback()
        conn.close()


# ---------- tokens ----------

_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_KID = "strata-test-key"


@pytest.fixture(scope="session")
def jwks() -> dict:
    public = jwt.algorithms.RSAAlgorithm.to_jwk(_KEY.public_key(), as_dict=True)
    public.update(kid=_KID, alg="RS256", use="sig")
    return {"keys": [public]}


@pytest.fixture
def auth(jwks, monkeypatch):
    """Install the local test key and give a function that makes a token for a role."""
    from services.api import auth as auth_module
    from services.common.settings import get_settings

    monkeypatch.setenv("STRATA_OIDC_ISSUER", "https://issuer.test/realms/strata")
    get_settings.cache_clear()
    auth_module.set_jwks_override(jwks)

    def make(role: str | None, sub: str | None = None, **extra) -> str:
        now = int(time.time())
        claims = {
            "iss": "https://issuer.test/realms/strata",
            "sub": sub or f"user-{role}",
            "aud": "strata-web",
            "azp": "strata-web",
            "iat": now,
            "exp": now + 3600,
            "email": f"{sub or role}@strata.test",
            "name": f"Test {role}",
            "realm_access": {"roles": [role] if role else []},
            **extra,
        }
        return jwt.encode(claims, _KEY, algorithm="RS256", headers={"kid": _KID})

    yield make
    auth_module.set_jwks_override(None)
    get_settings.cache_clear()


@pytest.fixture
def client(database, auth):
    from fastapi.testclient import TestClient

    from services.api.main import app

    with TestClient(app) as c:
        yield c


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
