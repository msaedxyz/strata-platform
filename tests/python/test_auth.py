"""OIDC login at the API (M1) and the security log (docs/06-governance.md, audit log)."""

from __future__ import annotations

import pytest

from .conftest import bearer

pytestmark = pytest.mark.db


def test_missing_token_gives_401(client):
    assert client.get("/api/me").status_code == 401


def test_valid_token_gives_user_and_role(client, auth):
    r = client.get("/api/me", headers=bearer(auth("approver", sub="u-approver")))
    assert r.status_code == 200
    assert r.json()["role"] == "approver"


def test_token_without_strata_role_gives_403(client, auth):
    assert client.get("/api/me", headers=bearer(auth(None, sub="u-norole"))).status_code == 403


def test_token_from_other_issuer_gives_401(client, auth):
    token = auth("viewer", iss="https://evil.test/realms/strata")
    assert client.get("/api/me", headers=bearer(token)).status_code == 401


def test_login_logout_and_permission_change_go_to_security_log(client, auth, db):
    sub = "u-seclog"
    client.post("/api/session/login", headers=bearer(auth("viewer", sub=sub)))
    client.post("/api/session/login", headers=bearer(auth("analyst", sub=sub)))
    client.post("/api/session/logout", headers=bearer(auth("analyst", sub=sub)))
    actions = [r["action"] for r in db.execute("SELECT action FROM security_log WHERE user_id = %s ORDER BY at", (sub,)).fetchall()]
    assert actions == ["login", "login", "permission_change", "logout"]


def test_openapi_schema_is_published(client):
    r = client.get("/api/openapi.json")
    assert r.status_code == 200 and r.json()["info"]["title"] == "Strata API"
