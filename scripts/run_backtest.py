"""Run the lead time backtest and write reports/backtest/results.json and results.md (docs/09-acceptance.md).

Two modes:
1. Default. The harness uses the database in STRATA_DATABASE_URL. The database must be fresh. When
   STRATA_ADMIN_DATABASE_URL is set, the script runs the migrations first.
2. --scratch-db. The script makes a throwaway database on the server in STRATA_TEST_ADMIN_URL (a superuser
   URL), runs the migrations, runs the backtest and drops the database. Object storage goes to a
   temporary directory.

The replay uses the backend in config/backtest.yaml (deterministic), so the run repeats.

    uv run python scripts/run_backtest.py --scratch-db
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import uuid
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse, urlunparse

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

OUT_DIR = REPO_ROOT / "reports" / "backtest"


def _with_db(url: str, dbname: str, user: str | None = None, password: str | None = None) -> str:
    parts = urlparse(url)
    netloc = parts.netloc
    if user is not None:
        host = netloc.split("@", 1)[-1]
        netloc = f"{user}:{password}@{host}" if password else f"{user}@{host}"
    return urlunparse(parts._replace(path=f"/{dbname}", netloc=netloc))


@contextmanager
def scratch_database(admin_url: str):
    """A throwaway database. The role passwords follow tests/python/conftest.py, because roles are cluster
    wide and a test session on the same server must keep working."""
    import psycopg

    seed = hashlib.sha256(admin_url.encode()).hexdigest()
    os.environ.setdefault("STRATA_APP_DB_PASSWORD", f"t{seed[:24]}")
    os.environ.setdefault("STRATA_OWNER_DB_PASSWORD", f"o{seed[24:48]}")
    dbname = f"strata_backtest_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{dbname}"')
    os.environ["STRATA_ADMIN_DATABASE_URL"] = _with_db(admin_url, dbname)
    os.environ["STRATA_DATABASE_URL"] = _with_db(admin_url, dbname, "strata_app", os.environ["STRATA_APP_DB_PASSWORD"])
    os.environ.pop("STRATA_S3_ENDPOINT_URL", None)
    with tempfile.TemporaryDirectory(prefix="strata-backtest-") as storage:
        os.environ["STRATA_STORAGE_DIR"] = storage
        try:
            yield dbname
        finally:
            from services.common.db import close_pool

            close_pool()
            with psycopg.connect(admin_url, autocommit=True) as conn:
                conn.execute(f'DROP DATABASE IF EXISTS "{dbname}" WITH (FORCE)')


def run() -> dict:
    from services.backtest.runner import config
    from services.backtest.runner import run as run_backtest
    from services.common.db import connect
    from services.common.migrate import migrate
    from services.common.settings import get_settings

    os.environ["STRATA_AGENT_BACKEND"] = config()["replay"]["backend"]
    get_settings.cache_clear()
    if os.environ.get("STRATA_ADMIN_DATABASE_URL"):
        migrate(os.environ["STRATA_ADMIN_DATABASE_URL"])
    with connect() as conn:
        return run_backtest(conn)


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


def _status(passed: bool) -> str:
    return "Pass" if passed else "Fail"


def _cell(text) -> str:
    # Simplified Technical English: no semicolon and no em dash in the report, also not from the data.
    text = str(text if text is not None else "")
    return text.replace("|", "/").replace("\n", " ").replace(";", ",").replace("—", ",")


def _fmt_rate(value) -> str:
    return "none" if value is None else f"{value * 100:.0f} percent"


def _fmt_months(value) -> str:
    return "none" if value is None else f"{value:.1f} months"


def markdown(result: dict) -> str:
    s = result["summary"]
    rate, median, count = (next(c for c in s["conditions"] if c["id"] == k)
                           for k in ("detection_rate", "median_lead", "event_count"))
    lines = [
        "# Lead time backtest results",
        "",
        f"Run date: {result['run_at'][:10]} (UTC {result['run_at'][11:19]}). "
        f"Backend: {result['backend']}. Brief version: {result['brief_version']}.",
        "",
        f"Dataset: {result['dataset']['events']} events and {result['dataset']['traces']} traces "
        f"({result['dataset']['documents']} distinct documents). Files: {result['dataset']['events_file']} and "
        f"{result['dataset']['traces_file']}.",
        "",
        "scripts/run_backtest.py writes this file. Do not edit it by hand.",
        "",
        "## Result",
        "",
        "| Condition | Value | Threshold | Status |",
        "|---|---|---|---|",
        f"| {rate['text']} | {_fmt_rate(rate['value'])} ({s['detected']} of {s['events']}) "
        f"| {_fmt_rate(rate['threshold'])} | {_status(rate['passed'])} |",
        f"| {median['text']} | {_fmt_months(median['value'])} | {_fmt_months(median['threshold'])} | "
        f"{_status(median['passed'])} |",
        f"| {count['text']} | {count['value']} | {count['threshold']} | {_status(count['passed'])} |",
        "",
    ]
    if s["docs09_conditions_passed"] and not s["passed"]:
        lines.append(f"The two pass conditions of docs/09 are true. The dataset has only {count['value']} events. "
                     f"docs/09 needs {count['threshold']} or more. The backtest therefore does not pass yet.")
    elif s["passed"]:
        lines.append("All three conditions are true. The backtest passes.")
    else:
        lines.append("One or more pass conditions of docs/09 are false. The backtest does not pass.")
    lines.append("")
    if s["company_level_hits"]:
        lines.append(f"{s['company_level_hits']} of the detected events have a company level signal only.")
        lines.append("")
    iw = s["in_window_only"]
    lines += [
        f"Events in the window {result['window']['start']} to {result['window']['end']} only: "
        f"{iw['detected']} of {iw['events']} detected, median lead time {_fmt_months(iw['median_lead_months'])}. "
        f"The window is {'strict' if result['window']['strict'] else 'not strict'}, "
        "so the conditions above use all events.",
        "",
        "## Events",
        "",
        "| Event | Date | Project | Type | First signal date | First signal title | Tier | Match | Lead time |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for r in result["events"]:
        flag = "" if r["in_window"] else " (outside the window)"
        if r.get("detected"):
            lines.append(
                f"| {r['event_id']}{flag} | {r['date']} | {_cell(r['project'])} | {_cell(r['event_type'])} | "
                f"{r['first_signal_date']} | {_cell(r['first_signal_title'])} | {r['first_signal_tier']} | "
                f"{_cell(' and '.join(r['match_all']))} | {r['lead_days']} days "
                f"({r['lead_months']:.1f} months) |")
        else:
            lines.append(
                f"| {r['event_id']}{flag} | {r['date']} | {_cell(r['project'])} | {_cell(r['event_type'])} | "
                f"Miss | {_cell(r['reason_text'])} | | {_cell(r['reason'])} | none |")
    misses = [r for r in result["events"] if not r.get("detected")]
    lines += ["", "## Misses", ""]
    if not misses:
        lines.append("Strata found an earlier signal for each event. There is no miss.")
    for r in misses:
        lines.append(f"### {r['event_id']}: {_cell(r['project'])}")
        lines.append("")
        lines.append(f"Reason: {r['reason']}. {r['reason_text']}")
        if r.get("late_signal_date"):
            lines.append(f"The first matching signal is on {r['late_signal_date']}, on or after the event date.")
        lines.append("")
        for o in r.get("trace_outcomes") or []:
            extra = ""
            if o.get("quarantine"):
                extra = " Quarantine: " + ", ".join(o["quarantine"]) + "."
            if "tier" in o:
                extra += f" Signal tier {o['tier']}. Entities: {', '.join(o.get('entities') or []) or 'none'}."
            lines.append(f"- {o['trace_id']} ({o['date']}): {_cell(o['title'])}. Enrichment status: {o['status']}.{extra}")
        lines.append("")
    lines += [
        "## Method",
        "",
        "1. The harness starts with a fresh database. It loads brief v1 and the watch lists.",
        "2. Each trace becomes a source through the collector pipeline. The source type is snapshot and the "
        "retention is link_only. The text is the title of the trace. The published date and the fetched date are "
        "the trace date.",
        "3. The harness loads the traces in date order. It enriches each source before it loads the next source. "
        "So the agents never see a later source.",
        "4. A signal is a SignalScored event in the event store. The backtest counts the tiers "
        f"{', '.join(str(t) for t in result['matching']['count_tiers'])}.",
        "5. For each event, the first signal is the earliest signal before the event date that meets a rule in "
        "config/backtest.yaml: a project entity, a site entity, the words of the title, or the operator entity "
        "(company level).",
        "6. Lead time is the event date minus the first signal date. A month is "
        f"{result['pass_conditions']['days_per_month']} days. The median uses the detected events only.",
        "",
        "## Limits",
        "",
        "1. The traces were found with hindsight. The gaps are therefore an upper limit.",
        "2. The text of each trace is its title only. The agents see no body text.",
        "3. The deterministic backend ran the agents. The Anthropic backend has no backtest numbers yet.",
        "",
    ]
    return "\n".join(lines)


def write(result: dict, out_dir: Path = OUT_DIR) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path, md_path = out_dir / "results.json", out_dir / "results.md"
    json_path.write_text(json.dumps(result, indent=2, default=str) + "\n", encoding="utf-8")
    md_path.write_text(markdown(result), encoding="utf-8")
    return json_path, md_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the lead time backtest (docs/09-acceptance.md)")
    parser.add_argument("--scratch-db", action="store_true",
                        help="make a throwaway database on the server in STRATA_TEST_ADMIN_URL")
    parser.add_argument("--out-dir", default=str(OUT_DIR))
    args = parser.parse_args(argv)
    if args.scratch_db:
        admin_url = os.environ.get("STRATA_TEST_ADMIN_URL")
        if not admin_url:
            raise SystemExit("--scratch-db needs STRATA_TEST_ADMIN_URL")
        with scratch_database(admin_url):
            result = run()
    else:
        result = run()
    json_path, md_path = write(result, Path(args.out_dir))
    s = result["summary"]
    print(json.dumps({"events": s["events"], "detected": s["detected"], "detection_rate": s["detection_rate"],
                      "median_lead_months": s["median_lead_months"],
                      "docs09_conditions_passed": s["docs09_conditions_passed"], "passed": s["passed"],
                      "json": str(json_path), "markdown": str(md_path)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
