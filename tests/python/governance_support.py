"""Fixtures and helpers for the governance tests (docs/06-governance.md). conftest.py imports the fixtures.

- master_key: a random STRATA_MASTER_KEY for the module (never a fixed value in a file).
- api: a TestClient on a module database with brief v1 active and its watch lists as entities.
- smtp_stub: a local SMTP server that keeps each message.
- live_server: the API in a uvicorn thread, so that a test can read the real SSE stream (/api/live).
"""

from __future__ import annotations

import base64
import json
import os
import socket
import socketserver
import threading
import time
from collections.abc import Iterator

import httpx
import pytest

from .conftest import bearer

ROLES = ("viewer", "analyst", "analyst2", "approver", "approver2", "admin")


def role_of(name: str) -> str:
    return name.rstrip("0123456789")


@pytest.fixture(scope="module")
def master_key() -> Iterator[str]:
    from services.common.settings import get_settings
    from services.governance import personal

    saved = os.environ.get("STRATA_MASTER_KEY")
    key = base64.urlsafe_b64encode(os.urandom(32)).decode()
    os.environ["STRATA_MASTER_KEY"] = key
    get_settings.cache_clear()
    personal.policy.cache_clear()
    yield key
    if saved is None:
        os.environ.pop("STRATA_MASTER_KEY", None)
    else:
        os.environ["STRATA_MASTER_KEY"] = saved
    get_settings.cache_clear()


@pytest.fixture
def api(edb_setup, auth, master_key):
    """A TestClient. Use tokens(...) for the headers of each role."""
    from fastapi.testclient import TestClient

    from services.api.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def tokens(auth):
    """Headers for each development role. The subject of each token is "u-<name>"."""
    def headers(name: str) -> dict:
        return bearer(auth(role_of(name), sub=f"u-{name}"))

    return headers


# ---------- data helpers ----------


def make_deal(conn, title: str = "Nchanga bulk diesel supply", text: str | None = None, quote: str | None = None) -> dict:
    """A deal with verified evidence, written by the system actor (test setup only)."""
    from services.common.ids import new_id
    from services.governance.event_store import append_event

    from .helpers import make_evidence, make_source

    text = text or "Konkola Copper Mines Plc invited bids for the supply of diesel to the Nchanga mine."
    quote = quote or "invited bids for the supply of diesel"
    src = make_source(conn, text, title=text[:80])
    ev = make_evidence(conn, src, text, quote)
    deal = new_id()
    append_event(conn, stream_type="deal", stream_id=deal, event_type="DealIdentified",
                 payload={"title": title, "deal_type": "fuel_supply_contract", "stage": "signal"},
                 evidence_ids=[ev], certainty="stated", actor_type="system", actor_id="test")
    conn.commit()
    return {"id": deal, "evidence_id": ev, "source": src}


def org_id(conn, key: str) -> str:
    return conn.execute("SELECT id FROM entity WHERE type = 'organisation' AND brief_key = %s", (key,)).fetchone()["id"]


# ---------- SMTP stub ----------


class _SMTPHandler(socketserver.StreamRequestHandler):
    def handle(self):
        self.wfile.write(b"220 strata-test ESMTP\r\n")
        data, lines = False, []
        while True:
            line = self.rfile.readline()
            if not line:
                break
            if data:
                if line == b".\r\n":
                    data = False
                    self.server.messages.append(b"".join(lines).decode("utf-8", "replace"))
                    self.wfile.write(b"250 OK\r\n")
                else:
                    lines.append(line)
                continue
            cmd = line.strip().upper()
            if cmd.startswith(b"DATA"):
                data, lines = True, []
                self.wfile.write(b"354 go ahead\r\n")
            elif cmd.startswith(b"QUIT"):
                self.wfile.write(b"221 bye\r\n")
                break
            else:
                self.wfile.write(b"250 OK\r\n")


@pytest.fixture
def smtp_stub(monkeypatch):
    from services.common.settings import get_settings

    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _SMTPHandler)
    server.messages = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("STRATA_SMTP_HOST", "127.0.0.1")
    monkeypatch.setenv("STRATA_SMTP_PORT", str(server.server_address[1]))
    monkeypatch.setenv("STRATA_ALERT_EMAIL_TO", "alerts@strata.test")
    get_settings.cache_clear()
    yield server
    server.shutdown()
    server.server_close()
    get_settings.cache_clear()


# ---------- live server and SSE reader ----------


class LiveServer:
    def __init__(self, app):
        import uvicorn

        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.bind(("127.0.0.1", 0))
        self.port = self.sock.getsockname()[1]
        self.server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="warning",
                                                    lifespan="on"))
        self.thread = threading.Thread(target=self.server.run, kwargs={"sockets": [self.sock]}, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self) -> LiveServer:
        self.thread.start()
        deadline = time.time() + 20
        while not self.server.started and time.time() < deadline:
            time.sleep(0.05)
        assert self.server.started, "the live server did not start"
        return self

    def stop(self) -> None:
        self.server.should_exit = True
        self.thread.join(10)


class SSEReader:
    """Reads /api/live in a thread and keeps each message (event name and JSON data)."""

    def __init__(self, base_url: str, token: str):
        self.messages: list[dict] = []
        self.connected = threading.Event()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, args=(base_url, token), daemon=True)

    def _run(self, base_url: str, token: str) -> None:
        with httpx.Client(timeout=httpx.Timeout(5.0, read=30.0)) as client, \
                client.stream("GET", f"{base_url}/api/live", params={"access_token": token}) as response:
            event = None
            for line in response.iter_lines():
                if self._stop.is_set():
                    break
                if line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:"):
                    data = json.loads(line[5:].strip() or "{}")
                    self.messages.append({"event": event, "data": data, "received_at": time.time()})
                    if event == "hello":
                        self.connected.set()

    def start(self) -> SSEReader:
        self._thread.start()
        assert self.connected.wait(20), "the live stream did not connect"
        return self

    def wait_for(self, predicate, timeout: float = 20.0) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            for m in list(self.messages):
                if predicate(m):
                    return m
            time.sleep(0.05)
        raise AssertionError(f"no live message matched in {timeout} s: {[m['event'] for m in self.messages]}")

    def stop(self) -> None:
        self._stop.set()


@pytest.fixture
def live_server(edb_setup, auth, master_key):
    from services.api.main import app

    server = LiveServer(app).start()
    yield server
    server.stop()
