"""The one HTTP client of all collectors. Source: docs/04-ingestion.md, rules for web collection.

1. It obeys robots.txt for each domain. A disallowed path is never fetched.
2. It sends one request for each domain every five seconds, or the interval that the brief source sets.
3. It sends a User-Agent that names Strata and gives the contact address from STRATA_CONTACT_EMAIL.
4. It never sends a request to a domain in google_news_only. It raises ForbiddenDomainError.
5. It retries a failed fetch three times with exponential backoff.
6. It sends conditional GET headers from fetch_state and gives the new validators to the caller.
"""

from __future__ import annotations

import logging
import threading
import time
import urllib.robotparser
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit

import httpx

from services.common.logging import log
from services.common.settings import get_settings

from .text import collectors_config

logger = logging.getLogger("strata.collectors.http")


class FetchError(Exception):
    def __init__(self, message: str, *, url: str, status: int | None = None, attempts: int = 1) -> None:
        super().__init__(message)
        self.url = url
        self.status = status
        self.attempts = attempts


class ForbiddenDomainError(FetchError):
    """The domain is in google_news_only. The client never sends the request."""


class RobotsDisallowedError(FetchError):
    """robots.txt disallows the path for Strata. The client never sends the request."""


@dataclass
class FetchResult:
    url: str
    status: int
    content: bytes
    headers: dict[str, str]
    attempts: int = 1
    not_modified: bool = False

    @property
    def content_type(self) -> str:
        return self.headers.get("content-type", "").split(";")[0].strip().lower()

    @property
    def etag(self) -> str | None:
        return self.headers.get("etag")

    @property
    def last_modified(self) -> str | None:
        return self.headers.get("last-modified")


def host_of(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().rstrip(".")


def domain_key(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc.lower()}"


def domain_matches(host: str, domains: Iterable[str]) -> bool:
    host = host.lower().rstrip(".")
    for d in domains:
        d = d.lower().strip().rstrip(".")
        if d and (host == d or host.endswith("." + d)):
            return True
    return False


class DomainRateLimiter:
    """One request for each domain in each interval. The clock and the sleep are injectable for tests."""

    def __init__(self, clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep) -> None:
        self.clock = clock
        self.sleep = sleep
        self._next: dict[str, float] = {}
        self._lock = threading.Lock()
        self.waits: list[tuple[str, float]] = []

    def wait(self, domain: str, interval: float) -> float:
        with self._lock:
            now = self.clock()
            ready = self._next.get(domain, now)
            delay = max(0.0, ready - now)
            self._next[domain] = max(now, ready) + interval
        if delay > 0:
            self.waits.append((domain, delay))
            self.sleep(delay)
        return delay


class FakeClock:
    """A clock for tests. sleep() moves the time forward and does not wait."""

    def __init__(self, start: float = 1000.0) -> None:
        self.now = start
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


_default_limiter: DomainRateLimiter | None = None
_default_sleep: Callable[[float], None] = time.sleep
_robots_cache: dict[str, tuple[float, urllib.robotparser.RobotFileParser | None, str]] = {}
_robots_lock = threading.Lock()


def get_default_limiter() -> DomainRateLimiter:
    """The limiter is shared by the process, so that all collectors respect the same interval."""
    global _default_limiter
    if _default_limiter is None:
        _default_limiter = DomainRateLimiter()
    return _default_limiter


def set_default_limiter(limiter: DomainRateLimiter | None, sleep: Callable[[float], None] | None = None) -> None:
    """Tests install a limiter with a fake clock, so that they do not sleep for real."""
    global _default_limiter, _default_sleep
    _default_limiter = limiter
    _default_sleep = sleep or time.sleep


def reset_robots_cache() -> None:
    with _robots_lock:
        _robots_cache.clear()


@dataclass
class HttpClient:
    google_news_only: list[str] = field(default_factory=list)
    limiter: DomainRateLimiter | None = None
    sleep: Callable[[float], None] | None = None
    transport: httpx.BaseTransport | None = None
    contact_email: str | None = None
    request_log: list[dict] = field(default_factory=list)
    refused: list[dict] = field(default_factory=list)

    def __post_init__(self) -> None:
        cfg = collectors_config()["http"]
        self.cfg = cfg
        self.limiter = self.limiter or get_default_limiter()
        self.sleep = self.sleep or _default_sleep
        email = self.contact_email or get_settings().contact_email
        self.user_agent = cfg["user_agent"].format(contact_email=email)
        self._client = httpx.Client(
            headers={"User-Agent": self.user_agent},
            timeout=cfg["timeout_seconds"],
            follow_redirects=False,
            transport=self.transport,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> HttpClient:
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # ---------- guards ----------

    def check_allowed_domain(self, url: str) -> None:
        host = host_of(url)
        if domain_matches(host, self.google_news_only):
            entry = {"url": url, "host": host, "reason": "google_news_only"}
            self.refused.append(entry)
            log(logger, logging.WARNING, "refused request to a google_news_only domain", url=url, host=host)
            raise ForbiddenDomainError(f"{host} is in google_news_only: the collectors never fetch it", url=url)

    def _robots(self, url: str, interval: float) -> urllib.robotparser.RobotFileParser | None:
        key = domain_key(url)
        now = time.time()
        with _robots_lock:
            cached = _robots_cache.get(key)
        if cached and cached[0] > now:
            return cached[1]
        robots_url = urljoin(key + "/", "/robots.txt")
        parser: urllib.robotparser.RobotFileParser | None
        try:
            resp = self._send(robots_url, interval, {})
            if resp.status_code == 200:
                parser = urllib.robotparser.RobotFileParser()
                parser.parse(resp.text.splitlines())
                ttl = self.cfg["robots_cache_seconds"]
                mode = "parsed"
            elif resp.status_code in (401, 403):
                parser, ttl, mode = None, self.cfg["robots_cache_seconds"], "disallow_all"
            elif 400 <= resp.status_code < 500:
                parser = urllib.robotparser.RobotFileParser()
                parser.parse([])
                ttl, mode = self.cfg["robots_cache_seconds"], "allow_all"
            else:
                parser, ttl, mode = None, self.cfg["robots_error_cache_seconds"], "disallow_all"
        except httpx.HTTPError:
            parser, ttl, mode = None, self.cfg["robots_error_cache_seconds"], "disallow_all"
        with _robots_lock:
            _robots_cache[key] = (now + ttl, parser, mode)
        return parser

    def robots_allowed(self, url: str, interval: float) -> bool:
        parser = self._robots(url, interval)
        if parser is None:
            return False
        return parser.can_fetch(self.cfg["robots_user_agent"], url)

    # ---------- requests ----------

    def _send(self, url: str, interval: float, headers: dict[str, str]) -> httpx.Response:
        self.check_allowed_domain(url)
        self.limiter.wait(domain_key(url), interval)
        started = time.monotonic()
        resp = self._client.get(url, headers=headers)
        self.request_log.append({"url": url, "status": resp.status_code})
        log(logger, logging.INFO, "http request", url=url, status=resp.status_code,
            ms=int((time.monotonic() - started) * 1000))
        return resp

    def fetch(
        self,
        url: str,
        *,
        rate_limit_seconds: float | None = None,
        etag: str | None = None,
        last_modified: str | None = None,
    ) -> FetchResult:
        """GET a URL with robots.txt, the domain guard, the rate limit, redirects and retries."""
        interval = self.cfg["default_rate_limit_seconds"] if rate_limit_seconds is None else rate_limit_seconds
        retry = self.cfg["retry"]
        current = url
        for _hop in range(self.cfg["max_redirects"] + 1):
            self.check_allowed_domain(current)
            if not self.robots_allowed(current, interval):
                log(logger, logging.INFO, "robots.txt disallows the path", url=current)
                raise RobotsDisallowedError(f"robots.txt disallows {current}", url=current)
            headers: dict[str, str] = {}
            if current == url:
                if etag:
                    headers["If-None-Match"] = etag
                if last_modified:
                    headers["If-Modified-Since"] = last_modified
            attempts = 0
            while True:
                attempts += 1
                error: str
                status: int | None = None
                try:
                    resp = self._send(current, interval, headers)
                    status = resp.status_code
                    if status not in retry["retry_statuses"]:
                        break
                    error = f"HTTP {status}"
                except (httpx.TransportError, httpx.DecodingError) as exc:
                    error = f"{type(exc).__name__}: {exc}"
                if attempts > retry["max_retries"]:
                    raise FetchError(f"{current}: {error} after {attempts} attempts", url=current, status=status,
                                     attempts=attempts)
                delay = retry["backoff_seconds"] * (2 ** (attempts - 1))
                log(logger, logging.WARNING, "fetch failed, retry", url=current, error=error, attempt=attempts,
                    delay_seconds=delay)
                self.sleep(delay)
            if resp.is_redirect and "location" in resp.headers:
                current = urljoin(current, resp.headers["location"])
                continue
            if resp.status_code == 304:
                return FetchResult(url=current, status=304, content=b"", headers={k.lower(): v for k, v in resp.headers.items()},
                                   attempts=attempts, not_modified=True)
            if resp.status_code >= 400:
                raise FetchError(f"{current}: HTTP {resp.status_code}", url=current, status=resp.status_code,
                                 attempts=attempts)
            content = resp.content
            if len(content) > self.cfg["max_bytes"]:
                raise FetchError(f"{current}: response larger than {self.cfg['max_bytes']} bytes", url=current,
                                 status=resp.status_code, attempts=attempts)
            return FetchResult(url=current, status=resp.status_code, content=content,
                               headers={k.lower(): v for k, v in resp.headers.items()}, attempts=attempts)
        raise FetchError(f"{url}: too many redirects", url=url)
