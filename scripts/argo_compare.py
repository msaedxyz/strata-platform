"""Compare an Argo export with the Strata signals of the same period (docs/09 parallel run).

Usage (inside the api container or with STRATA_DATABASE_URL set):
  python -m scripts.argo_compare --argo argo-items.jsonl --from 2026-10-01 --to 2026-10-15 --out reports/parallel-run
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from services.common.db import connect
from services.parallel_run.compare import load_argo_items, match_items, summarise


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--argo", required=True, help="Argo items as JSON Lines or CSV (title, url, reported_at, source)")
    p.add_argument("--from", dest="start", required=True)
    p.add_argument("--to", dest="end", required=True)
    p.add_argument("--out", default="reports/parallel-run")
    a = p.parse_args()
    argo = load_argo_items(a.argo)
    with connect() as conn:
        signals = conn.execute(
            "SELECT id, title, url, published_at, fetched_at, recorded_at, tier FROM proj_signal "
            "WHERE coalesce(fetched_at, recorded_at) BETWEEN %s::date - 7 AND %s::date + 7",
            (a.start, a.end),
        ).fetchall()
    results = match_items(argo, signals)
    summary = summarise(results)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "summary.json").write_text(json.dumps(summary, indent=2, default=str))
    (out / "matches.json").write_text(json.dumps([asdict(r) for r in results], indent=2, default=str))
    lines = ["# Parallel run with Argo", "", f"Period: {a.start} to {a.end}.", "",
             "| Value | Result |", "|---|---|",
             f"| Argo items | {summary['argo_items']} |", f"| Found by Strata | {summary['found']} |",
             f"| Coverage | {summary['coverage']:.1%} |", f"| Pass (95 percent or more) | {'yes' if summary['pass'] else 'no'} |",
             f"| Strata first | {summary['found_first']['strata']} |", f"| Argo first | {summary['found_first']['argo']} |",
             "", "## Misses", "", "| Argo item | Reason |", "|---|---|"]
    lines += [f"| {m['argo_id']} | {m['reason']} |" for m in summary["misses"]]
    (out / "results.md").write_text("\n".join(lines) + "\n")
    print(json.dumps(summary, indent=2, default=str))
    return 0 if summary["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
