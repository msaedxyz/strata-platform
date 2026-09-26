"""enrich(): the enrichment pipeline for one source (docs/05-enrichment.md).

1. Read the source and its normalised text.
2. Run the seven agents (services/enrichment/analysis.py) on the selected backend.
3. Write the evidence, the proposals, the Tier 0 alert and the quarantine rows (persist.py).
4. Record the run in enrichment_run: the status, the status and time of each agent, and the counts.

An out of scope document writes no proposal and no quarantine row. Its run has the status out_of_scope.
A second run of the same source does not duplicate proposals or alerts (idempotency keys).

Command line:  python -m services.enrichment.pipeline [--all] [--force] [source_id ...]
"""

from __future__ import annotations

import argparse
import json
import logging
import time

import psycopg
from psycopg.types.json import Jsonb

from services.common.ids import new_id
from services.common.logging import log, setup_logging

from . import config
from .analysis import AGENT_ORDER, analyse
from .backends import Backend, select_backend
from .entity_index import DbIndex
from .persist import persist, write_quarantine
from .runner import AgentRunner
from .sources import brief_for, build_doc, load_text

logger = logging.getLogger("strata.enrichment.pipeline")
DONE_STATUSES = ("in_scope", "out_of_scope", "skipped")


def _call_logger(conn: psycopg.Connection, source_id: str, run_id: str):
    def write(rec: dict) -> None:
        conn.execute(
            """INSERT INTO agent_call_log (id, agent, backend, model_id, prompt_version, input_hash, output, input_tokens,
                 output_tokens, latency_ms, status, error, source_id, run_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (new_id(), rec["agent"], rec["backend"], rec["model_id"], rec["prompt_version"], rec["input_hash"],
             Jsonb(json.loads(json.dumps(rec["output"], default=str))) if rec["output"] is not None else None,
             rec["input_tokens"], rec["output_tokens"], rec["latency_ms"], rec["status"], rec["error"], source_id, run_id),
        )

    return write


def _finish(conn: psycopg.Connection, run_id: str, status: str, **fields) -> None:
    conn.execute(
        """UPDATE enrichment_run SET status = %s, finished_at = clock_timestamp(), agent_statuses = %s, timings = %s,
             counts = %s, tier = %s, tier_rule = %s, error = %s, backend = coalesce(%s, backend) WHERE id = %s""",
        (status, Jsonb(fields.get("agent_statuses") or {}), Jsonb(fields.get("timings") or {}),
         Jsonb(fields.get("counts") or {}), fields.get("tier"), fields.get("tier_rule"), fields.get("error"),
         fields.get("backend"), run_id),
    )


def enrich(conn: psycopg.Connection, source_id: str, *, backend: Backend | None = None, force: bool = False) -> dict:
    """Enrich one source. Commits. Never raises for a failure inside the agents."""
    source = conn.execute("SELECT * FROM source WHERE id = %s", (source_id,)).fetchone()
    if source is None:
        return {"source_id": source_id, "status": "not_found"}
    if not force:
        done = conn.execute(
            "SELECT id, status FROM enrichment_run WHERE source_id = %s AND status = ANY(%s) ORDER BY started_at DESC LIMIT 1",
            (source_id, list(DONE_STATUSES)),
        ).fetchone()
        if done:
            return {"source_id": source_id, "status": "already_enriched", "run_id": done["id"], "previous": done["status"]}
    backend = backend or select_backend()
    run_id = new_id()
    conn.execute(
        "INSERT INTO enrichment_run (id, source_id, status, backend, rules_version) VALUES (%s, %s, 'running', %s, %s)",
        (run_id, source_id, backend.name, backend.prompt_version("classifier")),
    )
    conn.commit()
    started = time.perf_counter()
    kinds = config.get("pipeline.skip_metadata_kinds", []) or []
    if (source.get("metadata") or {}).get("kind") in kinds:
        _finish(conn, run_id, "skipped", error="the source is a monitoring brief")
        conn.commit()
        return {"source_id": source_id, "status": "skipped", "run_id": run_id}
    text = load_text(source)
    if not text:
        write_quarantine(conn, source_id, run_id, "classifier", "no_text", {"reason": "no stored text for the source"})
        _finish(conn, run_id, "quarantined", error="no text")
        conn.commit()
        return {"source_id": source_id, "status": "quarantined", "run_id": run_id, "reason": "no_text"}
    runner = AgentRunner(backend, log=_call_logger(conn, source_id, run_id))
    try:
        brief = brief_for(conn, source)
        doc = build_doc(source, text, brief)
        index = DbIndex(conn)
        analysis = analyse(doc, index, runner)
        counts = persist(conn, source, analysis, runner, run_id) if analysis.status == "in_scope" else {}
        if analysis.status != "in_scope":
            for q in runner.quarantine:
                write_quarantine(conn, source_id, run_id, q.agent, q.reason_code, q.detail, q.output, q.model_id,
                                 q.prompt_version)
            counts = {"quarantine": len(runner.quarantine)}
        statuses = {a: runner.status(a).as_dict() for a in AGENT_ORDER}
        _finish(conn, run_id, analysis.status, agent_statuses=statuses,
                timings={"total_ms": int((time.perf_counter() - started) * 1000),
                         **{a: statuses[a]["ms"] for a in AGENT_ORDER}},
                counts=counts, tier=analysis.tier, tier_rule=analysis.tier_rule, backend=backend.name)
        conn.commit()
    except Exception as exc:  # one source must not stop the others
        conn.rollback()
        log(logger, logging.ERROR, "enrichment failed", source_id=source_id, error=repr(exc))
        _finish(conn, run_id, "failed", error=repr(exc)[:2000],
                agent_statuses={a: runner.status(a).as_dict() for a in AGENT_ORDER})
        conn.commit()
        return {"source_id": source_id, "status": "failed", "run_id": run_id, "error": repr(exc)}
    log(logger, logging.INFO, "source enriched", source_id=source_id, status=analysis.status, tier=analysis.tier,
        **{k: v for k, v in counts.items() if isinstance(v, int)})
    return {"source_id": source_id, "status": analysis.status, "run_id": run_id, "tier": analysis.tier,
            "tier_rule": analysis.tier_rule, "counts": counts}


def enrich_pending(conn: psycopg.Connection, *, backend: Backend | None = None, limit: int = 1000) -> list[dict]:
    """Enrich each source that has no finished run (a sweep for sources whose job was not queued)."""
    rows = conn.execute(
        """SELECT s.id FROM source s WHERE NOT EXISTS (
             SELECT 1 FROM enrichment_run r WHERE r.source_id = s.id AND r.status IN ('in_scope', 'out_of_scope', 'skipped'))
           ORDER BY s.fetched_at, s.id LIMIT %s""",
        (limit,),
    ).fetchall()
    backend = backend or select_backend()
    return [enrich(conn, r["id"], backend=backend) for r in rows]


def main(argv: list[str] | None = None) -> None:
    from services.common.db import connect

    setup_logging()
    parser = argparse.ArgumentParser(description="Enrich sources with the seven agents")
    parser.add_argument("source_ids", nargs="*")
    parser.add_argument("--all", action="store_true", help="enrich each source without a finished run")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--backend", default=None)
    args = parser.parse_args(argv)
    backend = select_backend(args.backend)
    with connect() as conn:
        results = enrich_pending(conn, backend=backend) if args.all else \
            [enrich(conn, sid, backend=backend, force=args.force) for sid in args.source_ids]
    summary: dict[str, int] = {}
    for r in results:
        summary[r["status"]] = summary.get(r["status"], 0) + 1
    print(json.dumps({"sources": len(results), "by_status": summary}))


if __name__ == "__main__":
    main()
