"""docs/04-ingestion.md, collectors table: the Manual collector (an analyst uploads a file or a URL)."""

from __future__ import annotations

from pathlib import Path

import pytest

from .collector_support import activate_fixture_brief
from .conftest import bearer

pytestmark = pytest.mark.db

SITE = Path(__file__).resolve().parents[1] / "fixtures" / "site"


@pytest.fixture(scope="module")
def manual_setup(fresh_db, fixture_server, fake_clock):
    from services.common.db import connect

    with connect(fresh_db["app_url"]) as conn:
        return activate_fixture_brief(conn, fixture_server)


def test_manual_upload_of_a_text_file(manual_setup, client, auth, cdb):
    text = "Government Gazette notice: grant of a large-scale mining licence to Kitumba Mining Limited."
    r = client.post("/api/sources/manual", headers=bearer(auth("analyst", sub="analyst-1")),
                    files={"file": ("gazette.txt", text.encode(), "text/plain")},
                    data={"title": "Gazette notice", "publisher": "Government Gazette"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "new"
    src = cdb.execute("SELECT * FROM source WHERE id = %s", (body["source_id"],)).fetchone()
    assert src["type"] == "manual" and src["title"] == "Gazette notice" and src["publisher"] == "Government Gazette"
    assert src["licence_code"] == "verify_then_purge" and src["brief_version_id"] == manual_setup["id"]
    assert src["metadata"]["uploaded_by"] == "analyst-1" and src["metadata"]["kind"] == "file"
    again = client.post("/api/sources/manual", headers=bearer(auth("analyst")),
                        files={"file": ("copy.txt", text.encode(), "text/plain")}).json()
    assert again["source_id"] == body["source_id"] and again["status"] == "duplicate_url"


def test_manual_upload_of_a_pdf_file(manual_setup, client, auth, cdb):
    data = (SITE / "docs" / "zppa-haulage-tender.pdf").read_bytes()
    r = client.post("/api/sources/manual", headers=bearer(auth("analyst")),
                    files={"file": ("tender.pdf", data, "application/pdf")}, data={"licence_code": "full"})
    assert r.status_code == 201, r.text
    src = cdb.execute("SELECT * FROM source WHERE id = %s", (r.json()["source_id"],)).fetchone()
    assert src["type"] == "manual" and len(src["page_map"]) == 2 and src["retention_policy"] == "full"


def test_manual_upload_of_a_url(manual_setup, client, auth, cdb, fixture_server):
    url = f"{fixture_server.base_url}/notices/zema-eia-kitumba.html"
    r = client.post("/api/sources/manual", headers=bearer(auth("analyst")), json={"url": url})
    assert r.status_code == 201, r.text
    src = cdb.execute("SELECT * FROM source WHERE id = %s", (r.json()["source_id"],)).fetchone()
    assert src["url"] == url and src["metadata"]["kind"] == "url"
    assert "Kitumba" in src["excerpt"]


def test_manual_url_rules_still_apply(manual_setup, client, auth, fixture_server):
    """Web rules 1 and 5 apply to an analyst URL too. The analyst uploads the file instead."""
    headers = bearer(auth("analyst"))
    r = client.post("/api/sources/manual", headers=headers, json={"url": "https://www.miningweekly.com/article/x"})
    assert r.status_code == 422 and "google_news_only" in r.json()["detail"]
    r = client.post("/api/sources/manual", headers=headers,
                    json={"url": f"{fixture_server.base_url}/private/board-minutes.html"})
    assert r.status_code == 422 and "robots.txt" in r.json()["detail"]
    assert "/private/board-minutes.html" not in fixture_server.paths()
    r = client.post("/api/sources/manual", headers=headers, files={"file": ("a.txt", b"text", "text/plain")},
                    data={"licence_code": "stolen"})
    assert r.status_code == 422
