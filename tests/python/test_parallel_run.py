"""The comparison tool for the parallel run with Argo (docs/09)."""

from __future__ import annotations

import json

from services.parallel_run.compare import canonical_url, load_argo_items, match_items, summarise


def test_canonical_url_ignores_tracking_and_www():
    assert canonical_url("https://www.lusakatimes.com/a/b/?utm_source=x") == canonical_url("http://lusakatimes.com/a/b")


def test_matching_coverage_and_first_finder(tmp_path):
    argo = tmp_path / "argo.jsonl"
    argo.write_text("\n".join(json.dumps(x) for x in [
        {"title": "Diesel shortage hits Lusaka", "url": "https://diggers.news/x?utm_source=a", "reported_at": "2026-10-02T08:00:00Z"},
        {"title": "ERB reviews fuel prices for October - Lusaka Times", "url": "https://other.site/erb", "reported_at": "2026-10-01T10:00:00Z"},
        {"title": "Unrelated football result", "url": "https://sport.example/1", "reported_at": "2026-10-03T10:00:00Z"},
    ]))
    signals = [
        {"id": "s1", "title": "Diesel shortage hits Lusaka – Zambia: News Diggers!", "url": "https://www.diggers.news/x",
         "fetched_at": "2026-10-02T06:00:00+00:00"},
        {"id": "s2", "title": "ERB reviews fuel prices for October", "url": "https://www.lusakatimes.com/erb",
         "fetched_at": "2026-10-01T12:00:00+00:00"},
    ]
    results = match_items(load_argo_items(argo), signals)
    summary = summarise(results)
    assert summary["found"] == 2 and summary["argo_items"] == 3 and not summary["pass"]
    assert summary["found_first"] == {"strata": 1, "argo": 1, "same time": 0, "unknown": 0}
    assert summary["misses"][0]["reason"]
