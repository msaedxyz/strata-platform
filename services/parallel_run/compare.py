"""Compare the items that Argo reports with the Strata signals (docs/09, "Parallel run with Argo").

Input: a JSON Lines or CSV export of the Argo items with the fields title, url, reported_at (ISO time)
and optionally source. Output: coverage, a list of matches with the system that found each item first,
and each miss with its reason.
"""

from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from services.common.config import load_yaml


def settings() -> dict:
    return load_yaml("parallel-run.yaml")


def canonical_url(url: str | None, strip: list[str] | None = None) -> str:
    if not url:
        return ""
    strip = strip if strip is not None else settings()["strip_query_params"]
    parts = urlsplit(url.strip())
    host = parts.netloc.lower().removeprefix("www.").removeprefix("m.")
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query) if k.lower() not in strip])
    path = parts.path.rstrip("/") or "/"
    return urlunsplit(("", host, path, query, ""))


def normalise_title(title: str) -> str:
    title = re.split(r"\s[-|–]\s(?=[^-|–]*$)", title)[0]  # drop a trailing " - Publisher"
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", title.lower()).split())


def title_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, normalise_title(a), normalise_title(b)).ratio()


def _parse_time(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).replace("Z", "+00:00")
    if len(text) == 10:
        text += "T00:00:00+00:00"
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        from datetime import UTC

        dt = dt.replace(tzinfo=UTC)
    return dt


def load_argo_items(path: str | Path) -> list[dict]:
    path = Path(path)
    if path.suffix == ".csv":
        with open(path, encoding="utf-8", newline="") as fh:
            rows = list(csv.DictReader(fh))
    else:
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    for i, row in enumerate(rows):
        row.setdefault("id", f"argo-{i + 1:04d}")
        row["reported_at"] = _parse_time(row.get("reported_at"))
    return rows


@dataclass
class Match:
    argo_id: str
    signal_id: str | None
    method: str | None
    similarity: float
    argo_at: datetime | None
    strata_at: datetime | None
    first: str | None
    reason: str | None = None


def match_items(argo_items: list[dict], signals: list[dict]) -> list[Match]:
    cfg = settings()
    min_sim = cfg["match"]["title_similarity_min"]
    max_days = cfg["match"]["max_days_apart"]
    by_url: dict[str, dict] = {}
    for s in signals:
        by_url.setdefault(canonical_url(s.get("url")), s)
    results: list[Match] = []
    for item in argo_items:
        argo_at = item.get("reported_at")
        hit, method, sim = by_url.get(canonical_url(item.get("url"))), "url", 1.0
        if hit is None:
            best, best_sim = None, 0.0
            for s in signals:
                strata_at = _parse_time(s.get("fetched_at") or s.get("recorded_at"))
                if argo_at and strata_at and abs((strata_at - argo_at).days) > max_days:
                    continue
                score = title_similarity(item.get("title", ""), s.get("title", ""))
                if score > best_sim:
                    best, best_sim = s, score
            if best is not None and best_sim >= min_sim:
                hit, method, sim = best, "title", best_sim
        if hit is None:
            results.append(Match(item["id"], None, None, 0.0, argo_at, None, None,
                                 reason="no Strata signal with the same URL or a similar title"))
            continue
        strata_at = _parse_time(hit.get("fetched_at") or hit.get("recorded_at"))
        first = None
        if argo_at and strata_at:
            first = "strata" if strata_at < argo_at else "argo" if argo_at < strata_at else "same time"
        results.append(Match(item["id"], hit["id"], method, round(sim, 3), argo_at, strata_at, first))
    return results


def summarise(results: list[Match]) -> dict:
    found = [r for r in results if r.signal_id]
    coverage = len(found) / len(results) if results else 0.0
    firsts = {"strata": 0, "argo": 0, "same time": 0, "unknown": 0}
    for r in found:
        firsts[r.first or "unknown"] += 1
    return {
        "argo_items": len(results),
        "found": len(found),
        "coverage": round(coverage, 4),
        "pass": coverage >= settings()["pass_coverage"],
        "found_first": firsts,
        "misses": [{"argo_id": r.argo_id, "reason": r.reason} for r in results if not r.signal_id],
    }
