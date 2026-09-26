"""Web collector: pages and sitemaps. Source: docs/04-ingestion.md, collectors table.

A page gives one document with the main text from trafilatura. A sitemap gives one document for each
page that it lists, up to the limit in config/collectors.yaml. A PDF response goes to the PDF extractor.
Each page fetch goes through the same HTTP client, so robots.txt, the rate limit and the
google_news_only guard apply to each page.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from xml.etree import ElementTree

from .base import CollectContext, parse_date
from .http import FetchError, FetchResult, ForbiddenDomainError, RobotsDisallowedError, domain_matches, host_of
from .pdf import extract_pdf
from .pipeline import Document
from .text import collectors_config

_SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


def is_pdf(result: FetchResult) -> bool:
    return result.content_type == "application/pdf" or result.content[:5] == b"%PDF-"


def sitemap_urls(content: bytes) -> list[str] | None:
    """The page URLs of a sitemap (urlset) or of a sitemap index. None if the content is not a sitemap."""
    head = content[:2048].lstrip()
    if not head.startswith(b"<?xml") and not head.startswith(b"<urlset") and not head.startswith(b"<sitemapindex"):
        return None
    try:
        root = ElementTree.fromstring(content)
    except ElementTree.ParseError:
        return None
    tag = root.tag.replace(_SITEMAP_NS, "")
    if tag not in ("urlset", "sitemapindex"):
        return None
    locs = [el.text.strip() for el in root.iter(f"{_SITEMAP_NS}loc") if el.text]
    if not locs:
        locs = [el.text.strip() for el in root.iter("loc") if el.text]
    return locs


def html_document(ctx: CollectContext, result: FetchResult, url: str) -> Document | None:
    import trafilatura

    html = result.content.decode(_charset(result), errors="replace")
    meta = trafilatura.extract_metadata(html, default_url=url)
    title = (meta.title if meta else None) or _title_tag(html)
    if ctx.link_only:
        description = meta.description if meta else None
        text = "\n\n".join(x for x in (title, description) if x)
    else:
        text = trafilatura.extract(html, url=url, include_comments=False, include_tables=True,
                                   output_format="txt") or trafilatura.html2txt(html) or ""
        if title and not text.startswith(title):
            text = f"{title}\n\n{text}"
    if not text.strip():
        return None
    return Document(
        url=url,
        source_type="web",
        text=text,
        title=title,
        publisher=ctx.source.publisher or (meta.sitename if meta else None),
        published_at=parse_date(meta.date if meta else None),
        raw=result.content,
        raw_content_type=result.content_type or "text/html",
        read_at_source=domain_matches(host_of(url), ctx.brief.get("google_news_only") or []),
        metadata={"final_url": result.url, "extractor": "trafilatura"},
    )


def pdf_document(ctx: CollectContext, result: FetchResult, url: str) -> Document:
    pdf = extract_pdf(result.content)
    metadata = {"final_url": result.url, "page_count": pdf.page_count, "extractor": "pdfplumber"}
    if pdf.ocr:
        metadata.update(ocr_engine=pdf.ocr_engine, ocr_pages=pdf.ocr_pages)
    return Document(
        url=url,
        source_type="pdf",
        text=pdf.text,
        title=pdf.title,
        publisher=ctx.source.publisher,
        raw=result.content,
        raw_content_type="application/pdf",
        page_map=pdf.page_map,
        ocr=pdf.ocr,
        read_at_source=domain_matches(host_of(url), ctx.brief.get("google_news_only") or []),
        metadata=metadata,
    )


def document_from_response(ctx: CollectContext, result: FetchResult, url: str) -> Document | None:
    if is_pdf(result):
        return pdf_document(ctx, result, url)
    return html_document(ctx, result, url)


def collect_web(ctx: CollectContext) -> Iterator[Document]:
    """A page, a PDF or a sitemap."""
    result = ctx.fetch(ctx.source.url)
    if result.not_modified:
        return
    urls = None if is_pdf(result) else sitemap_urls(result.content)
    if urls is None:
        doc = document_from_response(ctx, result, ctx.source.url)
        if doc:
            yield doc
        return
    limit = collectors_config()["web"]["max_sitemap_pages"]
    for page_url in urls[:limit]:
        try:
            page = ctx.fetch(page_url)
        except ForbiddenDomainError:
            ctx.skip(page_url, "google_news_only")
            continue
        except RobotsDisallowedError:
            ctx.skip(page_url, "robots_disallowed")
            continue
        except FetchError as exc:
            ctx.fail(page_url, exc)
            continue
        if page.not_modified:
            continue
        nested = None if is_pdf(page) else sitemap_urls(page.content)
        if nested is not None:
            ctx.skip(page_url, "nested_sitemap_not_followed")
            continue
        doc = document_from_response(ctx, page, page_url)
        if doc:
            yield doc


def collect_pdf(ctx: CollectContext) -> Iterator[Document]:
    result = ctx.fetch(ctx.source.url)
    if result.not_modified:
        return
    yield pdf_document(ctx, result, ctx.source.url)


_CHARSET = re.compile(rb"<meta[^>]+charset=[\"']?([A-Za-z0-9_-]+)", re.IGNORECASE)
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def _charset(result: FetchResult) -> str:
    ct = result.headers.get("content-type", "")
    if "charset=" in ct:
        return ct.split("charset=", 1)[1].split(";")[0].strip() or "utf-8"
    match = _CHARSET.search(result.content[:4096])
    return match.group(1).decode("ascii") if match else "utf-8"


def _title_tag(html: str) -> str | None:
    import html as html_lib

    match = _TITLE.search(html)
    return html_lib.unescape(match.group(1)).strip() if match else None
