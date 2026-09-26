"""Projector: builds the read models (proj_* tables) from events.

apply_event runs inside the transaction of the insert, so a new event is visible in its
module as soon as the transaction commits. rebuild deletes every projection and replays all events.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

from .folds import FOLDS

PROJECTION_TABLES = [
    "proj_entity", "proj_fact", "proj_signal", "proj_demand_driver", "proj_alert",
    "proj_project", "proj_deal", "proj_relationship", "proj_engagement",
]

# Columns that a fold does not own. Proposal events set them.
_PENDING_COLUMNS = {"proj_deal": ("stage_pending", "pending_proposal_id"), "proj_entity": ("status_pending",)}

# Columns that other modules calculate (the priority list, services/projections/priority.py). A fold does not
# overwrite them.
_DERIVED_COLUMNS = {
    "proj_deal": ("buyer_fit", "confidence", "lead_time_days", "demand_litres_month", "priority_score", "priority_breakdown"),
    "proj_entity": ("last_signal_at",),
}

_TABLE_FOR_STREAM = {"entity": "proj_entity", "deal": "proj_deal", "project": "proj_project", "alert": "proj_alert"}

# Hooks that other services register, for example the priority list calculator.
_after_apply_hooks: list = []


def register_hook(fn) -> None:
    if fn not in _after_apply_hooks:
        _after_apply_hooks.append(fn)


def _columns(conn: psycopg.Connection, table: str) -> list[str]:
    rows = conn.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'strata' AND table_name = %s ORDER BY ordinal_position",
        (table,),
    ).fetchall()
    return [r["column_name"] for r in rows]


_COLUMN_CACHE: dict[str, list[str]] = {}


def _cols(conn: psycopg.Connection, table: str) -> list[str]:
    if table not in _COLUMN_CACHE:
        _COLUMN_CACHE[table] = _columns(conn, table)
    return _COLUMN_CACHE[table]


def _adapt(value: Any) -> Any:
    if isinstance(value, dict | list) and not (isinstance(value, list) and all(isinstance(v, str) for v in value)):
        return Jsonb(value)
    return value


def _upsert(conn: psycopg.Connection, table: str, row: dict, skip_update: tuple[str, ...] = ()) -> None:
    cols = [c for c in _cols(conn, table) if c in row]
    values = [_adapt(row[c]) for c in cols]
    updates = [c for c in cols if c != "id" and c not in skip_update]
    query = sql.SQL("INSERT INTO {} ({}) VALUES ({}) ON CONFLICT (id) DO UPDATE SET {}").format(
        sql.Identifier(table),
        sql.SQL(", ").join(map(sql.Identifier, cols)),
        sql.SQL(", ").join(sql.Placeholder() * len(cols)),
        sql.SQL(", ").join(sql.SQL("{} = EXCLUDED.{}").format(sql.Identifier(c), sql.Identifier(c)) for c in updates),
    )
    conn.execute(query, values)


def _stream_events_upto(conn: psycopg.Connection, event: dict) -> list[dict]:
    return conn.execute(
        "SELECT * FROM event WHERE stream_type = %s AND stream_id = %s AND sequence <= %s ORDER BY sequence",
        (event["stream_type"], event["stream_id"], event["sequence"]),
    ).fetchall()


def _project_stream(conn: psycopg.Connection, event: dict) -> None:
    stream_type = event["stream_type"]
    fold = FOLDS.get(stream_type)
    if fold is None:
        return
    state = fold(_stream_events_upto(conn, event))
    if state is None:
        return
    table = _TABLE_FOR_STREAM[stream_type]
    if stream_type == "entity":
        reg = conn.execute(
            "SELECT site_class, watch, ST_Y(ST_Centroid(geometry)) AS lat, ST_X(ST_Centroid(geometry)) AS lon, "
            "(geometry_source->>'approximate')::boolean AS approximate FROM entity WHERE id = %s",
            (state["id"],),
        ).fetchone()
        if reg:
            state["site_class"] = state.get("site_class") or reg["site_class"]
            state["watch"] = reg["watch"] if reg["watch"] != "none" else state.get("watch", "none")
            state["lat"], state["lon"], state["geometry_approximate"] = reg["lat"], reg["lon"], reg["approximate"]
    skip = _PENDING_COLUMNS.get(table, ()) + _DERIVED_COLUMNS.get(table, ())
    if event["event_type"] in ("DealStageChanged", "SiteStatusChanged"):
        skip = _DERIVED_COLUMNS.get(table, ())  # the decided change clears the pending state
    _upsert(conn, table, state, skip_update=skip)


def _project_cross_stream(conn: psycopg.Connection, ev: dict) -> None:
    t = ev["event_type"]
    p = ev["payload"]
    if t in ("EntityAttributeAsserted", "DealAttributeAsserted"):
        conn.execute(
            "INSERT INTO proj_fact (event_id, stream_type, stream_id, predicate, value, certainty, evidence_ids, recorded_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) ON CONFLICT (event_id) DO NOTHING",
            (ev["id"], ev["stream_type"], ev["stream_id"], p["predicate"], Jsonb(p["value"]), ev["certainty"],
             list(ev["evidence_ids"]), ev["recorded_at"]),
        )
        if ev["supersedes_event_id"]:
            conn.execute("UPDATE proj_fact SET superseded_by = %s WHERE event_id = %s", (ev["id"], ev["supersedes_event_id"]))
    elif t == "ClaimRetracted":
        conn.execute("UPDATE proj_fact SET retracted = true WHERE event_id = %s", (p["event_id"],))
        conn.execute("UPDATE proj_relationship SET superseded_by = %s WHERE event_id = %s", (ev["id"], p["event_id"]))
    elif t == "RelationshipAsserted":
        conn.execute(
            "INSERT INTO proj_relationship (event_id, subject_id, predicate, object_id, certainty, evidence_ids, recorded_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (event_id) DO NOTHING",
            (ev["id"], p["subject_id"], p["predicate"], p["object_id"], ev["certainty"], list(ev["evidence_ids"]), ev["recorded_at"]),
        )
        if ev["supersedes_event_id"]:
            conn.execute("UPDATE proj_relationship SET superseded_by = %s WHERE event_id = %s", (ev["id"], ev["supersedes_event_id"]))
    elif t == "SignalScored":
        conn.execute(
            """INSERT INTO proj_signal (id, source_id, title, url, publisher, published_at, fetched_at, tier, tier_rule, score,
                 breakdown, sectors, geographies, themes, directions, deal_types, entity_ids, summary, certainty,
                 read_at_source, evidence_ids, event_id, recorded_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (id) DO UPDATE SET tier = EXCLUDED.tier, tier_rule = EXCLUDED.tier_rule, score = EXCLUDED.score,
                 breakdown = EXCLUDED.breakdown, summary = EXCLUDED.summary, event_id = EXCLUDED.event_id,
                 entity_ids = EXCLUDED.entity_ids, evidence_ids = EXCLUDED.evidence_ids""",
            (ev["stream_id"], p["source_id"], p["title"], p["url"], p.get("publisher"), p.get("published_at"),
             p.get("fetched_at"), p["tier"], p["tier_rule"], p["score"], Jsonb(p["breakdown"]), p.get("sectors", []),
             p.get("geographies", []), p.get("themes", []), p.get("directions", []), p.get("deal_types", []),
             p.get("entity_ids", []), Jsonb(p.get("summary")), ev["certainty"], bool(p.get("read_at_source")),
             list(ev["evidence_ids"]), ev["id"], ev["recorded_at"]),
        )
        when = p.get("published_at") or ev["recorded_at"]
        if p.get("entity_ids"):
            conn.execute(
                "UPDATE proj_entity SET last_signal_at = GREATEST(coalesce(last_signal_at, %s::timestamptz), %s::timestamptz) WHERE id = ANY(%s)",
                (when, when, p["entity_ids"]),
            )
    elif t == "DemandDriverObserved":
        conn.execute(
            "INSERT INTO proj_demand_driver (event_id, driver_type, title, direction, geography, certainty, observed_at, source_id, "
            "evidence_ids, detail, recorded_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (event_id) DO NOTHING",
            (ev["id"], p["driver_type"], p["title"], p["direction"], p.get("geography", []), ev["certainty"],
             p.get("observed_at") or ev["occurred_at"], p.get("source_id"), list(ev["evidence_ids"]), Jsonb(p), ev["recorded_at"]),
        )
    elif t in ("ContactAdded", "TouchpointLogged", "NextActionSet", "PrequalificationStatusChanged") and ev["stream_type"] == "deal":
        kind = {"ContactAdded": "contact", "TouchpointLogged": "touchpoint", "NextActionSet": "next_action",
                "PrequalificationStatusChanged": "prequalification"}[t]
        conn.execute(
            "INSERT INTO proj_engagement (event_id, deal_id, kind, actor_id, data, recorded_at) VALUES (%s,%s,%s,%s,%s,%s) "
            "ON CONFLICT (event_id) DO NOTHING",
            (ev["id"], ev["stream_id"], kind, ev["actor_id"], Jsonb(p), ev["recorded_at"]),
        )
    elif t == "ProposalCreated":
        for proposed in p.get("events", []):
            if proposed.get("event_type") == "DealStageChanged":
                conn.execute(
                    "UPDATE proj_deal SET stage_pending = %s, pending_proposal_id = %s WHERE id = %s",
                    (proposed["payload"]["to_stage"], p["proposal_id"], proposed["stream_id"]),
                )
            elif proposed.get("event_type") == "SiteStatusChanged":
                conn.execute(
                    "UPDATE proj_entity SET status_pending = %s WHERE id = %s",
                    (proposed["payload"]["to_status"], proposed["stream_id"]),
                )
    elif t == "ProposalRejected":
        conn.execute("UPDATE proj_deal SET stage_pending = NULL, pending_proposal_id = NULL WHERE pending_proposal_id = %s", (p["proposal_id"],))
        for target in p.get("targets", []):
            if target.get("event_type") == "SiteStatusChanged":
                conn.execute("UPDATE proj_entity SET status_pending = NULL WHERE id = %s", (target["stream_id"],))


def apply_event(conn: psycopg.Connection, event: dict) -> None:
    _project_stream(conn, event)
    _project_cross_stream(conn, event)
    for hook in _after_apply_hooks:
        hook(conn, event)


def rebuild(conn: psycopg.Connection) -> int:
    """Delete all projections and replay every event. The caller commits."""
    conn.execute(sql.SQL("TRUNCATE {}").format(sql.SQL(", ").join(map(sql.Identifier, PROJECTION_TABLES))))
    count = 0
    with conn.cursor(name="replay") as cur:
        cur.itersize = 1000
        cur.execute("SELECT * FROM event ORDER BY recorded_at, id")
        events = cur.fetchall()
    for ev in events:
        apply_event(conn, ev)
        count += 1
    return count


def _canonical(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 9)
    if isinstance(value, dict):
        return {k: _canonical(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [_canonical(v) for v in value]
    return value


def projection_hashes(conn: psycopg.Connection) -> dict[str, str]:
    result = {}
    for table in PROJECTION_TABLES:
        pk = "event_id" if table in ("proj_fact", "proj_demand_driver", "proj_relationship", "proj_engagement") else "id"
        rows = conn.execute(sql.SQL("SELECT * FROM {} ORDER BY {}").format(sql.Identifier(table), sql.Identifier(pk))).fetchall()
        digest = hashlib.sha256()
        for row in rows:
            digest.update(json.dumps(_canonical(dict(row)), sort_keys=True, default=str).encode())
        result[table] = digest.hexdigest()
    return result


def _register_default_hooks() -> None:
    """The priority list calculator (docs/05 scorer rules 5 and 6) runs after the folds of each event."""
    from .priority import on_event

    register_hook(on_event)


_register_default_hooks()
