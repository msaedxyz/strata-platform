"""Pipeline helpers of docs/04-ingestion.md: normalisation, hashes, simhash, language, Google News links,
snapshot dates and the PDF page map. No database."""

from __future__ import annotations

from pathlib import Path

from services.collectors.feeds import decode_google_news_link
from services.collectors.snapshot import parse_snapshot_date
from services.collectors.text import content_hash, detect_language, excerpt, hamming, html_to_text, normalise, simhash

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "site"

ARTICLE = (
    "Konkola Copper Mines has published a two year plan for the Konkola Deep Mining Project in Chililabombwe "
    "and for the Nchanga smelter in Chingola. The plan follows the restart of the Nchanga smelter after a shutdown. "
    "KCM will first complete the dewatering of the underground mine and install new pumps at the number four shaft. "
    "The second phase is the development of the Konkola Deep orebody with a shaft sinking contractor and an "
    "underground mining contractor after a tender process in the first quarter of 2027. The company will also buy "
    "a new fleet of underground loaders and trucks and will need more diesel, explosives and mining services."
)


def test_normalise_gives_nfc_and_unix_line_endings():
    decomposed = "Miné de cuivre\r\nline two\rline three  \n\n\n\nend here"
    out = normalise(decomposed)
    assert out == "Miné de cuivre\nline two\nline three\n\nend here"
    assert normalise(out) == out
    assert "  indented" in normalise("key:\n  indented")  # indentation stays


def test_content_hash_is_sha256_of_the_normalised_text():
    import hashlib

    text = normalise("Kansanshi\r\n")
    assert content_hash(text) == hashlib.sha256(b"Kansanshi").hexdigest()


def _feed_item(name: str, guid: str) -> str:
    import feedparser

    feed = feedparser.parse((FIXTURES / "feeds" / name).read_bytes())
    entry = next(e for e in feed.entries if e.id == guid)
    return normalise(entry.title + "\n\n" + html_to_text(entry.content[0].value))


def test_simhash_is_near_for_small_wording_changes_and_far_for_other_text():
    """The fixture KCM article (about 350 words) and its copy with two changed phrases."""
    first = _feed_item("mining.xml", "fixture-kcm-konkola-deep-plan")
    near = _feed_item("business.xml", "biz-kcm-konkola-deep-plan")
    other = _feed_item("business.xml", "biz-copperbelt-fuel-shortage")
    assert first != near
    a, b, c = simhash(first), simhash(near), simhash(other)
    assert -(2**63) <= a < 2**63
    assert hamming(a, b) <= 3
    assert hamming(a, c) > 10
    assert simhash(first) == a  # deterministic


def test_language_detection_gives_iso_639_1_codes():
    assert detect_language(ARTICLE) == "en"
    assert detect_language("Les camions de cuivre restent bloqués à la frontière de Kasumbalesa pendant trois jours") == "fr"
    assert detect_language("ok") is None


def test_excerpt_is_280_characters_at_most():
    assert len(excerpt(ARTICLE * 3)) == 280
    assert excerpt("a\n\nb") == "a b"


def test_html_to_text_keeps_paragraphs():
    assert html_to_text("<p>One &amp; two</p><p>Three</p>").split() == ["One", "&", "two", "Three"]


def test_google_news_link_decoding():
    link = ("https://news.google.com/rss/articles/CBMiRmh0dHBzOi8vd3d3Lm1pbmluZ3dlZWtseS5jb20vYXJ0aWNsZS9rYW5zYW5zaGkt"
            "czMtZmlyc3Qtb3JlLTIwMjYtMDktMjDSAQA?oc=5")
    assert decode_google_news_link(link) == "https://www.miningweekly.com/article/kansanshi-s3-first-ore-2026-09-20"
    assert decode_google_news_link("https://news.google.com/rss/articles/AU_yqLfixtureNoEmbeddedUrl01?oc=5") is None
    assert decode_google_news_link("https://www.znbc.co.zm/news/x/") is None


def test_snapshot_month_dates_give_the_first_day_and_the_precision():
    d, p = parse_snapshot_date("2026-04")
    assert (d.year, d.month, d.day, p) == (2026, 4, 1, "month")
    d, p = parse_snapshot_date("2026-04-16")
    assert (d.day, p) == (16, "day")
    assert parse_snapshot_date(None) == (None, None)


def test_pdf_page_map_offsets_point_into_the_normalised_text():
    from services.collectors.pdf import extract_pdf

    pdf = extract_pdf((FIXTURES / "docs" / "zppa-haulage-tender.pdf").read_bytes())
    assert normalise(pdf.text) == pdf.text
    assert pdf.page_count == 2 and not pdf.ocr
    starts = [p["start"] for p in pdf.page_map]
    assert starts[0] == 0 and pdf.text[starts[1] - 2:starts[1]] == "\n\n"
    assert pdf.text[starts[1]:].startswith("INSTRUCTIONS TO BIDDERS")
