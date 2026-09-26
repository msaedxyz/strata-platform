"""RSS, Atom and Google News collectors. Source: docs/04-ingestion.md, collectors table.

RSS and Atom: parse the feed with feedparser. The context sends conditional GET headers.
Google News: one RSS search feed for each query in the brief, with the edition of the brief.
The item title and description are the source text. Google News items use link_only.
The collector never fetches the article of a Google News item.
"""

from __future__ import annotations

import base64
import binascii
import re
from collections.abc import Iterator
from urllib.parse import urlsplit

import feedparser

from .base import CollectContext, CollectError, raw_json, struct_to_datetime
from .http import domain_matches, host_of
from .pipeline import Document
from .text import html_to_text

_URL_IN_BYTES = re.compile(rb"https?://[\x21-\x7e]+")


def _parse(content: bytes, url: str) -> feedparser.FeedParserDict:
    feed = feedparser.parse(content)
    if feed.bozo and not feed.entries and not feed.get("feed"):
        raise CollectError(f"{url}: the feed does not parse: {feed.get('bozo_exception')}")
    return feed


def _entry_body(entry: feedparser.FeedParserDict) -> str:
    if entry.get("content"):
        return " ".join(c.get("value", "") for c in entry["content"])
    return entry.get("summary", "") or entry.get("description", "")


def _published(entry: feedparser.FeedParserDict):
    return struct_to_datetime(entry.get("published_parsed") or entry.get("updated_parsed"))


def collect_feed(ctx: CollectContext) -> Iterator[Document]:
    """An RSS 2.0 or Atom feed. Each entry is one document."""
    result = ctx.fetch(ctx.source.url)
    if result.not_modified:
        return
    feed = _parse(result.content, ctx.source.url)
    feed_title = feed.get("feed", {}).get("title")
    for entry in feed.entries:
        title = html_to_text(entry.get("title", "")).strip()
        link = entry.get("link") or f"{ctx.source.url}#{entry.get('id', title)}"
        summary = html_to_text(entry.get("summary", ""))
        body = summary if ctx.link_only else html_to_text(_entry_body(entry))
        yield Document(
            url=link,
            source_type="rss",
            text=f"{title}\n\n{body}",
            title=title or None,
            publisher=ctx.source.publisher or feed_title,
            published_at=_published(entry),
            raw=raw_json({"feed": ctx.source.url, "id": entry.get("id"), "title": entry.get("title"),
                          "link": entry.get("link"), "summary": entry.get("summary"),
                          "content": [c.get("value") for c in entry.get("content", [])],
                          "published": entry.get("published") or entry.get("updated")}),
            raw_content_type="application/json",
            read_at_source=domain_matches(host_of(link), ctx.brief.get("google_news_only") or []),
            metadata={"feed_url": ctx.source.url, "entry_id": entry.get("id"), "feed_title": feed_title},
        )


def decode_google_news_link(link: str) -> str | None:
    """The publisher URL inside an older Google News article link, or None.

    Newer links do not carry the URL. Then the item keeps the Google News link and the publisher site.
    """
    parts = urlsplit(link)
    if not (parts.hostname or "").endswith("news.google.com") or "/articles/" not in parts.path:
        return None
    token = parts.path.rsplit("/", 1)[-1]
    try:
        data = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
    except (binascii.Error, ValueError):
        return None
    match = _URL_IN_BYTES.search(data)
    return match.group(0).decode("ascii") if match else None


def collect_google_news(ctx: CollectContext) -> Iterator[Document]:
    """A Google News RSS search feed. Title and description only. Never fetch the article."""
    result = ctx.fetch(ctx.source.url)
    if result.not_modified:
        return
    feed = _parse(result.content, ctx.source.url)
    gn_only = ctx.brief.get("google_news_only") or []
    for entry in feed.entries:
        title = html_to_text(entry.get("title", "")).strip()
        description = html_to_text(entry.get("summary", "") or entry.get("description", ""))
        gn_link = entry.get("link") or ""
        source_info = entry.get("source") or {}
        publisher_url = source_info.get("href")
        publisher = source_info.get("title") or (host_of(publisher_url) if publisher_url else None)
        decoded = decode_google_news_link(gn_link)
        is_gn_link = host_of(gn_link).endswith("news.google.com")
        original = decoded or (gn_link if not is_gn_link else None)
        url = original or gn_link
        read_at_source = any(
            u and domain_matches(host_of(u), gn_only) for u in (original, publisher_url)
        )
        extra = [gn_link] if gn_link and gn_link != url else []
        yield Document(
            url=url,
            source_type="google_news",
            text=f"{title}\n\n{description}",
            title=title or None,
            publisher=publisher,
            published_at=_published(entry),
            raw=None,
            read_at_source=read_at_source,
            extra_urls=extra,
            metadata={
                "google_news_link": gn_link,
                "original_url": original,
                "publisher_url": publisher_url,
                "query": ctx.source.query,
                "query_id": ctx.source.id,
                "guid": entry.get("id"),
            },
        )
