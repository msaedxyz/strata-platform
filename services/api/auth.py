"""OIDC bearer token checks and roles. The API enforces every permission. The frontend only hides controls."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import httpx
import jwt
from fastapi import Depends, HTTPException, Request, status

from services.common.settings import get_settings

# Role order: each role has the permissions of the roles before it. Source: docs/06-governance.md.
ROLE_ORDER = ["viewer", "analyst", "approver", "admin"]

_jwks_cache: dict = {"keys": None, "at": 0.0}
_jwks_override: dict | None = None


def set_jwks_override(jwks: dict | None) -> None:
    """Tests use this to install a local signing key."""
    global _jwks_override
    _jwks_override = jwks
    _jwks_cache["keys"] = None


def _jwks() -> dict:
    if _jwks_override is not None:
        return _jwks_override
    now = time.time()
    if _jwks_cache["keys"] is None or now - _jwks_cache["at"] > 300:
        s = get_settings()
        url = s.oidc_jwks_url or f"{(s.oidc_internal_issuer or s.oidc_issuer).rstrip('/')}/protocol/openid-connect/certs"
        resp = httpx.get(url, timeout=10)
        resp.raise_for_status()
        _jwks_cache.update(keys=resp.json(), at=now)
    return _jwks_cache["keys"]


@dataclass
class User:
    id: str
    email: str | None
    name: str | None
    roles: list[str] = field(default_factory=list)

    @property
    def level(self) -> int:
        return max((ROLE_ORDER.index(r) for r in self.roles if r in ROLE_ORDER), default=-1)

    def has(self, role: str) -> bool:
        return self.level >= ROLE_ORDER.index(role)

    @property
    def top_role(self) -> str | None:
        return ROLE_ORDER[self.level] if self.level >= 0 else None


def decode_token(token: str) -> dict:
    s = get_settings()
    header = jwt.get_unverified_header(token)
    keys = _jwks().get("keys", [])
    key = next((k for k in keys if k.get("kid") == header.get("kid")), None)
    if key is None:
        _jwks_cache["keys"] = None
        keys = _jwks().get("keys", [])
        key = next((k for k in keys if k.get("kid") == header.get("kid")), None)
    if key is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown signing key")
    public_key = jwt.PyJWK(key).key
    try:
        return jwt.decode(
            token,
            public_key,
            algorithms=[header.get("alg", "RS256")],
            issuer=s.oidc_issuer,
            options={"verify_aud": False},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"invalid token: {exc}") from exc


def user_from_claims(claims: dict) -> User:
    s = get_settings()
    aud = claims.get("aud")
    azp = claims.get("azp")
    auds = aud if isinstance(aud, list) else [aud] if aud else []
    if s.oidc_audience not in auds and azp != s.oidc_audience:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token audience does not match")
    roles = list((claims.get("realm_access") or {}).get("roles") or [])
    roles += list(claims.get("roles") or [])
    return User(
        id=claims["sub"],
        email=claims.get("email"),
        name=claims.get("name") or claims.get("preferred_username"),
        roles=[r for r in roles if r in ROLE_ORDER],
    )


def _token_from_request(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:]
    # EventSource cannot send headers. The live stream accepts the token as a query parameter.
    if request.url.path.endswith("/live"):
        return request.query_params.get("access_token")
    return None


def current_user(request: Request) -> User:
    token = _token_from_request(request)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    user = user_from_claims(decode_token(token))
    if user.level < 0:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "no Strata role")
    request.state.user = user
    return user


def require(role: str):
    def dependency(user: User = Depends(current_user)) -> User:
        if not user.has(role):
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"needs role {role}")
        return user

    return dependency


require_viewer = require("viewer")
require_analyst = require("analyst")
require_approver = require("approver")
require_admin = require("admin")
