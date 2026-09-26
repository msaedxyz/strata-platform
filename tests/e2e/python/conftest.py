"""Fixtures for the end to end acceptance tests (docs/09-acceptance.md) on the running local stack.

Start the stack first: `make e2e` does it all. See tests/e2e/README.md.

The session starts with these steps:
1. Wait until the API, Keycloak and the fixture server answer.
2. Open the live stream as a viewer, so that the telemetry records the frontend delivery of each alert.
3. The admin activates the acceptance brief through the API: the fixture brief with the deals wire
   (scenario 1) and the acceptance wire (scenarios 2, 3 and 8). Every source points at the fixture server.
4. Wait until the worker has collected each source of that brief once. The dispatcher of the worker
   starts a source that never ran at its next minute, with a jitter of up to 60 s.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime

import httpx
import pytest
import yaml

from .stack import (
    API_URL,
    FIXTURE_INTERNAL_URL,
    FIXTURE_URL,
    KEYCLOAK_URL,
    REPO_ROOT,
    Api,
    Compose,
    FixtureServer,
    LiveReader,
    Mailpit,
    Tokens,
    read_env_file,
    wait_for,
)

BRIEF_NOTE = "E2E acceptance brief: fixture sources with the deals and acceptance wires"
ACCEPTANCE_SOURCES = [  # (brief section, source)
    ("news", {"id": "fx_rss_deals", "name": "Copperbelt Deals Wire (fixture)", "type": "rss",
     "url": "{base}/feeds/deals.xml", "schedule": "daily", "licence_code": "verify_then_purge", "rate_limit_seconds": 0.2}),
    ("news", {"id": "fx_rss_acceptance", "name": "Copperbelt Acceptance Wire (fixture)", "type": "rss",
     "url": "{base}/feeds/acceptance.xml", "schedule": "daily", "licence_code": "verify_then_purge",
     "rate_limit_seconds": 0.2}),
    ("early_signal", {"id": "fx_web_zema_kasempa", "source_type": "zema_eia",
                      "name": "ZEMA notice, Kasempa North (fixture)", "type": "web",
     "url": "{base}/notices/zema-eis-kasempa-north.html", "schedule": "daily", "licence_code": "verify_then_purge",
     "rate_limit_seconds": 0.2}),
]
COLLECT_TIMEOUT = 600
RESULT_TIMEOUT = 300


def pytest_collection_modifyitems(items):
    for item in items:
        if item.get_closest_marker("timeout") is None:
            item.add_marker(pytest.mark.timeout(1200))


@pytest.fixture(scope="session")
def secrets() -> dict[str, str]:
    values = read_env_file()
    assert values.get("STRATA_DEV_USER_PASSWORD"), "run make setup first: .env has no STRATA_DEV_USER_PASSWORD"
    return values


@pytest.fixture(scope="session")
def http():
    # trust_env=False: the stack is on localhost. A proxy of the host must not see these requests.
    with httpx.Client(timeout=httpx.Timeout(60.0), trust_env=False) as client:
        yield client


@pytest.fixture(scope="session")
def stack(http) -> dict:
    wait_for(lambda: http.get(f"{API_URL}/api/health").status_code == 200, timeout=300, what="API health")
    wait_for(lambda: http.get(f"{KEYCLOAK_URL}/realms/strata/.well-known/openid-configuration").status_code == 200,
             timeout=300, what="Keycloak realm")
    wait_for(lambda: http.get(f"{FIXTURE_URL}/robots.txt").status_code == 200, timeout=120,
             what=f"fixture server at {FIXTURE_URL} (start it with the compose profile test)")
    return {"api": API_URL}


@pytest.fixture(scope="session")
def tokens(http, secrets, stack) -> Tokens:
    return Tokens(http, secrets["STRATA_DEV_USER_PASSWORD"])


@pytest.fixture(scope="session")
def api(http, tokens) -> Api:
    return Api(http, tokens)


@pytest.fixture(scope="session")
def compose(secrets) -> Compose:
    return Compose(secrets)


@pytest.fixture(scope="session")
def fixture_server(http, stack) -> FixtureServer:
    return FixtureServer(http)


@pytest.fixture(scope="session")
def mailpit(http) -> Mailpit:
    return Mailpit(http)


@pytest.fixture(scope="session")
def live(tokens) -> LiveReader:
    reader = LiveReader(f"{API_URL}/api/live", tokens.token("viewer")).start()
    yield reader
    reader.stop()


def acceptance_brief_yaml() -> str:
    text = (REPO_ROOT / "tests/fixtures/brief-fixture.yaml").read_text(encoding="utf-8")
    content = yaml.safe_load(text.replace("{{FIXTURE_BASE_URL}}", FIXTURE_INTERNAL_URL))
    for section, source in ACCEPTANCE_SOURCES:
        entries = content["sources"].setdefault(section, [])
        if not any(s["id"] == source["id"] for s in entries):
            entries.append({**source, "url": source["url"].format(base=FIXTURE_INTERNAL_URL)})
    return yaml.safe_dump(content, sort_keys=False, allow_unicode=True)


@pytest.fixture(scope="session")
def acceptance(api, live, fixture_server) -> dict:
    """The admin activates the acceptance brief. The worker collects each of its sources once."""
    activated_at = datetime.now(UTC)
    r = api.post("/api/briefs", "admin", {"yaml": acceptance_brief_yaml(), "change_note": BRIEF_NOTE, "activate": True})
    assert r.status_code == 201, f"brief activation: HTTP {r.status_code} {r.text[:500]}"
    brief = r.json()
    assert api.ok("/api/briefs")["active_version"] == brief["version"]
    health = api.source_health()
    source_ids = list(health)  # the collected sources of the active brief (proposed sources are not in it)
    assert {"fx_rss_deals", "fx_rss_acceptance", "fx_rss_mining", "fx_gn_kansanshi"} <= set(source_ids), source_ids

    def collected() -> dict | None:
        now = api.source_health()
        waiting = [sid for sid in source_ids if not now[sid]["runs"]]
        return None if waiting else now

    started = time.monotonic()
    health = wait_for(collected, timeout=COLLECT_TIMEOUT, interval=5,
                      what="the worker collects each source of the acceptance brief once")
    return {"brief": brief, "activated_at": activated_at, "health": health, "source_ids": source_ids,
            "collect_seconds": round(time.monotonic() - started, 1)}


@pytest.fixture(scope="session")
def results_timeout() -> int:
    return RESULT_TIMEOUT
