"""Count canonical facts without verified evidence (docs/05 criterion 2, docs/09 scenario 12).

1. The SQL function fact_evidence_problems() (migration 0200) finds fact events with no evidence, with an
   evidence id that does not exist, with evidence that is not verified, with a quote_hash that is not the
   SHA-256 of the quote, or with a quote whose length differs from its span.
2. This script adds the text check: where the source text is still stored, each quote must be the exact
   substring of the text at its offsets.

The count must be zero. Exit code 1 when it is not.

Run: python scripts/check_evidence.py   (STRATA_DATABASE_URL gives the database)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg  # noqa: E402


def text_problems(conn: psycopg.Connection) -> list[dict]:
    from services.enrichment.sources import load_text

    rows = conn.execute(
        """SELECT DISTINCT e.id AS event_id, e.event_type, v.id AS evidence_id, v.source_id, v.char_start, v.char_end, v.quote
           FROM event e CROSS JOIN LATERAL unnest(e.evidence_ids) AS x(id)
           JOIN evidence v ON v.id = x.id
           WHERE event_needs_evidence(e.event_type)
           ORDER BY v.source_id"""
    ).fetchall()
    texts: dict[str, str | None] = {}
    problems = []
    for r in rows:
        if r["source_id"] not in texts:
            source = conn.execute("SELECT * FROM source WHERE id = %s", (r["source_id"],)).fetchone()
            texts[r["source_id"]] = load_text(source) if source else None
        text = texts[r["source_id"]]
        if text is None:
            continue  # the text was purged (verify_then_purge); the SQL checks still apply
        if text[r["char_start"]:r["char_end"]] != r["quote"]:
            problems.append({"event_id": r["event_id"], "event_type": r["event_type"], "evidence_id": r["evidence_id"],
                             "problem": "quote is not the text at its offsets"})
    return problems


def check(conn: psycopg.Connection) -> dict:
    sql_rows = conn.execute("SELECT * FROM fact_evidence_problems()").fetchall()
    text_rows = text_problems(conn)
    events = {r["event_id"] for r in sql_rows} | {r["event_id"] for r in text_rows}
    facts = conn.execute("SELECT count(*) AS n FROM event WHERE event_needs_evidence(event_type)").fetchone()["n"]
    return {
        "fact_events": facts,
        "facts_without_verified_evidence": len(events),
        "sql_count": conn.execute("SELECT count_facts_without_verified_evidence() AS n").fetchone()["n"],
        "problems": [dict(r) for r in sql_rows] + text_rows,
    }


def main() -> int:
    from services.common.db import connect

    with connect() as conn:
        result = check(conn)
    print(json.dumps({k: v for k, v in result.items() if k != "problems"} | {"problems": result["problems"][:50]},
                     default=str, indent=2))
    return 0 if result["facts_without_verified_evidence"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
