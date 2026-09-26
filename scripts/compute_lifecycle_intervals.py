#!/usr/bin/env python3
"""Compute lifecycle intervals from config/lifecycle-history.yaml.

Python 3.11, stdlib plus PyYAML only.

For each pair (from_stage -> target_stage) and for each consecutive pair in the
main and restart stage orders, the script calculates the median, min and max
interval in days and months, and lists the supporting projects.

Rules (all parameters come from the `settings` block of the input file):
- A project uses the earliest date of each stage (the first time it reached it).
- Each date becomes one point date from its precision (day, month, quarter, year).
- A negative interval that is inside the combined precision uncertainty of its
  two dates becomes 0 days (concurrent).
- A larger negative interval is "out of order". It is not in the statistics.
  The output lists it so that a reader can see how often it happens.
- An interval with fewer than `min_projects` projects gets insufficient: true.

Usage:
  python scripts/compute_lifecycle_intervals.py [--input PATH] [--output PATH]
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import statistics
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "config" / "lifecycle-history.yaml"
DEFAULT_OUTPUT = ROOT / "config" / "lifecycle-intervals.generated.yaml"

PRECISIONS = ("day", "month", "quarter", "year")


def parse_date(value: str, precision: str) -> dt.date:
    """Return the point date for a date string at the given precision."""
    s = str(value).strip()
    if precision == "day":
        return dt.date.fromisoformat(s)
    if precision == "month":
        m = re.fullmatch(r"(\d{4})-(\d{2})", s)
        if not m:
            raise ValueError(f"month date must be YYYY-MM, got {s!r}")
        return dt.date(int(m[1]), int(m[2]), 15)
    if precision == "quarter":
        m = re.fullmatch(r"(\d{4})-Q([1-4])", s)
        if not m:
            raise ValueError(f"quarter date must be YYYY-Qn, got {s!r}")
        middle_month = (int(m[2]) - 1) * 3 + 2
        return dt.date(int(m[1]), middle_month, 15)
    if precision == "year":
        m = re.fullmatch(r"(\d{4})", s)
        if not m:
            raise ValueError(f"year date must be YYYY, got {s!r}")
        return dt.date(int(m[1]), 7, 1)
    raise ValueError(f"unknown date_precision {precision!r}")


def first_dates(project: dict, known_stages: set[str]) -> dict[str, tuple[dt.date, str]]:
    """Map stage -> (earliest point date, precision) for one project."""
    out: dict[str, tuple[dt.date, str]] = {}
    for ms in project.get("milestones", []):
        stage = ms["stage"]
        if stage not in known_stages:
            raise ValueError(f"{project['id']}: unknown stage {stage!r}")
        for key in ("url", "publisher", "title"):
            if not ms.get(key):
                raise ValueError(f"{project['id']}/{stage}: missing {key}")
        precision = ms["date_precision"]
        if precision not in PRECISIONS:
            raise ValueError(f"{project['id']}/{stage}: bad precision {precision!r}")
        point = parse_date(ms["date"], precision)
        if stage not in out or point < out[stage][0]:
            out[stage] = (point, precision)
    return out


def interval(projects: list[dict], dates: dict[str, dict], frm: str, to: str,
             settings: dict) -> dict | None:
    half = settings["precision_half_width_days"]
    dpm = float(settings["days_per_month"])
    min_n = int(settings["min_projects"])

    values: list[tuple[str, int, bool]] = []
    out_of_order: list[dict] = []
    for p in projects:
        d = dates[p["id"]]
        if frm not in d or to not in d:
            continue
        (d_from, p_from), (d_to, p_to) = d[frm], d[to]
        days = (d_to - d_from).days
        tolerance = int(half[p_from]) + int(half[p_to])
        if days < 0:
            if -days <= tolerance:
                values.append((p["id"], 0, True))
            else:
                out_of_order.append({"project": p["id"], "days": days})
        else:
            values.append((p["id"], days, False))

    if not values and not out_of_order:
        return None

    row: dict = {"from": frm, "to": to}
    if values:
        days_list = [v[1] for v in values]
        med = statistics.median(days_list)
        row.update({
            "median_days": round(float(med), 1),
            "min_days": min(days_list),
            "max_days": max(days_list),
            "median_months": round(med / dpm, 1),
            "min_months": round(min(days_list) / dpm, 1),
            "max_months": round(max(days_list) / dpm, 1),
        })
    else:
        row.update({"median_days": None, "min_days": None, "max_days": None,
                    "median_months": None, "min_months": None, "max_months": None})
    row["n_projects"] = len(values)
    row["projects"] = [v[0] for v in values]
    row["project_days"] = {v[0]: v[1] for v in values}
    concurrent = [v[0] for v in values if v[2]]
    if concurrent:
        row["concurrent_projects"] = concurrent
    if out_of_order:
        row["out_of_order"] = out_of_order
    row["insufficient"] = len(values) < min_n
    return row


def compute(history: dict) -> dict:
    settings = history["settings"]
    stage_order: list[str] = settings["stage_order"]
    restart_order: list[str] = settings["restart_order"]
    target: str = settings["target_stage"]
    known = set(stage_order) | set(restart_order)
    projects = history["projects"]

    ids = [p["id"] for p in projects]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate project ids")
    dates = {p["id"]: first_dates(p, known) for p in projects}

    pairs: list[tuple[str, str]] = []

    def add(pair: tuple[str, str]) -> None:
        if pair[0] != pair[1] and pair not in pairs:
            pairs.append(pair)

    # 1. Every earlier stage -> target, in main order and restart order.
    for order in (stage_order, restart_order):
        if target in order:
            for frm in order[: order.index(target)]:
                add((frm, target))
    # 2. Consecutive pairs in both orders.
    for order in (stage_order, restart_order):
        for a, b in zip(order, order[1:], strict=False):
            add((a, b))

    rows = []
    for frm, to in pairs:
        row = interval(projects, dates, frm, to, settings)
        if row is not None:
            rows.append(row)

    return {
        "generated_by": "scripts/compute_lifecycle_intervals.py",
        "source": "config/lifecycle-history.yaml",
        "generated_on": dt.date.today().isoformat(),
        "min_projects": int(settings["min_projects"]),
        "n_history_projects": len(projects),
        "intervals": rows,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    ap.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = ap.parse_args(argv)

    history = yaml.safe_load(args.input.read_text(encoding="utf-8"))
    result = compute(history)
    header = ("# GENERATED FILE. Do not edit by hand.\n"
              "# Run: python scripts/compute_lifecycle_intervals.py\n")
    args.output.write_text(
        header + yaml.safe_dump(result, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    for r in result["intervals"]:
        flag = " INSUFFICIENT" if r["insufficient"] else ""
        print(f"{r['from']:>36} -> {r['to']:<26} n={r['n_projects']:<2} "
              f"median={r['median_months']} mo "
              f"[{r['min_months']}..{r['max_months']}]{flag}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
