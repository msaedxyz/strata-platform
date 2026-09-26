"""Local fixture server for the collector tests and `make fixtures`.

Run: python -m tests.fixtures.server --port 8765
Tests: start_server() starts it in a thread on a free port.

It serves the files under tests/fixtures/site. "{{BASE_URL}}" in a text file becomes the base URL.
- /robots.txt disallows /private/.
- /rss/search?q=... gives a Google News search feed for the query (gn/<slug>.xml, else an empty feed).
- It supports ETag and If-Modified-Since, and answers 304 when the file did not change.
- It logs every request. GET /_control/log gives the log as JSON.
- /_control/fail?path=/feeds/business.xml makes a path fail with HTTP 500. /_control/reset clears it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email.utils import format_datetime, parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

FIXTURE_DIR = Path(__file__).resolve().parent
SITE_DIR = FIXTURE_DIR / "site"
BRIEF_FIXTURE = FIXTURE_DIR / "brief-fixture.yaml"
LAST_MODIFIED = datetime(2026, 9, 26, 6, 0, tzinfo=UTC)
CONTENT_TYPES = {
    ".xml": "application/rss+xml; charset=utf-8",
    ".atom": "application/atom+xml; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".pdf": "application/pdf",
}
EMPTY_GN_FEED = (
    '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>{q} - Google News</title>'
    "<link>https://news.google.com/</link><description>Google News</description></channel></rss>"
)


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def fixture_brief_text(base_url: str) -> str:
    """The fixture brief with its sources pointed at the fixture server."""
    return BRIEF_FIXTURE.read_text(encoding="utf-8").replace("{{FIXTURE_BASE_URL}}", base_url.rstrip("/"))


@dataclass
class FixtureState:
    base_url: str = ""
    requests: list[dict] = field(default_factory=list)
    fail_paths: set[str] = field(default_factory=set)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def log(self, entry: dict) -> None:
        with self.lock:
            self.requests.append(entry)

    def paths(self) -> list[str]:
        with self.lock:
            return [r["path"] for r in self.requests]

    def clear_log(self) -> None:
        with self.lock:
            self.requests.clear()


def _handler(state: FixtureState, verbose: bool):
    class Handler(BaseHTTPRequestHandler):
        server_version = "StrataFixture/1.0"

        def log_message(self, fmt, *args):  # the state log replaces the default stderr log
            if verbose:
                super().log_message(fmt, *args)

        def _send(self, status: int, body: bytes = b"", content_type: str = "text/plain; charset=utf-8",
                  headers: dict | None = None) -> None:
            self.send_response(status)
            if status != 304:
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if body and self.command != "HEAD":
                self.wfile.write(body)

        def do_HEAD(self):  # noqa: N802
            self.do_GET()

        def do_POST(self):  # noqa: N802
            self.do_GET()

        def do_GET(self):  # noqa: N802
            parts = urlsplit(self.path)
            query = parse_qs(parts.query)
            entry = {"method": self.command, "path": parts.path, "query": parts.query,
                     "user_agent": self.headers.get("User-Agent"), "if_none_match": self.headers.get("If-None-Match"),
                     "if_modified_since": self.headers.get("If-Modified-Since"),
                     "at": datetime.now(UTC).isoformat()}
            status = self._route(parts.path, query)
            entry["status"] = status
            if not parts.path.startswith("/_control/"):
                state.log(entry)

        def _route(self, path: str, query: dict) -> int:
            if path == "/_control/fail":
                state.fail_paths.update(query.get("path", []))
                self._send(200, b"ok")
                return 200
            if path == "/_control/reset":
                state.fail_paths.clear()
                state.clear_log()
                self._send(200, b"ok")
                return 200
            if path == "/_control/log":
                with state.lock:
                    body = json.dumps(state.requests).encode()
                self._send(200, body, "application/json")
                return 200
            if path in state.fail_paths:
                self._send(500, b"fixture failure on demand")
                return 500
            if path == "/rss/search":
                q = (query.get("q") or [""])[0]
                file = SITE_DIR / "gn" / f"{slug(q)}.xml"
                if file.is_file():
                    body = file.read_bytes()
                else:
                    body = EMPTY_GN_FEED.format(q=q.replace("<", "").replace("&", "")).encode()
                return self._file_response(body, "application/rss+xml; charset=utf-8")
            file = (SITE_DIR / path.lstrip("/")).resolve()
            if SITE_DIR not in file.parents or not file.is_file():
                self._send(404, b"not found")
                return 404
            ctype = CONTENT_TYPES.get(file.suffix, "application/octet-stream")
            body = file.read_bytes()
            if not ctype.startswith("application/pdf"):
                body = body.replace(b"{{BASE_URL}}", state.base_url.encode())
            return self._file_response(body, ctype)

        def _file_response(self, body: bytes, ctype: str) -> int:
            etag = '"' + hashlib.sha1(body).hexdigest() + '"'
            headers = {"ETag": etag, "Last-Modified": format_datetime(LAST_MODIFIED, usegmt=True)}
            inm = self.headers.get("If-None-Match")
            ims = self.headers.get("If-Modified-Since")
            not_modified = False
            if inm is not None:
                not_modified = etag in [t.strip() for t in inm.split(",")]
            elif ims:
                try:
                    not_modified = parsedate_to_datetime(ims) >= LAST_MODIFIED
                except (TypeError, ValueError):
                    not_modified = False
            if not_modified:
                self._send(304, headers=headers)
                return 304
            self._send(200, body, ctype, headers)
            return 200

    return Handler


class FixtureServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 0, verbose: bool = False, public_url: str | None = None):
        self.state = FixtureState()
        self.httpd = ThreadingHTTPServer((host, port), _handler(self.state, verbose))
        self.host, self.port = self.httpd.server_address[0], self.httpd.server_address[1]
        self.base_url = (public_url or f"http://{self.host}:{self.port}").rstrip("/")
        self.state.base_url = self.base_url
        self._thread: threading.Thread | None = None

    @property
    def requests(self) -> list[dict]:
        return self.state.requests

    def paths(self) -> list[str]:
        return self.state.paths()

    def fail(self, path: str) -> None:
        self.state.fail_paths.add(path)

    def reset(self) -> None:
        self.state.fail_paths.clear()
        self.state.clear_log()

    def start(self) -> FixtureServer:
        self._thread = threading.Thread(target=self.httpd.serve_forever, daemon=True, name="fixture-server")
        self._thread.start()
        return self

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


def start_server(port: int = 0) -> FixtureServer:
    """Start the fixture server in a thread. Call stop() at the end."""
    return FixtureServer(port=port).start()


def main() -> None:
    parser = argparse.ArgumentParser(prog="fixture-server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--public-url", default=None, help="Base URL in the served files, for example http://fixtures:8765")
    args = parser.parse_args()
    import os

    public = args.public_url or os.environ.get("STRATA_FIXTURE_BASE_URL")
    server = FixtureServer(args.host, args.port, verbose=True, public_url=public)
    print(f"fixture server on {args.host}:{server.port}, base URL {server.base_url}", flush=True)
    try:
        server.httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
