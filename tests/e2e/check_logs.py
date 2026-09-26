"""Check the logs of the stack for errors: each line with ERROR, CRITICAL or Traceback.

Run: E2E_COMPOSE="docker compose -p strata-e2e -f docker-compose.yml -f tests/e2e/compose.e2e.yml" \
     uv run python tests/e2e/check_logs.py [--out test-results/e2e/log-check.txt]

The lines of the known benign messages below do not count. Each of them has its reason. The script prints the
other lines, grouped by service and message, and exits with 1 when there is one or more. It never prints a line
that names a secret variable.
"""

from __future__ import annotations

import argparse
import os
import re
import shlex
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = "docker compose -f docker-compose.yml -f tests/e2e/compose.e2e.yml --profile test"
PROBLEM = re.compile(r'\bERROR\b|"level": "(ERROR|CRITICAL)"|Traceback \(most recent call last\)|\bFATAL\b')
# (service, pattern, reason)
BENIGN = [
    ("db", r"TimescaleDB Background Worker Scheduler .* trying to connect to template database",
     "TimescaleDB starts a scheduler for each database, also for the template database, and stops it at once"),
    ("db", r'terminating background worker "TimescaleDB Background Worker (Scheduler|Launcher)" due to administrator',
     "The first start of the database runs initdb, then restarts the server. The restart stops the TimescaleDB workers"),
    ("db", r'duplicate key value violates unique constraint "procrastinate_jobs_queueing_lock_idx',
     "Procrastinate defers a job with a queueing lock. The database refuses a second job for one source. The "
     "queue catches the error (AlreadyEnqueued). This is how the queue avoids duplicate jobs"),
]
SECRET_WORDS = ("PASSWORD", "SECRET", "MASTER_KEY", "ACCESS_KEY", "API_KEY")


def classify(lines: list[str]) -> tuple[list[str], Counter]:
    problems: list[str] = []
    benign: Counter = Counter()
    for line in lines:
        if not PROBLEM.search(line):
            continue
        service = line.split("|", 1)[0].strip().rsplit("-", 1)[0] if "|" in line else "?"
        reason = next((r for s, p, r in BENIGN if service.startswith(s) and re.search(p, line)), None)
        if reason:
            benign[reason] += 1
            continue
        if any(w in line.upper() for w in SECRET_WORDS):
            line = line.split("|", 1)[0] + "| [a line that names a secret variable: not printed]"
        problems.append(line)
    return problems, benign


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=None)
    parser.add_argument("--since", default=None, help="only the log lines since this time, for example 10m")
    args = parser.parse_args()
    cmd = [*shlex.split(os.environ.get("E2E_COMPOSE", DEFAULT)), "logs", "--no-color"]
    if args.since:
        cmd += ["--since", args.since]
    logs = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()
    problems, benign = classify(logs)
    grouped = Counter(re.sub(r"\d{4}-\d\d-\d\d[ T][\d:.,+Z]+|\b[0-9A-Z]{26}\b|\[\d+\]", "*", p)[:300] for p in problems)
    report = [f"log lines: {len(logs)}", f"problem lines: {len(problems)}", ""]
    report += [f"{n} x {text}" for text, n in grouped.most_common()]
    report += ["", "benign lines (not counted):"] + [f"{n} x {reason}" for reason, n in benign.items()]
    text = "\n".join(report)
    print(text)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(text + "\n", encoding="utf-8")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
