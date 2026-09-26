"""docs/04-ingestion.md, rules for web collection: robots.txt, rate limit, User-Agent, the google_news_only
guard (criterion 11), retries with backoff, redirects and conditional GET. No network: httpx MockTransport."""

from __future__ import annotations

import httpx
import pytest

from services.collectors.http import (
    DomainRateLimiter,
    FakeClock,
    FetchError,
    ForbiddenDomainError,
    HttpClient,
    RobotsDisallowedError,
    reset_robots_cache,
)


@pytest.fixture(autouse=True)
def _fresh_robots():
    reset_robots_cache()
    yield
    reset_robots_cache()


class Recorder:
    def __init__(self, routes: dict | None = None, robots: str = "User-agent: *\nDisallow: /private/\n"):
        self.requests: list[httpx.Request] = []
        self.routes = routes or {}
        self.robots = robots

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text=self.robots)
        handler = self.routes.get(request.url.path)
        if callable(handler):
            return handler(request)
        if handler is not None:
            return handler
        return httpx.Response(200, text="<html><body><p>ok</p></body></html>", headers={"content-type": "text/html"})

    def hosts(self) -> set[str]:
        return {r.url.host for r in self.requests}


def client_for(recorder: Recorder, gn_only=("miningweekly.com",), clock: FakeClock | None = None) -> tuple[HttpClient, FakeClock]:
    clock = clock or FakeClock()
    client = HttpClient(google_news_only=list(gn_only), limiter=DomainRateLimiter(clock=clock, sleep=clock.sleep),
                        sleep=clock.sleep, transport=httpx.MockTransport(recorder), contact_email="ops@strata.test")
    return client, clock


def test_c04_11_google_news_only_domain_is_refused_before_any_request():
    """Criterion 11: the guard raises and the transport never receives a request for the domain."""
    rec = Recorder()
    client, _ = client_for(rec)
    for url in ("https://www.miningweekly.com/article/x", "https://miningweekly.com/", "http://m.miningweekly.com/a"):
        with pytest.raises(ForbiddenDomainError):
            client.fetch(url)
    assert rec.requests == []
    assert len(client.refused) == 3
    client.fetch("https://notminingweekly.com/page")  # a different domain with the same ending is allowed
    assert rec.hosts() == {"notminingweekly.com"}


def test_c04_11_redirect_to_a_google_news_only_domain_is_refused():
    rec = Recorder({"/go": httpx.Response(302, headers={"location": "https://www.miningweekly.com/story"})})
    client, _ = client_for(rec)
    with pytest.raises(ForbiddenDomainError):
        client.fetch("https://news.example.test/go")
    assert "www.miningweekly.com" not in rec.hosts()


def test_c04_05_robots_txt_disallowed_path_is_not_requested_and_robots_is_cached():
    rec = Recorder()
    client, _ = client_for(rec)
    with pytest.raises(RobotsDisallowedError):
        client.fetch("https://site.test/private/minutes.html")
    client.fetch("https://site.test/public/a.html")
    client.fetch("https://site.test/public/b.html")
    paths = [r.url.path for r in rec.requests]
    assert "/private/minutes.html" not in paths
    assert paths.count("/robots.txt") == 1


class _RobotsStatus(Recorder):
    def __init__(self, status: int):
        super().__init__()
        self.status = status

    def __call__(self, request):
        self.requests.append(request)
        if request.url.path == "/robots.txt":
            return httpx.Response(self.status)
        return httpx.Response(200, text="ok")


def test_robots_txt_404_allows_and_server_error_disallows():
    ok_client, _ = client_for(_RobotsStatus(404))
    assert ok_client.fetch("https://norobots.test/a").status == 200
    broken = _RobotsStatus(503)
    bad_client, _ = client_for(broken)
    with pytest.raises(RobotsDisallowedError):
        bad_client.fetch("https://broken.test/a")
    assert [r.url.path for r in broken.requests] == ["/robots.txt"]


def test_rate_limit_is_one_request_per_domain_every_five_seconds():
    rec = Recorder()
    client, clock = client_for(rec)
    client.fetch("https://a.test/1")   # robots.txt then the page
    client.fetch("https://a.test/2")
    client.fetch("https://b.test/1")
    waits_a = [w for d, w in client.limiter.waits if d == "https://a.test"]
    assert waits_a == [5.0, 5.0]       # robots.txt at t=0, page 1 at t=5, page 2 at t=10
    # b.test waits only between its own robots.txt and its page, not for a.test.
    assert [w for d, w in client.limiter.waits if d == "https://b.test"] == [5.0]
    assert clock.now == 1000.0 + 5.0 + 5.0 + 5.0


def test_rate_limit_uses_the_interval_of_the_brief_source():
    rec = Recorder()
    client, _ = client_for(rec)
    client.fetch("https://c.test/1", rate_limit_seconds=10)
    client.fetch("https://c.test/2", rate_limit_seconds=10)
    assert [w for d, w in client.limiter.waits if d == "https://c.test"] == [10.0, 10.0]


def test_user_agent_names_strata_and_the_contact_address():
    rec = Recorder()
    client, _ = client_for(rec)
    client.fetch("https://ua.test/")
    assert {r.headers["user-agent"] for r in rec.requests} == {"Strata/0.1 (+contact: ops@strata.test)"}


def test_failed_fetch_is_retried_three_times_with_exponential_backoff():
    calls = {"n": 0}

    def flaky(request):
        calls["n"] += 1
        return httpx.Response(503) if calls["n"] <= 3 else httpx.Response(200, text="finally")

    client, clock = client_for(Recorder({"/flaky": flaky}))
    result = client.fetch("https://flaky.test/flaky", rate_limit_seconds=0)
    assert result.status == 200 and result.attempts == 4
    assert [s for s in clock.slept if s in (2, 4, 8)] == [2, 4, 8]


def test_fetch_fails_after_three_retries():
    client, clock = client_for(Recorder({"/down": httpx.Response(500)}))
    with pytest.raises(FetchError) as err:
        client.fetch("https://down.test/down", rate_limit_seconds=0)
    assert err.value.attempts == 4 and err.value.status == 500
    client2, _ = client_for(Recorder({"/gone": httpx.Response(404)}))
    with pytest.raises(FetchError) as err2:
        client2.fetch("https://gone.test/gone", rate_limit_seconds=0)
    assert err2.value.attempts == 1  # a 404 is not retried


def test_conditional_get_sends_validators_and_reports_not_modified():
    def cond(request):
        if request.headers.get("if-none-match") == '"v1"':
            return httpx.Response(304, headers={"etag": '"v1"'})
        return httpx.Response(200, text="body", headers={"etag": '"v1"', "last-modified": "Sat, 26 Sep 2026 06:00:00 GMT"})

    rec = Recorder({"/feed": cond})
    client, _ = client_for(rec)
    first = client.fetch("https://cond.test/feed")
    assert first.etag == '"v1"' and first.last_modified
    second = client.fetch("https://cond.test/feed", etag=first.etag, last_modified=first.last_modified)
    assert second.not_modified and second.content == b""
    assert rec.requests[-1].headers["if-modified-since"] == first.last_modified
