"""Writes the result of an analysis: evidence rows, proposals, the Tier 0 alert and quarantine rows.

Only verified spans become evidence rows (verified = true). Agents write proposals only: each planned
fact goes through services/governance/proposals.create_proposal, which writes events only for an
automatic policy. The alert goes through services/governance/alerts.raise_alert.
"""

from __future__ import annotations

import copy
import json

import psycopg
from psycopg.types.json import Jsonb

from services.common.ids import new_id, sha256_hex
from services.governance.alerts import raise_alert
from services.governance.proposals import create_proposal

from . import forecaster
from .analysis import Analysis, Fact
from .runner import AgentRunner
from .spans import Span

_KIND_ORDER = {"EntityIdentified": 0, "ProjectStageChanged": 1, "ProcurementWindowForecast": 2, "SignalScored": 9}


def ensure_evidence(conn: psycopg.Connection, source_id: str, span: Span, text: str) -> str:
    """A verified evidence row for the span. The caller has checked the span against the text."""
    if text[span.start:span.end] != span.quote:
        raise ValueError(f"span {span.start}:{span.end} is not the quote")
    row = conn.execute(
        "SELECT id, verified FROM evidence WHERE source_id = %s AND char_start = %s AND char_end = %s",
        (source_id, span.start, span.end),
    ).fetchone()
    if row and row["verified"]:
        return row["id"]
    if row:
        raise ValueError(f"evidence {row['id']} exists but is not verified")
    evidence_id = new_id()
    conn.execute(
        "INSERT INTO evidence (id, source_id, char_start, char_end, quote, quote_hash, verified, verified_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, true, clock_timestamp())",
        (evidence_id, source_id, span.start, span.end, span.quote, sha256_hex(span.quote)),
    )
    return evidence_id


def _relationship_exists(conn: psycopg.Connection, payload: dict) -> bool:
    return conn.execute(
        "SELECT 1 FROM proj_relationship WHERE subject_id = %s AND predicate = %s AND object_id = %s "
        "AND superseded_by IS NULL LIMIT 1",
        (payload["subject_id"], payload["predicate"], payload["object_id"]),
    ).fetchone() is not None


def _agent_ids(runner: AgentRunner, agent: str) -> tuple[str, str]:
    if agent == "window_forecaster":
        return forecaster.model_id(), forecaster.prompt_version()
    st = runner.status(agent)
    return (st.model_id or runner.backend.model_id(agent), st.prompt_version or runner.backend.prompt_version(agent))


def persist(conn: psycopg.Connection, source: dict, a: Analysis, runner: AgentRunner, run_id: str) -> dict:
    """Write the analysis. The caller commits. Returns the counts."""
    text = a.doc.text
    cache: dict[tuple[int, int], str] = {}

    def evidence_ids(spans: list[Span]) -> list[str]:
        out = []
        for span in spans:
            key = (span.start, span.end)
            if key not in cache:
                cache[key] = ensure_evidence(conn, source["id"], span, text)
            if cache[key] not in out:
                out.append(cache[key])
        return out

    counts = {"proposals": 0, "proposals_existing": 0, "auto_approved": 0, "pending": 0, "alerts": 0, "quarantine": 0}
    brief_version_id = source.get("brief_version_id")
    signal_evidence: list[str] = []
    facts: list[Fact] = sorted(a.facts, key=lambda f: _KIND_ORDER.get(f.kind, 5))
    for fact in facts:
        if fact.kind == "RelationshipAsserted" and _relationship_exists(conn, fact.events[0].payload):
            continue
        events = []
        for ev in fact.events:
            payload = copy.deepcopy(ev.payload)
            ids = evidence_ids(ev.spans)
            if ev.event_type == "SignalScored":
                payload["summary"] = [{"text": s["text"], "evidence_ids": evidence_ids([Span(**x) for x in s["spans"]])}
                                      for s in payload.get("summary") or []]
                signal_evidence = ids
            events.append({"stream_type": ev.stream_type, "stream_id": ev.stream_id, "event_type": ev.event_type,
                           "payload": payload, "evidence_ids": ids, "certainty": ev.certainty,
                           "occurred_at": ev.occurred_at})
        model_id, prompt_version = _agent_ids(runner, fact.agent)
        row, created = create_proposal(
            conn, kind=fact.kind, title=fact.title, events=events, created_by_type="agent",
            created_by=f"enrichment.{fact.agent}", model_id=model_id, prompt_version=prompt_version,
            source_id=source["id"], brief_version_id=brief_version_id,
            tier=a.tier if fact.kind == "SignalScored" else None,
            idempotency_key=f"{source['id']}:{fact.key}", force_review=fact.force_review,
        )
        if created:
            counts["proposals"] += 1
            counts["auto_approved" if row["status"] == "auto_approved" else "pending"] += 1
        else:
            counts["proposals_existing"] += 1
    if a.alert and signal_evidence:
        _row, created = raise_alert(
            conn, source=source, tier=a.alert["tier"], tier_rule=a.alert["tier_rule"], title=a.alert["title"],
            evidence_ids=signal_evidence, signal_id=source["id"], related_stream_type=a.alert["related_stream_type"],
            related_stream_id=a.alert["related_stream_id"], brief_version_id=brief_version_id,
        )
        counts["alerts"] += int(created)
    for q in runner.quarantine:
        write_quarantine(conn, source["id"], run_id, q.agent, q.reason_code, q.detail, q.output, q.model_id, q.prompt_version)
        counts["quarantine"] += 1
    return counts


def write_quarantine(conn: psycopg.Connection, source_id: str | None, run_id: str | None, agent: str, reason_code: str,
                     detail: dict, output=None, model_id: str | None = None, prompt_version: str | None = None) -> str:
    qid = new_id()

    def plain(value):
        return json.loads(json.dumps(value, default=str))

    conn.execute(
        "INSERT INTO quarantine (id, source_id, agent, reason_code, detail, output, model_id, prompt_version, run_id) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (qid, source_id, agent, reason_code, Jsonb(plain(detail or {})), Jsonb(plain(output)) if output is not None else None,
         model_id, prompt_version, run_id),
    )
    return qid
