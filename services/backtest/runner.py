"""The lead time backtest (docs/09-acceptance.md, "Lead time backtest").

1. prepare(): a fresh database gets the active brief (config/monitoring-brief) and the governance start-up
   step (the watch lists become canonical entities).
2. replay(): each trace of tests/backtest/traces.yaml becomes a source through the collector pipeline
   (services/collectors/pipeline.ingest), in date order. The enrichment pipeline runs on each source
   before the next source is loaded. So the agents never see a later source.
3. signals(): each SignalScored event in the event store, with the entities that it names.
4. evaluate(): for each event of tests/backtest/events.yaml, the first matching signal before the event
   date, the lead time, or the miss and its reason. Then the pass conditions of docs/09.

The matching rules, the window, the thresholds and the replay settings are in config/backtest.yaml.
Collected text is data. The harness never interprets it. It only compares names and words.
"""

from __future__ import annotations

import re
import statistics
from dataclasses import asdict, dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

import psycopg
import yaml

from services.common.config import load_yaml
from services.common.settings import REPO_ROOT

MISS_REASONS = {
    "no_trace": "The dataset has no trace before the event date.",
    "trace_out_of_scope": "The classifier put each earlier trace out of scope. Strata made no signal.",
    "trace_quarantined": "A guardrail sent each earlier trace to quarantine. Strata made no signal.",
    "enrichment_failed": "The enrichment of each earlier trace failed. Strata made no signal.",
    "tier_not_counted": "The earlier signals have a tier that the backtest does not count.",
    "no_entity_match": "Strata made a signal from an earlier trace, but the signal does not name the project, "
                       "its site or its operator.",
    "signal_not_before_event": "A matching signal exists, but only on or after the event date.",
    "no_rules": "config/backtest.yaml has no matching rules for the event.",
}


def config() -> dict:
    return load_yaml("backtest.yaml")


def _as_date(value: Any) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def load_dataset(cfg: dict | None = None) -> tuple[list[dict], list[dict]]:
    cfg = cfg or config()
    with open(REPO_ROOT / cfg["dataset"]["events"], encoding="utf-8") as fh:
        events = yaml.safe_load(fh) or []
    with open(REPO_ROOT / cfg["dataset"]["traces"], encoding="utf-8") as fh:
        traces = yaml.safe_load(fh) or []
    for item in (*events, *traces):
        item["date"] = _as_date(item["date"])
    return events, traces


# ---------------------------------------------------------------------------
# 1. Prepare
# ---------------------------------------------------------------------------


def _replay_source_count(conn: psycopg.Connection) -> int:
    return conn.execute(
        "SELECT count(*) AS n FROM source WHERE coalesce(metadata->>'kind', '') <> 'monitoring_brief'"
    ).fetchone()["n"]


def prepare(conn: psycopg.Connection) -> dict:
    """Load the brief files and the watch lists. The database must hold no collected source yet."""
    from services.collectors.brief import active_brief, load_brief_files
    from services.governance.bootstrap import bootstrap_brief

    existing = _replay_source_count(conn)
    if existing:
        raise RuntimeError(f"the backtest needs a fresh database, but it holds {existing} collected sources")
    load_brief_files(conn)
    conn.commit()
    result = bootstrap_brief(conn)
    conn.commit()
    brief = active_brief(conn)
    if brief is None:
        raise RuntimeError("no active brief after the brief files were loaded")
    return {"brief_version": brief["version"], "brief_version_id": brief["id"], "bootstrap": result}


# ---------------------------------------------------------------------------
# 2. Replay
# ---------------------------------------------------------------------------


@dataclass
class ReplayStep:
    seq: int
    url: str
    trace_ids: list[str]
    published_at: str
    ingest_status: str
    source_id: str | None
    enrich_status: str | None = None
    run_id: str | None = None
    tier: int | None = None
    tier_rule: str | None = None
    sources_visible: int = 0          # collected sources in the database when the enrichment ran
    later_sources_visible: int = 0    # of these, sources with a later published date (must be 0)


def documents(traces: list[dict]) -> list[dict]:
    """One document for each distinct URL, in date order. A URL in two traces is one public document."""
    by_url: dict[str, dict] = {}
    for t in traces:
        doc = by_url.get(t["url"])
        if doc is None:
            by_url[t["url"]] = {"url": t["url"], "date": t["date"], "title": t["title"], "text": t.get("text") or "",
                                "publisher": t.get("publisher"), "date_precision": t.get("date_precision"),
                                "source_types": [t.get("source_type")], "trace_ids": [t["id"]],
                                "event_ids": [t.get("event_id")]}
            continue
        doc["trace_ids"].append(t["id"])
        doc["event_ids"].append(t.get("event_id"))
        doc["date"] = min(doc["date"], t["date"])
    return sorted(by_url.values(), key=lambda d: (d["date"], d["url"]))


def _text(doc: dict) -> str:
    title, text = (doc["title"] or "").strip(), (doc["text"] or "").strip()
    if not text or text == title:
        return title
    return f"{title}\n\n{text}"


def replay(conn: psycopg.Connection, traces: list[dict], cfg: dict | None = None, backend=None) -> list[ReplayStep]:
    """Load each document and enrich it at once, in date order."""
    from services.collectors.brief import active_brief, retention_for
    from services.collectors.pipeline import Document, IngestContext, ingest
    from services.enrichment.backends import select_backend
    from services.enrichment.pipeline import enrich

    cfg = cfg or config()
    rc = cfg["replay"]
    backend = backend or select_backend(rc["backend"])
    brief = active_brief(conn)
    retention = retention_for(brief["content"], rc["licence_code"])
    steps: list[ReplayStep] = []
    for seq, doc in enumerate(documents(traces), start=1):
        published = datetime.combine(doc["date"], datetime.min.time(), tzinfo=UTC)
        ctx = IngestContext(brief_version_id=brief["id"], brief_source_id=rc["brief_source_id"],
                            licence_code=rc["licence_code"], retention_policy=retention, enqueue=None,
                            now=published + timedelta(hours=float(rc.get("fetch_delay_hours") or 0)))
        document = Document(
            url=doc["url"], source_type=rc["source_type"], text=_text(doc), title=doc["title"],
            publisher=doc["publisher"], published_at=published, read_at_source=bool(rc.get("read_at_source")),
            metadata={"backtest": True, "trace_ids": doc["trace_ids"], "event_ids": doc["event_ids"],
                      "date_precision": doc["date_precision"], "trace_source_types": doc["source_types"]},
        )
        result = ingest(conn, document, ctx)
        step = ReplayStep(seq=seq, url=doc["url"], trace_ids=doc["trace_ids"], published_at=published.isoformat(),
                          ingest_status=result.status, source_id=result.source_id)
        if result.source_id and result.status in ("new", "near_duplicate"):
            row = conn.execute(
                """SELECT count(*) AS n, count(*) FILTER (WHERE published_at > %s) AS later FROM source
                   WHERE coalesce(metadata->>'kind', '') <> 'monitoring_brief'""",
                (published,),
            ).fetchone()
            step.sources_visible, step.later_sources_visible = row["n"], row["later"]
            out = enrich(conn, result.source_id, backend=backend)
            step.enrich_status, step.run_id = out["status"], out.get("run_id")
            step.tier, step.tier_rule = out.get("tier"), out.get("tier_rule")
        steps.append(step)
    return steps


# ---------------------------------------------------------------------------
# 3. Signals
# ---------------------------------------------------------------------------


@dataclass
class EntityRef:
    id: str
    type: str | None
    name: str | None
    brief_key: str | None = None
    site_key: str | None = None      # projects: the brief key of the site of the project


@dataclass
class Signal:
    source_id: str
    published_at: date
    title: str
    url: str
    tier: int
    tier_rule: str
    entities: list[EntityRef] = field(default_factory=list)


def _entity_refs(conn: psycopg.Connection, ids: list[str]) -> list[EntityRef]:
    out: list[EntityRef] = []
    for eid in ids:
        row = conn.execute(
            "SELECT p.type, p.name, e.brief_key FROM proj_entity p LEFT JOIN entity e ON e.id = p.id WHERE p.id = %s",
            (eid,),
        ).fetchone()
        if row:
            out.append(EntityRef(eid, row["type"], row["name"], row["brief_key"]))
            continue
        row = conn.execute(
            """SELECT p.name, e.brief_key AS site_key FROM proj_project p LEFT JOIN entity e ON e.id = p.site_id
               WHERE p.id = %s""",
            (eid,),
        ).fetchone()
        if row:
            out.append(EntityRef(eid, "project", row["name"], None, row["site_key"]))
            continue
        # A new entity that waits for approval: its name is in the pending proposal.
        row = conn.execute(
            """SELECT ev->>'stream_type' AS stream_type, ev->'payload' AS payload
               FROM proposal p, jsonb_array_elements(p.events) ev
               WHERE ev->>'stream_id' = %s AND ev->>'event_type' = 'EntityIdentified' LIMIT 1""",
            (eid,),
        ).fetchone()
        if row:
            payload = row["payload"] or {}
            etype = payload.get("type") or ("project" if row["stream_type"] == "project" else None)
            out.append(EntityRef(eid, etype, payload.get("name")))
            continue
        out.append(EntityRef(eid, None, None))
    return out


def _projects_of_source(conn: psycopg.Connection, source_id: str) -> list[str]:
    """Project streams that the proposals of the source name (the lifecycle agent output)."""
    rows = conn.execute(
        """SELECT DISTINCT ev->>'stream_id' AS id FROM proposal p, jsonb_array_elements(p.events) ev
           WHERE p.source_id = %s AND ev->>'stream_type' = 'project'""",
        (source_id,),
    ).fetchall()
    return [r["id"] for r in rows]


def signals(conn: psycopg.Connection) -> list[Signal]:
    rows = conn.execute(
        """SELECT e.stream_id AS source_id, e.payload, s.published_at, s.fetched_at, s.title, s.url
           FROM event e JOIN source s ON s.id = e.stream_id
           WHERE e.stream_type = 'source' AND e.event_type = 'SignalScored'
           ORDER BY coalesce(s.published_at, s.fetched_at), e.stream_id"""
    ).fetchall()
    out = []
    for r in rows:
        p = r["payload"]
        ids = list(dict.fromkeys([*(p.get("entity_ids") or []), *_projects_of_source(conn, r["source_id"])]))
        out.append(Signal(
            source_id=r["source_id"], published_at=(r["published_at"] or r["fetched_at"]).astimezone(UTC).date(),
            title=p.get("title") or r["title"] or "", url=p.get("url") or r["url"], tier=int(p.get("tier", 2)),
            tier_rule=p.get("tier_rule") or "none", entities=_entity_refs(conn, ids),
        ))
    return out


# ---------------------------------------------------------------------------
# 4. Evaluate
# ---------------------------------------------------------------------------


def _words(text: str) -> set[str]:
    return {w.lower() for w in re.findall(r"[A-Za-z0-9]+", text or "")}


def signal_matches(sig: Signal, rules: dict, matching: dict) -> list[tuple[str, str]]:
    """Each rule that the signal meets, with the thing that matched, in the order of config rule_order."""
    site_keys = set(rules.get("site_keys") or [])
    company_keys = set(rules.get("company_keys") or [])
    names = [n.lower() for n in rules.get("project_names") or []]
    found: list[tuple[str, str]] = []
    for rule in matching["rule_order"]:
        hit = None
        if rule == "project":
            for e in sig.entities:
                if e.type != "project":
                    continue
                if e.name and any(n in e.name.lower() for n in names):
                    hit = f"project entity '{e.name}'"
                elif e.site_key and e.site_key in site_keys:
                    hit = f"project entity '{e.name}' at site {e.site_key}"
                if hit:
                    break
        elif rule == "site":
            hit = next((f"site entity '{e.name}' ({e.brief_key})" for e in sig.entities
                        if e.type == "site" and e.brief_key in site_keys), None)
        elif rule == "title":
            words = _words(sig.title)
            hit = next(("title words " + " + ".join(g) for g in rules.get("title_terms") or []
                        if all(w.lower() in words for w in g)), None)
        elif rule == "company" and matching.get("company_level_counts"):
            hit = next((f"operator entity '{e.name}' ({e.brief_key})" for e in sig.entities
                        if e.type == "organisation" and e.brief_key in company_keys), None)
        if hit:
            found.append((rule, hit))
    return found


def match_signal(sig: Signal, rules: dict, matching: dict) -> tuple[str, str] | None:
    """The first rule (config rule_order) that the signal meets, with the thing that matched. Else None."""
    found = signal_matches(sig, rules, matching)
    return found[0] if found else None


def _trace_outcome(conn: psycopg.Connection, source_id: str | None, sig_by_source: dict[str, Signal],
                   rules: dict, matching: dict) -> dict:
    if source_id is None:
        return {"status": "not_loaded", "reason": "empty"}
    run = conn.execute(
        "SELECT id, status, tier, tier_rule, error FROM enrichment_run WHERE source_id = %s ORDER BY started_at DESC LIMIT 1",
        (source_id,),
    ).fetchone()
    status = run["status"] if run else "not_enriched"
    out: dict[str, Any] = {"status": status}
    if status == "quarantined":
        codes = conn.execute("SELECT DISTINCT agent, reason_code FROM quarantine WHERE source_id = %s ORDER BY 1, 2",
                             (source_id,)).fetchall()
        out["quarantine"] = [f"{c['agent']}:{c['reason_code']}" for c in codes]
    if status == "failed" and run:
        out["error"] = (run["error"] or "")[:300]
    sig = sig_by_source.get(source_id)
    if sig is not None:
        out["tier"] = sig.tier
        out["tier_rule"] = sig.tier_rule
        out["entities"] = [f"{e.type}:{e.name}" for e in sig.entities]
        out["match"] = match_signal(sig, rules, matching) is not None
    return out


def _miss_reason(outcomes: list[dict], matching: dict) -> str:
    if not outcomes:
        return "no_trace"
    statuses = [o["status"] for o in outcomes]
    signalled = [o for o in outcomes if "tier" in o]
    if any(not o.get("match") for o in signalled if o["tier"] in matching["count_tiers"]):
        return "no_entity_match"
    if signalled:
        return "tier_not_counted"
    if "quarantined" in statuses:
        return "trace_quarantined"
    if "failed" in statuses:
        return "enrichment_failed"
    return "trace_out_of_scope"


def _months(days: int, cfg: dict) -> float:
    return round(days / float(cfg["pass_conditions"]["days_per_month"]), 1)


def evaluate(conn: psycopg.Connection, events: list[dict], traces: list[dict], steps: list[ReplayStep],
             cfg: dict | None = None) -> dict:
    cfg = cfg or config()
    matching = cfg["matching"]
    window = cfg["window"]
    w_start, w_end = _as_date(window["start"]), _as_date(window["end"])
    sigs = signals(conn)
    sig_by_source = {s.source_id: s for s in sigs}
    source_of_trace = {tid: st.source_id for st in steps for tid in st.trace_ids}
    rows = []
    for ev in sorted(events, key=lambda e: (e["date"], e["id"])):
        rules = (cfg.get("events") or {}).get(ev["id"])
        in_window = w_start <= ev["date"] <= w_end
        row: dict[str, Any] = {
            "event_id": ev["id"], "date": ev["date"].isoformat(), "project": ev["project"], "site": ev.get("site"),
            "operator": ev.get("operator"), "event_type": ev.get("event_type"), "title": ev.get("title"),
            "url": ev.get("url"), "in_window": in_window,
            "counted": in_window or not window.get("strict", False),
        }
        linked = sorted((t for t in traces if t.get("event_id") == ev["id"] and t["date"] < ev["date"]),
                        key=lambda t: (t["date"], t["id"]))
        row["traces_before"] = len(linked)
        if rules is None:
            row.update(detected=False, reason="no_rules", reason_text=MISS_REASONS["no_rules"], trace_outcomes=[])
            rows.append(row)
            continue
        first = None
        late = None
        for s in sigs:
            if s.tier not in matching["count_tiers"]:
                continue
            m = signal_matches(s, rules, matching)
            if not m:
                continue
            if s.published_at < ev["date"]:
                first = (s, m)
                break
            late = late or (s, m)
        if first:
            s, found = first
            basis, what = found[0]
            days = (ev["date"] - s.published_at).days
            row.update(detected=True, first_signal_date=s.published_at.isoformat(), first_signal_title=s.title,
                       first_signal_url=s.url, first_signal_source_id=s.source_id, first_signal_tier=s.tier,
                       first_signal_tier_rule=s.tier_rule, first_signal_entities=[f"{e.type}:{e.name}" for e in s.entities],
                       match_basis=basis, match_detail=what, match_all=[f"{b}: {w}" for b, w in found],
                       company_level=basis == "company", lead_days=days, lead_months=_months(days, cfg))
        else:
            outcomes = []
            for t in linked:
                o = _trace_outcome(conn, source_of_trace.get(t["id"]), sig_by_source, rules, matching)
                outcomes.append({"trace_id": t["id"], "date": t["date"].isoformat(), "title": t["title"], **o})
            reason = _miss_reason(outcomes, matching)
            if late and reason in ("no_trace",):
                reason = "signal_not_before_event"
            row.update(detected=False, reason=reason, reason_text=MISS_REASONS[reason], trace_outcomes=outcomes)
            if late:
                row["late_signal_date"] = late[0].published_at.isoformat()
        rows.append(row)
    signal_list = [{"source_id": s.source_id, "date": s.published_at.isoformat(), "title": s.title, "tier": s.tier,
                    "tier_rule": s.tier_rule, "entities": [f"{e.type}:{e.name}" for e in s.entities]} for s in sigs]
    return {"events": rows, "summary": summarise(rows, cfg), "signals": signal_list}


def _stats(rows: list[dict], cfg: dict) -> dict:
    pc = cfg["pass_conditions"]
    n = len(rows)
    hits = [r for r in rows if r.get("detected")]
    leads = [r["lead_days"] for r in hits]
    median_days = statistics.median(leads) if leads else None
    return {
        "events": n,
        "detected": len(hits),
        "detection_rate": round(len(hits) / n, 4) if n else None,
        "median_lead_days": median_days,
        "median_lead_months": round(median_days / float(pc["days_per_month"]), 1) if median_days is not None else None,
        "company_level_hits": sum(1 for r in hits if r.get("company_level")),
    }


def summarise(rows: list[dict], cfg: dict) -> dict:
    pc = cfg["pass_conditions"]
    counted = [r for r in rows if r["counted"]]
    s = _stats(counted, cfg)
    rate_ok = s["detection_rate"] is not None and s["detection_rate"] >= float(pc["min_detection_rate"])
    median_ok = s["median_lead_days"] is not None and \
        s["median_lead_days"] / float(pc["days_per_month"]) >= float(pc["min_median_lead_months"])
    count_ok = s["events"] >= int(pc["min_events"])
    conditions = [
        {"id": "detection_rate", "text": f"Strata finds an earlier signal for {pc['min_detection_rate'] * 100:g} "
         "percent or more of the events", "value": s["detection_rate"], "threshold": pc["min_detection_rate"], "passed": rate_ok},
        {"id": "median_lead", "text": f"The median lead time is {pc['min_median_lead_months']:g} months or more",
         "value": s["median_lead_months"], "threshold": pc["min_median_lead_months"], "passed": median_ok},
        {"id": "event_count", "text": f"The dataset has {pc['min_events']} or more events (docs/09 step 1)",
         "value": s["events"], "threshold": pc["min_events"], "passed": count_ok},
    ]
    return {
        **s,
        "conditions": conditions,
        "docs09_conditions_passed": rate_ok and median_ok,
        "passed": rate_ok and median_ok and count_ok,
        "in_window_only": _stats([r for r in rows if r["in_window"]], cfg),
        "miss_reasons": {r["event_id"]: r.get("reason") for r in counted if not r.get("detected")},
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def run(conn: psycopg.Connection, *, cfg: dict | None = None, backend=None) -> dict:
    """Prepare the fresh database, replay the traces and evaluate the events."""
    cfg = cfg or config()
    events, traces = load_dataset(cfg)
    setup = prepare(conn)
    steps = replay(conn, traces, cfg, backend=backend)
    result = evaluate(conn, events, traces, steps, cfg)
    backend_name = cfg["replay"]["backend"] if backend is None else getattr(backend, "name", str(backend))
    return {
        "run_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "backend": backend_name,
        "brief_version": setup["brief_version"],
        "dataset": {"events": len(events), "traces": len(traces), "documents": len(steps),
                    "events_file": cfg["dataset"]["events"], "traces_file": cfg["dataset"]["traces"]},
        "window": {"start": str(cfg["window"]["start"]), "end": str(cfg["window"]["end"]),
                   "strict": bool(cfg["window"].get("strict", False))},
        "matching": cfg["matching"],
        "pass_conditions": cfg["pass_conditions"],
        "replay": [asdict(s) for s in steps],
        **result,
    }
