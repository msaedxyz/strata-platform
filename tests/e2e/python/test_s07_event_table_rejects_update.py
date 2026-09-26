"""docs/09 scenario 7: a test runs UPDATE on the event table. The database returns an error.

psql runs in the db container as the application role (strata_app) and as the superuser (postgres). Each statement
runs in a transaction that is rolled back. DELETE and TRUNCATE get the same error (CLAUDE.md rule 3).
"""

from __future__ import annotations

import pytest

STATEMENTS = {
    "UPDATE": "UPDATE strata.event SET payload = '{}'::jsonb WHERE id = (SELECT min(id) FROM strata.event)",
    "DELETE": "DELETE FROM strata.event WHERE id = (SELECT min(id) FROM strata.event)",
    "TRUNCATE": "TRUNCATE strata.event CASCADE",
}


@pytest.mark.parametrize("role", ["strata_app", "postgres"])
@pytest.mark.parametrize("operation", list(STATEMENTS))
def test_s07_the_event_table_rejects_update_delete_and_truncate(compose, acceptance, role, operation):
    first_event = "SELECT md5(e::text) FROM strata.event e ORDER BY id LIMIT 1"
    before = compose.scalar(first_event)
    result = compose.psql(f"BEGIN; {STATEMENTS[operation]}; ROLLBACK;", role=role, read_only=False, check=False)
    assert result.returncode != 0, f"{operation} as {role} did not fail"
    error = result.stderr
    assert "ERROR" in error, error
    # The error comes from the rule of the table, not from a missing grant or a read-only connection.
    assert "accepts inserts only" in error or "permission denied" in error, error
    if role == "postgres":
        assert "accepts inserts only" in error, error
    assert "read-only transaction" not in error
    assert compose.scalar(first_event) == before
