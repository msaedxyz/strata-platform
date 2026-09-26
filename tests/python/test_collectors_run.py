"""docs/04-ingestion.md criteria 1, 2, 3, 4, 5, 8 and 11: a full collector run against the fixture server."""

from __future__ import annotations

import pytest

from .collector_support import activate_fixture_brief, fixture_url, run_fixture
from .conftest import bearer

pytestmark = pytest.mark.db

MININGWEEKLY_ARTICLE = "https://www.miningweekly.com/article/kansanshi-s3-first-ore-2026-09-20"
GN_NO_EMBEDDED_URL = "https://news.google.com/rss/articles/AU_yqLfixtureNoEmbeddedUrl01?oc=5"


def expected_urls(server) -> dict[str, str]:
    """Each fixture document and the brief source that finds it first."""
    u = server.base_url
    return {
        MININGWEEKLY_ARTICLE: "fx_gn_kansanshi",
        GN_NO_EMBEDDED_URL: "fx_gn_kansanshi",
        "https://zambianbusinesstimes.com/kansanshi-diesel-supply-tender/": "fx_gn_kansanshi",
        "https://www.znbc.co.zm/news/kasumbalesa-border-delays-cost-transporters/": "fx_gn_kasumbalesa",
        "https://www.radiookapi.net/2026/09/23/kasumbalesa-camions-bloques": "fx_gn_kasumbalesa",
        f"{u}/mining/2026/09/kansanshi-s3-contracts.html": "fx_rss_mining",
        f"{u}/mining/2026/09/mufulira-suspended.html": "fx_rss_mining",
        f"{u}/mining/2026/09/kcm-konkola-deep-plan.html": "fx_rss_mining",
        f"{u}/business/2026/09/fqm-kansanshi-contracts.html?utm_source=feed": "fx_rss_business",
        f"{u}/business/2026/09/kcm-plan-konkola-deep.html": "fx_rss_business",
        f"{u}/business/2026/09/copperbelt-fuel-shortage.html": "fx_rss_business",
        f"{u}/logistics/2026/09/kasumbalesa-queues.html": "fx_atom_logistics",
        f"{u}/logistics/2026/09/erb-october-prices.html": "fx_atom_logistics",
        f"{u}/news/lumwana-expansion.html": "fx_web_lumwana",
        f"{u}/notices/zema-eia-kitumba.html": "fx_sitemap",
        f"{u}/docs/zppa-haulage-tender.pdf": "fx_pdf_zppa",
        f"{u}/docs/erb-fuel-prices-scanned.pdf": "fx_pdf_erb",
    }


@pytest.fixture(scope="module")
def first_run(fresh_db, fixture_server, fake_clock):
    from services.common.db import connect

    with connect(fresh_db["app_url"]) as conn:
        brief = activate_fixture_brief(conn, fixture_server)
        results, client = run_fixture(conn, fixture_server, fake_clock)
    return {"brief": brief, "results": results, "client": client}


def _source_for(conn, url):
    return conn.execute(
        "SELECT s.* FROM source_url u JOIN source s ON s.id = u.source_id WHERE u.url = %s", (url,)
    ).fetchone()


def test_c04_01_full_run_collects_every_fixture_document(first_run, cdb, fixture_server):
    """Criterion 1: a full run collects every fixture document and stamps the active brief version."""
    results = {r.brief_source_id: r for r in first_run["results"]}
    assert all(r.status == "success" for r in results.values()), {k: r.error for k, r in results.items()}
    assert set(results) == {"fx_gn_kansanshi", "fx_gn_kasumbalesa", "fx_rss_mining", "fx_rss_business",
                            "fx_atom_logistics", "fx_web_lumwana", "fx_sitemap", "fx_pdf_zppa", "fx_pdf_erb"}
    brief_id = first_run["brief"]["id"]
    active = cdb.execute("SELECT id FROM active_brief").fetchone()
    assert active["id"] == brief_id
    for url in expected_urls(fixture_server):
        src = _source_for(cdb, url)
        assert src is not None, f"not collected: {url}"
        assert src["brief_version_id"] == brief_id
    sources = cdb.execute("SELECT * FROM source").fetchall()
    assert len(sources) == 16
    assert all(s["brief_version_id"] == brief_id for s in sources)
    runs = cdb.execute("SELECT * FROM collector_run WHERE status = 'success'").fetchall()
    assert {r["brief_source_id"] for r in runs} == set(results)
    assert all(r["brief_version_id"] == brief_id for r in runs)


def test_c04_01_pipeline_stores_text_hashes_language_and_excerpt(first_run, cdb, fixture_server):
    """Pipeline steps 2 to 9: object storage, NFC text, hashes, language, excerpt and retention."""
    from services.collectors.text import content_hash, normalise
    from services.common.storage import get_storage

    storage = get_storage()
    for s in cdb.execute("SELECT * FROM source").fetchall():
        text = storage.get(s["text_uri"]).decode("utf-8")
        assert text == normalise(text)
        assert s["content_hash"] == content_hash(text)
        assert s["simhash"] is not None
        assert s["excerpt"] and len(s["excerpt"]) <= 280
        assert s["text_length"] == len(text)
    lumwana = _source_for(cdb, fixture_url(fixture_server, "/news/lumwana-expansion.html"))
    assert lumwana["type"] == "web" and lumwana["language"] == "en"
    assert lumwana["retention_policy"] == "verify_then_purge" and lumwana["purge_after"] is not None
    assert storage.exists(lumwana["raw_uri"])
    assert "Most read" not in storage.get(lumwana["text_uri"]).decode()  # trafilatura keeps the main text only
    french = _source_for(cdb, "https://www.radiookapi.net/2026/09/23/kasumbalesa-camions-bloques")
    assert french["language"] == "fr"


def test_c04_01_google_news_items_are_link_only_title_and_description(first_run, cdb, fixture_server):
    """Google News: the item title and description are the text, licence link_only, publisher link kept."""
    from services.common.storage import get_storage

    gn = cdb.execute("SELECT * FROM source WHERE type = 'google_news' ORDER BY url").fetchall()
    assert len(gn) == 5
    for s in gn:
        assert s["licence_code"] == "gn_link_only" and s["retention_policy"] == "link_only"
        assert s["raw_uri"] is None
        assert s["metadata"]["google_news_link"]
        assert s["metadata"]["query_id"] in ("fx_gn_kansanshi", "fx_gn_kasumbalesa")
    mw = _source_for(cdb, MININGWEEKLY_ARTICLE)
    assert mw["read_at_source"] is True
    assert mw["metadata"]["original_url"] == MININGWEEKLY_ARTICLE
    assert mw["metadata"]["publisher_url"] == "https://www.miningweekly.com"
    text = get_storage().get(mw["text_uri"]).decode()
    assert text.startswith("Kansanshi S3 expansion delivers first ore to the new plant - Mining Weekly")
    other = _source_for(cdb, GN_NO_EMBEDDED_URL)
    assert other["read_at_source"] is False
    assert other["metadata"]["publisher_url"] == "https://www.lusakatimes.com"
    # The Google News request carries the edition of the brief.
    gn_requests = [r for r in fixture_server.requests if r["path"] == "/rss/search"]
    assert any("hl=en-ZM" in r["query"] and "gl=ZM" in r["query"] and "ceid=ZM%3Aen" in r["query"]
               for r in gn_requests)


def test_c04_02_one_article_in_two_feeds_gives_one_source_and_two_urls(first_run, cdb, fixture_server):
    """Criterion 2: the same article in mining.xml and business.xml gives one source with two URLs."""
    a = _source_for(cdb, fixture_url(fixture_server, "/mining/2026/09/kansanshi-s3-contracts.html"))
    b = _source_for(cdb, fixture_url(fixture_server, "/business/2026/09/fqm-kansanshi-contracts.html?utm_source=feed"))
    assert a["id"] == b["id"]
    urls = cdb.execute("SELECT url, brief_source_id FROM source_url WHERE source_id = %s", (a["id"],)).fetchall()
    assert len(urls) == 2
    assert {u["brief_source_id"] for u in urls} == {"fx_rss_mining", "fx_rss_business"}
    count = cdb.execute("SELECT count(*) AS n FROM source WHERE title = %s", (a["title"],)).fetchone()["n"]
    assert count == 1


def test_c04_03_near_duplicate_gets_duplicate_of_first_source(first_run, cdb, fixture_server):
    """Criterion 3: the KCM article with small wording changes gets duplicate_of set to the first source."""
    first = _source_for(cdb, fixture_url(fixture_server, "/mining/2026/09/kcm-konkola-deep-plan.html"))
    near = _source_for(cdb, fixture_url(fixture_server, "/business/2026/09/kcm-plan-konkola-deep.html"))
    assert first["id"] != near["id"]
    assert first["content_hash"] != near["content_hash"]
    assert first["duplicate_of"] is None
    assert near["duplicate_of"] == first["id"]
    # Unrelated articles are not near duplicates.
    assert cdb.execute("SELECT count(*) AS n FROM source WHERE duplicate_of IS NOT NULL").fetchone()["n"] == 1


def test_c04_05_robots_disallowed_path_is_never_fetched(first_run, fixture_server, cdb):
    """Criterion 5: the sitemap lists /private/board-minutes.html. robots.txt disallows it. No request."""
    paths = fixture_server.paths()
    assert "/robots.txt" in paths
    assert "/sitemap.xml" in paths
    assert not any(p.startswith("/private/") for p in paths)
    run = cdb.execute("SELECT detail FROM collector_run WHERE brief_source_id = 'fx_sitemap' "
                      "ORDER BY started_at LIMIT 1").fetchone()
    reasons = {s["reason"] for s in run["detail"]["skipped"]}
    assert "robots_disallowed" in reasons


def test_c04_08_scanned_pdf_gives_text_page_map_and_ocr_flag(first_run, cdb, fixture_server):
    """Criterion 8: the PDF with no text layer gives text (OCR), a page map and the OCR flag."""
    from services.common.storage import get_storage

    scanned = _source_for(cdb, fixture_url(fixture_server, "/docs/erb-fuel-prices-scanned.pdf"))
    assert scanned["type"] == "pdf"
    assert scanned["ocr"] is True
    assert scanned["page_map"] == [{"page": 1, "start": 0}]
    assert scanned["metadata"]["ocr_engine"] in ("tesseract", "rapidocr")
    assert scanned["metadata"]["ocr_pages"] == [1]
    text = get_storage().get(scanned["text_uri"]).decode()
    squashed = text.replace(" ", "").upper()
    assert "ENERGYREGULATIONBOARD" in squashed
    assert "OCTOBER2026" in squashed
    tender = _source_for(cdb, fixture_url(fixture_server, "/docs/zppa-haulage-tender.pdf"))
    assert tender["ocr"] is False
    tender_text = get_storage().get(tender["text_uri"]).decode()
    pages = tender["page_map"]
    assert [p["page"] for p in pages] == [1, 2]
    assert tender_text[pages[0]["start"]:].startswith("ZAMBIA PUBLIC PROCUREMENT AUTHORITY")
    assert tender_text[pages[1]["start"]:].startswith("INSTRUCTIONS TO BIDDERS")


def test_c04_11_no_direct_request_to_a_google_news_only_site(first_run, cdb):
    """Criterion 11: the sitemap lists a miningweekly.com page. The client refuses it and sends nothing."""
    client = first_run["client"]
    sent_hosts = {r["url"].split("/")[2] for r in client.request_log}
    assert not any(h == "miningweekly.com" or h.endswith(".miningweekly.com") for h in sent_hosts)
    assert any("miningweekly.com" in r["host"] for r in client.refused)
    run = cdb.execute("SELECT detail FROM collector_run WHERE brief_source_id = 'fx_sitemap' "
                      "ORDER BY started_at LIMIT 1").fetchone()
    assert "google_news_only" in {s["reason"] for s in run["detail"]["skipped"]}


def test_c04_01_user_agent_names_strata_with_contact(first_run, fixture_server):
    """Web rule 3: the User-Agent names Strata and gives the contact address from configuration."""
    from services.common.settings import get_settings

    agents = {r["user_agent"] for r in fixture_server.requests}
    assert agents == {f"Strata/0.1 (+contact: {get_settings().contact_email})"}


def test_c04_api_source_hides_text_unless_licence_full(first_run, cdb, client, auth, fixture_server):
    """Licence and retention: the API never returns the full text of a source whose licence is not full."""
    lumwana = _source_for(cdb, fixture_url(fixture_server, "/news/lumwana-expansion.html"))
    r = client.get(f"/api/sources/{lumwana['id']}", headers=bearer(auth("viewer")))
    assert r.status_code == 200
    body = r.json()
    assert body["text"] is None and body["text_available"] is False
    assert body["excerpt"] and body["links"][0]["url"] == lumwana["url"]
    erb = _source_for(cdb, fixture_url(fixture_server, "/docs/erb-fuel-prices-scanned.pdf"))
    body = client.get(f"/api/sources/{erb['id']}", headers=bearer(auth("viewer"))).json()
    assert body["retention_policy"] == "full" and body["text_available"] is True
    assert "ENERGY" in body["text"].upper()
    assert client.get("/api/sources/nope", headers=bearer(auth("viewer"))).status_code == 404


def test_c04_api_source_health_and_known_gaps(first_run, client, auth):
    """Scheduling and health: last success, error rate, documents for each run, next run, known gaps."""
    r = client.get("/api/sources/health", headers=bearer(auth("viewer")))
    assert r.status_code == 200
    body = r.json()
    rows = {s["id"]: s for s in body["sources"]}
    assert rows["fx_rss_mining"]["last_success_at"] is not None
    assert rows["fx_rss_mining"]["error_rate"] == 0.0
    assert rows["fx_rss_mining"]["documents_per_run"] == 3.0
    assert rows["fx_rss_mining"]["next_run_at"]
    assert body["known_gaps"][0]["name"] == "Zambia Mining Cadastre"
    gaps = client.get("/api/sources/known-gaps", headers=bearer(auth("viewer"))).json()
    assert gaps["known_gaps"][0]["reason"]


def test_c04_04_second_run_with_no_changed_fixtures_creates_zero_new_sources(first_run, cdb, fixture_server,
                                                                             fake_clock):
    """Criterion 4: a second run with no changed fixtures creates zero new sources."""
    before = cdb.execute("SELECT count(*) AS n FROM source").fetchone()["n"]
    urls_before = cdb.execute("SELECT count(*) AS n FROM source_url").fetchone()["n"]
    fixture_server.reset()
    results, _ = run_fixture(cdb, fixture_server, fake_clock)
    assert all(r.status == "success" for r in results)
    assert sum(r.new for r in results) == 0
    assert cdb.execute("SELECT count(*) AS n FROM source").fetchone()["n"] == before
    assert cdb.execute("SELECT count(*) AS n FROM source_url").fetchone()["n"] == urls_before
    # Conditional GET: the feeds answer 304 to the stored ETag.
    feed_requests = [r for r in fixture_server.requests if r["path"] == "/feeds/mining.xml"]
    assert feed_requests and feed_requests[-1]["status"] == 304
    assert feed_requests[-1]["if_none_match"]
