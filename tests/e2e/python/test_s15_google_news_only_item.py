"""docs/09 scenario 15: a fixture item from a google_news_only site. Strata uses the item text only and sets
read_at_source.

The item is in the Google News search feed of the fixture server (gn/kansanshi-mine.xml). Its link points to
miningweekly.com, a google_news_only domain of the brief. The collector must not fetch the article.
"""

from __future__ import annotations

from .stack import wait_signal


def test_s15_a_google_news_only_item_uses_the_item_text_only_and_sets_read_at_source(api, acceptance, fixture_server):
    signal = wait_signal(api, "miningweekly.com", q="Kansanshi S3 expansion delivers first ore")
    assert signal["read_at_source"] is True
    source = api.ok(f"/api/sources/{signal['source_id']}")
    assert source["type"] == "google_news" and source["read_at_source"] is True
    assert source["retention_policy"] == "link_only" and source["text_available"] is False and source["text"] is None
    # The item text is the title and the publisher of the feed item only.
    assert source["text_length"] < 400, source["text_length"]
    # Neither the fixture server nor another host gave the article: the only request for this query was the feed.
    paths = fixture_server.paths()
    assert "/rss/search" in paths and not any("miningweekly" in p or "/article/" in p for p in paths)
    # Each evidence quote is a part of the item text (title and publisher).
    evidence = api.ok("/api/evidence", ids=signal["evidence_ids"])["items"] if signal["evidence_ids"] else []
    for e in evidence:
        assert e["quote"] in source["title"] or e["quote"] in (source["excerpt"] or ""), e["quote"]
        assert e["read_at_source"] is True
