"""Clients for the running local stack: the API, Keycloak, the fixture server, Mailpit, psql and docker compose.

The end to end tests talk to the stack over HTTP. A few scenarios need a SQL result or a command in a container
(docs/09 scenarios 3, 7, 9, 10, 11 and 12). They use `docker compose exec` on the same compose project.

Settings (environment variables, all optional):
- E2E_API_URL (http://localhost:8000), E2E_WEB_URL (http://localhost:8088), E2E_KEYCLOAK_URL (http://localhost:8080)
- E2E_FIXTURE_URL (http://localhost:8765): the fixture server from the host
- E2E_FIXTURE_INTERNAL_URL (http://fixtures:8765): the fixture server from the containers
- E2E_MAILPIT_URL (http://localhost:8025)
- E2E_COMPOSE: the docker compose command with its files and profile. The Makefile sets it.
- E2E_ENV_FILE (.env): the file with STRATA_DEV_USER_PASSWORD and STRATA_APP_DB_PASSWORD. The tests never print a value.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx

REPO_ROOT = Path(__file__).resolve().parents[3]
USERS = ("viewer", "analyst", "analyst2", "approver", "approver2", "admin")


def env(name: str, default: str) -> str:
    return os.environ.get(name) or default


API_URL = env("E2E_API_URL", "http://localhost:8000").rstrip("/")
WEB_URL = env("E2E_WEB_URL", "http://localhost:8088").rstrip("/")
KEYCLOAK_URL = env("E2E_KEYCLOAK_URL", "http://localhost:8080").rstrip("/")
FIXTURE_URL = env("E2E_FIXTURE_URL", "http://localhost:8765").rstrip("/")
FIXTURE_INTERNAL_URL = env("E2E_FIXTURE_INTERNAL_URL", "http://fixtures:8765").rstrip("/")
MAILPIT_URL = env("E2E_MAILPIT_URL", "http://localhost:8025").rstrip("/")
DEFAULT_COMPOSE = "docker compose -f docker-compose.yml -f tests/e2e/compose.e2e.yml --profile test"


def read_env_file() -> dict[str, str]:
    """The values of .env. The caller must never print them."""
    path = Path(env("E2E_ENV_FILE", str(REPO_ROOT / ".env")))
    values: dict[str, str] = {}
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip()
    for key in ("STRATA_DEV_USER_PASSWORD", "STRATA_APP_DB_PASSWORD"):
        if os.environ.get(key):
            values[key] = os.environ[key]
    return values


def wait_for(check: Callable[[], Any], *, timeout: float, interval: float = 2.0, what: str) -> Any:
    """Call check until it returns a true value. Raise AssertionError with `what` after the timeout."""
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while True:
        try:
            value = check()
            if value:
                return value
        except (httpx.HTTPError, AssertionError, KeyError, StopIteration) as exc:
            last_error = exc
        if time.monotonic() > deadline:
            raise AssertionError(f"timeout after {timeout:.0f} s: {what}" + (f" (last error: {last_error!r})" if last_error else ""))
        time.sleep(interval)


# ---------- Keycloak tokens ----------


class Tokens:
    """Access tokens from Keycloak with the password grant of the strata-web client (dev users only)."""

    def __init__(self, http: httpx.Client, password: str):
        self._http = http
        self._password = password
        self._cache: dict[str, tuple[str, float]] = {}
        self._lock = threading.Lock()

    def token(self, user: str) -> str:
        with self._lock:
            cached = self._cache.get(user)
            if cached and cached[1] > time.time() + 60:
                return cached[0]
            r = self._http.post(
                f"{KEYCLOAK_URL}/realms/strata/protocol/openid-connect/token",
                data={"grant_type": "password", "client_id": "strata-web", "username": f"{user}@strata.local",
                      "password": self._password, "scope": "openid"},
            )
            assert r.status_code == 200, f"Keycloak refused the password grant for {user}: HTTP {r.status_code}"
            body = r.json()
            self._cache[user] = (body["access_token"], time.time() + float(body.get("expires_in", 300)))
            return body["access_token"]

    def headers(self, user: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token(user)}"}


# ---------- the API ----------


class Api:
    def __init__(self, http: httpx.Client, tokens: Tokens, base_url: str = API_URL):
        self.http = http
        self.tokens = tokens
        self.base_url = base_url

    def request(self, method: str, path: str, user: str | None, **kw) -> httpx.Response:
        headers = dict(kw.pop("headers", {}) or {})
        if user:
            headers.update(self.tokens.headers(user))
        return self.http.request(method, f"{self.base_url}{path}", headers=headers, **kw)

    def get(self, path: str, user: str = "viewer", **params) -> httpx.Response:
        return self.request("GET", path, user, params={k: v for k, v in params.items() if v is not None})

    def post(self, path: str, user: str, json_body: dict | None = None, **kw) -> httpx.Response:
        return self.request("POST", path, user, json=json_body, **kw)

    def ok(self, path: str, user: str = "viewer", **params) -> Any:
        r = self.get(path, user, **params)
        assert r.status_code == 200, f"GET {path}: HTTP {r.status_code} {r.text[:300]}"
        return r.json()

    # --- lookups that the scenarios share ---

    def signals(self, q: str | None = None, limit: int = 200, **params) -> list[dict]:
        return self.ok("/api/signals", q=q, limit=limit, **params)["items"]

    def signal_by_url(self, url_part: str, q: str | None = None) -> dict | None:
        return next((s for s in self.signals(q=q, limit=1000) if url_part in (s.get("url") or "")), None)

    def proposals(self, *, source_id: str | None = None, kind: str | list[str] | None = None,
                  status: str | list[str] | None = None, user: str = "viewer") -> list[dict]:
        """All proposals (every page), with the optional filters."""
        out: list[dict] = []
        offset = 0
        while True:
            r = self.get("/api/proposals", user, kind=kind, status=status, limit=500, offset=offset)
            assert r.status_code == 200, r.text[:300]
            body = r.json()
            out += body["items"]
            offset += len(body["items"])
            if not body["items"] or offset >= body["total"]:
                break
        return [p for p in out if source_id is None or p["source_id"] == source_id]

    def alerts(self, **params) -> list[dict]:
        return self.ok("/api/alerts", limit=500, **params)["items"]

    def source_health(self) -> dict[str, dict]:
        return {s["id"]: s for s in self.ok("/api/sources/health")["sources"]}

    def timeline(self, stream_type: str, stream_id: str, as_of: str | None = None) -> dict:
        return self.ok("/api/timeline", stream_type=stream_type, stream_id=stream_id, as_of=as_of)


# ---------- the live stream ----------


@dataclass
class LiveMessage:
    event: str
    data: dict
    received_at: float


@dataclass
class LiveReader:
    """Reads /api/live (SSE) in a thread and keeps each message with the time it arrived."""

    url: str
    token: str
    messages: list[LiveMessage] = field(default_factory=list)
    connected: threading.Event = field(default_factory=threading.Event)
    _stop: threading.Event = field(default_factory=threading.Event)
    _thread: threading.Thread | None = None

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                with httpx.Client(timeout=httpx.Timeout(10.0, read=60.0), trust_env=False) as client, \
                        client.stream("GET", self.url, params={"access_token": self.token}) as response:
                    event = "message"
                    for line in response.iter_lines():
                        if self._stop.is_set():
                            return
                        if line.startswith("event:"):
                            event = line[6:].strip()
                        elif line.startswith("data:"):
                            try:
                                data = json.loads(line[5:].strip() or "{}")
                            except json.JSONDecodeError:
                                data = {}
                            self.messages.append(LiveMessage(event, data, time.time()))
                            if event == "hello":
                                self.connected.set()
            except httpx.HTTPError:
                time.sleep(1)

    def start(self) -> LiveReader:
        self._thread = threading.Thread(target=self._run, daemon=True, name="e2e-live-reader")
        self._thread.start()
        assert self.connected.wait(30), "the live stream did not connect"
        return self

    def find(self, predicate: Callable[[LiveMessage], bool]) -> LiveMessage | None:
        return next((m for m in list(self.messages) if predicate(m)), None)

    def stop(self) -> None:
        self._stop.set()


# ---------- fixture server and Mailpit ----------


class FixtureServer:
    def __init__(self, http: httpx.Client):
        self.http = http

    def log(self) -> list[dict]:
        r = self.http.get(f"{FIXTURE_URL}/_control/log")
        r.raise_for_status()
        return r.json()

    def paths(self) -> list[str]:
        return [e["path"] for e in self.log()]


class Mailpit:
    def __init__(self, http: httpx.Client):
        self.http = http

    def subjects(self) -> list[str]:
        r = self.http.get(f"{MAILPIT_URL}/api/v1/messages", params={"limit": 500})
        r.raise_for_status()
        return [m.get("Subject") or "" for m in r.json().get("messages", [])]


# ---------- docker compose and psql ----------


class Compose:
    """Runs docker compose on the stack of the tests (E2E_COMPOSE, from the repository root)."""

    def __init__(self, secrets: dict[str, str]):
        self.command = shlex.split(env("E2E_COMPOSE", DEFAULT_COMPOSE))
        self._secrets = secrets

    def run(self, *args: str, check: bool = True, timeout: float = 600, input_text: str | None = None,
            extra_env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
        environment = {**os.environ, **(extra_env or {})}
        result = subprocess.run([*self.command, *args], cwd=REPO_ROOT, capture_output=True, text=True,
                                timeout=timeout, input=input_text, env=environment)
        if check and result.returncode != 0:
            raise AssertionError(f"docker compose {' '.join(args[:3])} failed ({result.returncode}): "
                                 f"{result.stderr[-1500:]}")
        return result

    def exec(self, service: str, *args: str, **kw) -> subprocess.CompletedProcess:
        return self.run("exec", "-T", service, *args, **kw)

    def psql(self, sql: str, *, role: str = "postgres", read_only: bool = True, check: bool = True
             ) -> subprocess.CompletedProcess:
        """psql in the db container. postgres uses the local socket. strata_app uses its password from .env.
        The password goes through the environment of the process, never through the command line."""
        options = "-c search_path=strata,public" + (" -c default_transaction_read_only=on" if read_only else "")
        args = ["exec", "-T", "-e", f"PGOPTIONS={options}"]
        extra: dict[str, str] = {}
        if role == "postgres":
            args += ["db", "psql", "-U", "postgres", "-d", "strata"]
        else:
            extra["PGPASSWORD"] = self._secrets.get("STRATA_APP_DB_PASSWORD", "")
            args[2:2] = ["-e", "PGPASSWORD"]
            args += ["db", "psql", "-h", "127.0.0.1", "-U", role, "-d", "strata"]
        args += ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql]
        return self.run(*args, check=check, extra_env=extra)

    def scalar(self, sql: str) -> str:
        return self.psql(sql).stdout.strip()


# ---------- helpers that several scenarios share ----------


def wait_signal(api: Api, url_part: str, *, q: str | None = None, timeout: float = 300) -> dict:
    """The signal of the collected document whose URL contains url_part (after enrichment)."""
    return wait_for(lambda: api.signal_by_url(url_part, q), timeout=timeout,
                    what=f"a signal for the document {url_part}")


def wait_proposals(api: Api, source_id: str, predicate: Callable[[list[dict]], bool], *, timeout: float = 120,
                   what: str) -> list[dict]:
    def check():
        found = api.proposals(source_id=source_id)
        return found if predicate(found) else None

    return wait_for(check, timeout=timeout, what=what)


def approved_deal(api: Api, url_part: str, title_prefix: str, *, q: str | None = None, timeout: float = 300) -> dict:
    """An approver approves the DealIdentified proposal of a fixture document. Returns the Kanban card."""
    signal = wait_signal(api, url_part, q=q, timeout=timeout)
    proposals = wait_proposals(
        api, signal["source_id"],
        lambda ps: any(p["kind"] == "DealIdentified" and p["title"].startswith(title_prefix) for p in ps),
        what=f"a DealIdentified proposal '{title_prefix}' for {url_part}")
    proposal = next(p for p in proposals if p["kind"] == "DealIdentified" and p["title"].startswith(title_prefix))
    if proposal["status"] == "pending":
        r = api.post(f"/api/proposals/{proposal['id']}/approve", "approver", {"reason": "E2E: a real opportunity"})
        assert r.status_code == 200, f"approve the deal: HTTP {r.status_code} {r.text[:300]}"
    deal_id = proposal["stream_id"]

    def card():
        return next((d for d in api.ok("/api/deals")["items"] if d["id"] == deal_id), None)

    return wait_for(card, timeout=30, interval=1, what=f"the deal {deal_id} on the Kanban board")
