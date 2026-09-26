"""Database access with psycopg 3."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .settings import get_settings

_pool: ConnectionPool | None = None


def _configure(conn: psycopg.Connection) -> None:
    conn.execute("SET search_path = strata, public")
    conn.commit()


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            get_settings().database_url,
            min_size=1,
            max_size=10,
            kwargs={"row_factory": dict_row},
            configure=_configure,
            open=True,
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    """A pooled connection. The caller commits. An exception rolls back."""
    with get_pool().connection() as conn:
        yield conn


def connect(url: str | None = None, autocommit: bool = False) -> psycopg.Connection:
    """A single connection outside the pool, for scripts and listeners."""
    conn = psycopg.connect(url or get_settings().database_url, row_factory=dict_row, autocommit=autocommit)
    conn.execute("SET search_path = strata, public")
    if not autocommit:
        conn.commit()
    return conn
