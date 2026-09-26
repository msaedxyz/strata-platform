"""Apply database migrations, create the roles and set the grants.

Run as the database superuser: python -m services.common.migrate
The application role strata_app gets INSERT and SELECT on the event table only.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

import psycopg
from psycopg import sql

from .logging import log, setup_logging
from .settings import REPO_ROOT, get_settings

logger = logging.getLogger("strata.migrate")
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"

# Tables that accept inserts only, for the application role.
INSERT_ONLY_TABLES = ["event", "security_log", "monitoring_brief_version", "brief_activation", "evidence"]


def _ensure_role(cur: psycopg.Cursor, name: str, password: str | None) -> None:
    cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (name,))
    exists = cur.fetchone() is not None
    if not exists:
        cur.execute(sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(name)))
    if password:
        cur.execute(sql.SQL("ALTER ROLE {} WITH LOGIN PASSWORD {}").format(sql.Identifier(name), sql.Literal(password)))


def _apply_procrastinate(conn: psycopg.Connection) -> None:
    from procrastinate import PsycopgConnector
    from procrastinate.schema import SchemaManager

    schema_sql = SchemaManager(PsycopgConnector()).get_schema()
    with conn.cursor() as cur:
        cur.execute("SET search_path = public")
        cur.execute(schema_sql)


def migrate(admin_url: str | None = None) -> list[str]:
    settings = get_settings()
    url = admin_url or settings.admin_database_url
    if not url:
        raise SystemExit("STRATA_ADMIN_DATABASE_URL is not set")
    applied: list[str] = []
    with psycopg.connect(url, autocommit=False) as conn:
        with conn.cursor() as cur:
            _ensure_role(cur, "strata_owner", settings.owner_db_password)
            _ensure_role(cur, "strata_app", settings.app_db_password)
            cur.execute(
                "CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
            )
            cur.execute("SELECT name FROM public.schema_migrations")
            done = {r[0] for r in cur.fetchall()}
        conn.commit()

        files = sorted(p for p in MIGRATIONS_DIR.glob("*.sql"))
        for path in files:
            if path.name in done:
                continue
            with conn.cursor() as cur:
                cur.execute(Path(path).read_text(encoding="utf-8"))
                cur.execute("INSERT INTO public.schema_migrations (name) VALUES (%s)", (path.name,))
            conn.commit()
            applied.append(path.name)
            log(logger, logging.INFO, "migration applied", name=path.name)

        if "procrastinate" not in done:
            _apply_procrastinate(conn)
            with conn.cursor() as cur:
                cur.execute("INSERT INTO public.schema_migrations (name) VALUES ('procrastinate')")
            conn.commit()
            applied.append("procrastinate")

        _set_ownership_and_grants(conn)
        conn.commit()
    return applied


def _set_ownership_and_grants(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute("ALTER SCHEMA strata OWNER TO strata_owner")
        # Tables, views and sequences in schema strata.
        cur.execute(
            "SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'strata' AND c.relkind IN ('r','v','S','m')"
        )
        for name, kind in cur.fetchall():
            kw = {"r": "TABLE", "v": "VIEW", "S": "SEQUENCE", "m": "MATERIALIZED VIEW"}[kind]
            cur.execute(sql.SQL("ALTER {} strata.{} OWNER TO strata_owner").format(sql.SQL(kw), sql.Identifier(name)))
        cur.execute(
            "SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
            "WHERE n.nspname = 'strata'"
        )
        for (sig,) in cur.fetchall():
            cur.execute(sql.SQL("ALTER FUNCTION {} OWNER TO strata_owner").format(sql.SQL(sig)))

        cur.execute("GRANT USAGE ON SCHEMA strata TO strata_app")
        cur.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA strata TO strata_app")
        cur.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA strata TO strata_app")
        for t in INSERT_ONLY_TABLES:
            cur.execute(sql.SQL("REVOKE UPDATE, DELETE, TRUNCATE ON strata.{} FROM strata_app").format(sql.Identifier(t)))
        # Projections can be deleted and rebuilt.
        cur.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'strata' AND tablename LIKE 'proj\\_%'"
        )
        for (t,) in cur.fetchall():
            cur.execute(sql.SQL("GRANT TRUNCATE ON strata.{} TO strata_app").format(sql.Identifier(t)))
        # The job queue lives in schema public.
        cur.execute("GRANT USAGE ON SCHEMA public TO strata_app")
        cur.execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'procrastinate%'"
        )
        for (t,) in cur.fetchall():
            cur.execute(sql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON public.{} TO strata_app").format(sql.Identifier(t)))
        cur.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO strata_app")
        cur.execute("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO strata_app")
        cur.execute("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA strata TO strata_app")


def main() -> None:
    setup_logging()
    applied = migrate()
    print(f"applied: {', '.join(applied) if applied else 'nothing new'}")


if __name__ == "__main__":
    sys.exit(main())
