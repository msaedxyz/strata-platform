"""Read endpoints for the Strata modules. Each endpoint reads the projections (proj_* tables).

Detail endpoints take `as_of` and then calculate the state from the events with the same folds
that the projector uses (docs/03-data-model.md constraint 6). Every fact carries evidence ids.
The API never returns the full text of a source whose licence is not full.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from services.common import config
from services.common.db import connection
from services.governance.event_store import stream_events
from services.projections.folds import FOLDS

from ..auth import User, require_viewer
from .schemas import PriorityList

router = APIRouter(prefix="/api", tags=["read"])


def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_jsonable(v) for v in value]
    return value


def _rows(rows: list[dict]) -> list[dict]:
    return [_jsonable(dict(r)) for r in rows]


# ---------- configuration for the frontend ----------


@router.get("/config/stages")
def stages(user: User = Depends(require_viewer)) -> dict:
    """Deal stages (Kanban columns), lifecycle stages and the engagement window."""
    lc = config.lifecycle()
    return {
        "deal_stages": config.stages(),
        "lifecycle_stages": lc["stages"],
        "restart_path": lc.get("restart_path", []),
        "engagement_window": lc["engagement_window"],
        "procurement_stage": lc["procurement_stage"],
    }


@router.get("/config/taxonomy")
def taxonomy(user: User = Depends(require_viewer)) -> dict:
    """Codes and names for the filters of the signal feed and the map."""
    return {
        "sectors": config.taxonomy("sectors")["sectors"],
        "site_classes": config.taxonomy("site-classes")["site_classes"],
        "geographies": config.taxonomy("geographies"),
        "deal_types": config.taxonomy("deal-types"),
    }


# ---------- ticker, signals, drivers ----------

# The alert of a signal (docs/06: the alert shows its status in every place where it appears).
_ALERT_JOIN = ("LEFT JOIN LATERAL (SELECT pa.id, pa.status FROM proj_alert pa "
               "WHERE pa.signal_id = s.id OR pa.source_id = s.source_id ORDER BY pa.raised_at DESC LIMIT 1) a ON true")


@router.get("/ticker")
def ticker(limit: int = Query(40, le=200), user: User = Depends(require_viewer)) -> dict:
    """The latest Tier 0 and Tier 1 signals, and counts by tier for the last 24 hours and 7 days."""
    with connection() as conn:
        items = conn.execute(
            "SELECT s.id, s.title, s.url, s.publisher, s.published_at, s.tier, s.tier_rule, s.score, s.read_at_source, "
            "s.evidence_ids, s.recorded_at, a.id AS alert_id, a.status AS alert_status "
            f"FROM proj_signal s {_ALERT_JOIN} WHERE s.tier IN (0, 1) "
            "ORDER BY coalesce(s.published_at, s.recorded_at) DESC LIMIT %s",
            (limit,),
        ).fetchall()
        counts = conn.execute(
            "SELECT tier, count(*) FILTER (WHERE coalesce(published_at, recorded_at) > now() - interval '24 hours') AS day, "
            "count(*) FILTER (WHERE coalesce(published_at, recorded_at) > now() - interval '7 days') AS week, count(*) AS total "
            "FROM proj_signal GROUP BY tier ORDER BY tier"
        ).fetchall()
    return {"items": _rows(items), "counts": _rows(counts)}


@router.get("/signals")
def signals(
    tier: list[int] | None = Query(None),
    sector: list[str] | None = Query(None),
    geography: list[str] | None = Query(None),
    theme: list[str] | None = Query(None),
    entity_id: str | None = None,
    q: str | None = None,
    limit: int = Query(100, le=1000),
    offset: int = 0,
    user: User = Depends(require_viewer),
) -> dict:
    """All in-scope items with filters by tier, sector, geography, theme, entity and text."""
    where, args = ["true"], []
    if tier:
        where.append("tier = ANY(%s)")
        args.append(tier)
    if sector:
        where.append("sectors && %s")
        args.append(sector)
    if geography:
        where.append("geographies && %s")
        args.append(geography)
    if theme:
        where.append("themes && %s")
        args.append(theme)
    if entity_id:
        where.append("%s = ANY(entity_ids)")
        args.append(entity_id)
    if q:
        where.append("title ILIKE %s")
        args.append(f"%{q}%")
    clause = " AND ".join(where)
    with connection() as conn:
        total = conn.execute(f"SELECT count(*) AS n FROM proj_signal WHERE {clause}", args).fetchone()["n"]
        items = conn.execute(
            f"SELECT s.*, a.id AS alert_id, a.status AS alert_status FROM proj_signal s {_ALERT_JOIN} "
            f"WHERE {clause} ORDER BY coalesce(s.published_at, s.recorded_at) DESC, s.id DESC LIMIT %s OFFSET %s",
            [*args, limit, offset],
        ).fetchall()
    return {"total": total, "items": _rows(items)}


@router.get("/demand-drivers")
def demand_drivers(limit: int = Query(100, le=500), user: User = Depends(require_viewer)) -> dict:
    """Market events that change diesel demand for all customers (stream 'market')."""
    with connection() as conn:
        items = conn.execute(
            "SELECT d.*, s.url, s.publisher, s.published_at FROM proj_demand_driver d LEFT JOIN source s ON s.id = d.source_id "
            "ORDER BY coalesce(d.observed_at, d.recorded_at) DESC LIMIT %s",
            (limit,),
        ).fetchall()
    return {"items": _rows(items)}


@router.get("/alerts")
def alerts(
    status: list[str] | None = Query(None),
    tier: int | None = None,
    limit: int = Query(100, le=500),
    user: User = Depends(require_viewer),
) -> dict:
    """Alerts with their status. Tier 0 alerts appear as unconfirmed before any approval."""
    where, args = ["true"], []
    if status:
        where.append("status = ANY(%s)")
        args.append(status)
    if tier is not None:
        where.append("tier = %s")
        args.append(tier)
    with connection() as conn:
        items = conn.execute(
            f"SELECT a.*, s.url, s.publisher FROM proj_alert a LEFT JOIN source s ON s.id = a.source_id "
            f"WHERE {' AND '.join(where)} ORDER BY raised_at DESC LIMIT %s",
            [*args, limit],
        ).fetchall()
    return {"items": _rows(items)}


# ---------- sites, entities, map ----------


@router.get("/sites")
def sites(
    watch: str = Query("all", pattern="^(daily|weekly|all|any)$"),
    site_class: list[str] | None = Query(None),
    user: User = Depends(require_viewer),
) -> dict:
    """Sites with status, pending status, operator and last signal. watch=all gives the daily and weekly lists.

    Each fact has its provenance (docs/07 rule 1): identity_evidence_ids (the first EntityIdentified), status_event_id
    and status_evidence_ids (the last SiteStatusChanged), operator_event_id and operator_evidence_ids, and
    last_signal_id and last_signal_evidence_ids."""
    where, args = ["e.type = 'site'", "e.merged_into IS NULL"], []
    if watch in ("daily", "weekly"):
        where.append("e.watch = %s")
        args.append(watch)
    elif watch == "all":
        where.append("e.watch IN ('daily', 'weekly')")
    if site_class:
        where.append("e.site_class = ANY(%s)")
        args.append(site_class)
    with connection() as conn:
        items = conn.execute(
            f"""SELECT e.id, e.name, e.aliases, e.site_class, e.watch, e.status, e.status_pending, e.district, e.province,
                       e.lat, e.lon, e.geometry_approximate, e.last_signal_at, e.attributes,
                       e.identity_evidence_ids, e.status_event_id, e.status_evidence_ids, e.status_certainty,
                       op.id AS operator_id, op.name AS operator_name, op.event_id AS operator_event_id,
                       coalesce(op.evidence_ids, '{{}}') AS operator_evidence_ids,
                       ls.id AS last_signal_id, ls.title AS last_signal_title,
                       coalesce(ls.evidence_ids, '{{}}') AS last_signal_evidence_ids
                FROM proj_entity e
                LEFT JOIN LATERAL (
                  SELECT o.id, o.name, r.event_id, r.evidence_ids FROM proj_relationship r JOIN proj_entity o ON o.id = r.subject_id
                  WHERE r.object_id = e.id AND r.predicate = 'operates' AND r.superseded_by IS NULL
                  ORDER BY r.recorded_at DESC LIMIT 1) op ON true
                LEFT JOIN LATERAL (
                  SELECT s.id, s.title, s.evidence_ids FROM proj_signal s WHERE e.id = ANY(s.entity_ids)
                  ORDER BY coalesce(s.published_at, s.recorded_at) DESC, s.id DESC LIMIT 1) ls ON true
                WHERE {' AND '.join(where)}
                ORDER BY CASE e.watch WHEN 'daily' THEN 0 WHEN 'weekly' THEN 1 ELSE 2 END, e.name""",
            args,
        ).fetchall()
    return {"items": _rows(items)}


@router.get("/entities")
def entities(
    type: str | None = None,
    q: str | None = None,
    limit: int = Query(50, le=500),
    user: User = Depends(require_viewer),
) -> dict:
    """Search entities by name (trigram similarity)."""
    where, args = ["merged_into IS NULL"], []
    if type:
        where.append("type = %s")
        args.append(type)
    order = "name"
    if q:
        where.append("(normalised_name %% lower(%s) OR name ILIKE %s)")
        args += [q, f"%{q}%"]
        order = "similarity(normalised_name, lower(%s)) DESC"
    with connection() as conn:
        items = conn.execute(
            f"SELECT id, type, name, site_class, watch, status, district, province FROM proj_entity "
            f"WHERE {' AND '.join(where)} ORDER BY {order} LIMIT %s",
            [*args, *([q] if q else []), limit],
        ).fetchall()
    return {"items": _rows(items)}


def _fold(stream_type: str, stream_id: str, as_of: datetime | None) -> dict | None:
    fold = FOLDS[stream_type]
    with connection() as conn:
        return fold(stream_events(conn, stream_type, stream_id, as_of=as_of))


@router.get("/entities/{entity_id}")
def entity_detail(entity_id: str, as_of: datetime | None = None, user: User = Depends(require_viewer)) -> dict:
    """An entity with its facts, relationships and recent signals. `as_of` gives the state at a past time."""
    state = _fold("entity", entity_id, as_of)
    if state is None:
        raise HTTPException(404, "entity not found")
    with connection() as conn:
        time_filter = "AND recorded_at <= %s" if as_of else ""
        targs = [as_of] if as_of else []
        facts = conn.execute(
            f"SELECT * FROM proj_fact WHERE stream_type = 'entity' AND stream_id = %s {time_filter} ORDER BY recorded_at DESC",
            [entity_id, *targs],
        ).fetchall()
        rels = conn.execute(
            f"""SELECT r.*, s.name AS subject_name, o.name AS object_name FROM proj_relationship r
                LEFT JOIN proj_entity s ON s.id = r.subject_id LEFT JOIN proj_entity o ON o.id = r.object_id
                WHERE (r.subject_id = %s OR r.object_id = %s) {time_filter.replace('recorded_at', 'r.recorded_at')}
                ORDER BY r.recorded_at DESC""",
            [entity_id, entity_id, *targs],
        ).fetchall()
        sig = conn.execute(
            "SELECT id, title, url, publisher, published_at, tier, score, evidence_ids FROM proj_signal "
            "WHERE %s = ANY(entity_ids) ORDER BY coalesce(published_at, recorded_at) DESC LIMIT 20",
            (entity_id,),
        ).fetchall()
        reg = conn.execute(
            "SELECT geometry_source, external_ids FROM entity WHERE id = %s", (entity_id,)
        ).fetchone()
    return {
        "entity": _jsonable(state),
        "registry": _jsonable(dict(reg)) if reg else None,
        "facts": _rows(facts),
        "relationships": _rows(rels),
        "signals": _rows(sig),
        "as_of": as_of.isoformat() if as_of else None,
    }


@router.get("/map")
def map_layers(
    site_class: list[str] | None = Query(None),
    stage: list[str] | None = Query(None),
    sector: list[str] | None = Query(None),
    user: User = Depends(require_viewer),
) -> dict:
    """Sites with coordinates, opportunities at those sites, and counts of recent signals by site.

    Provenance (docs/07 rule 1): each site has identity_evidence_ids, status_event_id, status_evidence_ids and the
    geometry_source (the dataset of the coordinates). Each deal has evidence_ids, stage_event_id and
    stage_evidence_ids. Each project has stage_evidence_ids and the forecast evidence."""
    where, args = ["e.type = 'site'", "e.lat IS NOT NULL", "e.merged_into IS NULL"], []
    if site_class:
        where.append("e.site_class = ANY(%s)")
        args.append(site_class)
    with connection() as conn:
        site_rows = conn.execute(
            f"""SELECT e.id, e.name, e.site_class, e.watch, e.status, e.status_pending, e.lat, e.lon,
                       e.geometry_approximate, e.last_signal_at, e.identity_evidence_ids, e.status_event_id,
                       e.status_evidence_ids, e.status_certainty, g.geometry_source,
                       (SELECT count(*) FROM proj_signal s WHERE e.id = ANY(s.entity_ids)
                          AND coalesce(s.published_at, s.recorded_at) > now() - interval '90 days') AS signals_90d
                FROM proj_entity e LEFT JOIN entity g ON g.id = e.id WHERE {' AND '.join(where)}""",
            args,
        ).fetchall()
        dwhere, dargs = ["d.site_id IS NOT NULL"], []
        if stage:
            dwhere.append("d.stage = ANY(%s)")
            dargs.append(stage)
        deal_rows = conn.execute(
            f"SELECT d.id, d.title, d.stage, d.stage_pending, d.deal_type, d.site_id, d.priority_score, d.evidence_ids, "
            f"d.stage_event_id, d.stage_evidence_ids, d.stage_reason FROM proj_deal d "
            f"WHERE {' AND '.join(dwhere)}",
            dargs,
        ).fetchall()
        project_rows = conn.execute(
            "SELECT id, name, site_id, stage, sector, in_engagement_window, forecast_start, forecast_end, stage_event_id, "
            "stage_evidence_ids, forecast_detail->>'event_id' AS forecast_event_id, "
            "coalesce(ARRAY(SELECT jsonb_array_elements_text(forecast_detail->'evidence_ids')), '{}') AS forecast_evidence_ids "
            "FROM proj_project "
            "WHERE site_id IS NOT NULL" + (" AND sector = ANY(%s)" if sector else ""),
            [sector] if sector else [],
        ).fetchall()
    return {"sites": _rows(site_rows), "deals": _rows(deal_rows), "projects": _rows(project_rows)}


# ---------- projects, calendar ----------


@router.get("/projects")
def projects(stage: list[str] | None = Query(None), user: User = Depends(require_viewer)) -> dict:
    """Projects by lifecycle stage, with the engagement window flag and the forecast."""
    where, args = ["true"], []
    if stage:
        where.append("p.stage = ANY(%s)")
        args.append(stage)
    with connection() as conn:
        items = conn.execute(
            f"SELECT p.*, s.name AS site_name, s.site_class FROM proj_project p LEFT JOIN proj_entity s ON s.id = p.site_id "
            f"WHERE {' AND '.join(where)} ORDER BY p.stage_order NULLS FIRST, p.name",
            args,
        ).fetchall()
    return {"items": _rows(items)}


@router.get("/projects/{project_id}")
def project_detail(project_id: str, as_of: datetime | None = None, user: User = Depends(require_viewer)) -> dict:
    state = _fold("project", project_id, as_of)
    if state is None:
        raise HTTPException(404, "project not found")
    with connection() as conn:
        rels = conn.execute(
            "SELECT r.*, o.name AS object_name FROM proj_relationship r LEFT JOIN proj_entity o ON o.id = r.object_id "
            "WHERE r.subject_id = %s AND r.superseded_by IS NULL ORDER BY r.recorded_at",
            (project_id,),
        ).fetchall()
    return {"project": _jsonable(state), "relationships": _rows(rels), "as_of": as_of.isoformat() if as_of else None}


@router.get("/calendar")
def calendar(months: int = Query(24, ge=1, le=60), user: User = Depends(require_viewer)) -> dict:
    """Forecast procurement windows on a time axis. Projects without a date show their stage only.

    Each item has the forecast detail (the intervals, the supporting projects and the evidence ids) and the stage
    evidence (stage_event_id, stage_evidence_ids)."""
    with connection() as conn:
        items = conn.execute(
            "SELECT p.id, p.name, p.stage, p.stage_order, p.in_engagement_window, p.forecast_start, p.forecast_end, "
            "p.forecast_detail, p.site_id, s.name AS site_name, p.stage_event_id, p.stage_evidence_ids, p.stage_certainty, "
            "p.demand_estimate FROM proj_project p LEFT JOIN proj_entity s ON s.id = p.site_id "
            "WHERE p.stage IS NOT NULL ORDER BY p.forecast_start NULLS LAST, p.name"
        ).fetchall()
    return {"months": months, "items": _rows(items)}


# ---------- deals, priority, relationships ----------


@router.get("/deals")
def deals(stage: list[str] | None = Query(None), user: User = Depends(require_viewer)) -> dict:
    """Opportunities with their stage and pending stage (Kanban board)."""
    where, args = ["true"], []
    if stage:
        where.append("d.stage = ANY(%s)")
        args.append(stage)
    with connection() as conn:
        items = conn.execute(
            f"SELECT d.*, s.name AS site_name, o.name AS organisation_name FROM proj_deal d "
            f"LEFT JOIN proj_entity s ON s.id = d.site_id LEFT JOIN proj_entity o ON o.id = d.organisation_id "
            f"WHERE {' AND '.join(where)} ORDER BY d.updated_at DESC",
            args,
        ).fetchall()
    return {"items": _rows(items)}


@router.get("/deals/{deal_id}")
def deal_detail(deal_id: str, as_of: datetime | None = None, user: User = Depends(require_viewer)) -> dict:
    state = _fold("deal", deal_id, as_of)
    if state is None:
        raise HTTPException(404, "deal not found")
    return {"deal": _jsonable(state), "as_of": as_of.isoformat() if as_of else None}


@router.get("/priority", response_model=PriorityList)
def priority(limit: int = Query(100, le=500), user: User = Depends(require_viewer)) -> dict:
    """Opportunities ranked by lead time, demand estimate, confidence and buyer fit, with the breakdown.

    The list shows the groups of config/priority.yaml in order. In each group, a deal whose project is in the
    engagement window and has no contact found comes first (docs/05 scorer rule 6), then the other deals by score.
    Each part of priority_breakdown has its value, score, weight, contribution, event_ids and evidence_ids.
    """
    with connection() as conn:
        items = conn.execute(
            """WITH ranked AS (
                 SELECT d.id, d.title, d.deal_type, d.stage, d.stage_pending, d.site_id, s.name AS site_name, d.project_id,
                        p.name AS project_name, d.lead_time_days, d.demand_litres_month, d.confidence, d.buyer_fit,
                        d.has_contact, d.priority_score, d.priority_breakdown, d.evidence_ids, d.stage_event_id,
                        d.stage_evidence_ids, d.updated_at,
                        d.priority_breakdown->'group'->>'id' AS priority_group,
                        coalesce((d.priority_breakdown->'group'->>'order')::int, 999) AS group_order,
                        coalesce((d.priority_breakdown->'no_contact_boost'->>'applied')::boolean, false) AS no_contact_rule
                   FROM proj_deal d LEFT JOIN proj_entity s ON s.id = d.site_id LEFT JOIN proj_project p ON p.id = d.project_id
                  WHERE NOT (d.stage = ANY(%s)))
               SELECT *, row_number() OVER (ORDER BY group_order, no_contact_rule DESC, priority_score DESC NULLS LAST,
                                                     updated_at DESC, id) AS rank,
                         row_number() OVER (PARTITION BY group_order ORDER BY no_contact_rule DESC,
                                            priority_score DESC NULLS LAST, updated_at DESC, id) AS group_rank
                 FROM ranked ORDER BY rank LIMIT %s""",
            ([s["code"] for s in config.stages() if s.get("terminal")], limit),
        ).fetchall()
    return {"items": _rows(items)}


def _personal_view(conn, person_id: str | None, blob: dict | None) -> dict:
    from services.governance import personal

    if not person_id:
        return {f: None for f in personal.encrypted_fields()}
    try:
        return personal.reader_view(conn, person_id, blob)
    except personal.PersonalDataUnavailable:
        return {**{f: None for f in personal.encrypted_fields()}, "erased": personal.is_erased(conn, person_id),
                "unavailable": True}


@router.get("/deals/{deal_id}/relationship")
def deal_relationship(deal_id: str, user: User = Depends(require_viewer)) -> dict:
    """Buyer roles, contacts, touchpoints, next action and prequalification status for one opportunity."""
    with connection() as conn:
        deal = conn.execute("SELECT * FROM proj_deal WHERE id = %s", (deal_id,)).fetchone()
        if deal is None:
            raise HTTPException(404, "deal not found")
        subjects = [x for x in (deal["project_id"], deal["site_id"]) if x]
        buyers = conn.execute(
            "SELECT r.*, o.name AS organisation_name FROM proj_relationship r LEFT JOIN proj_entity o ON o.id = r.object_id "
            "WHERE r.subject_id = ANY(%s) AND r.predicate LIKE 'buyer_role_%%' AND r.superseded_by IS NULL ORDER BY r.recorded_at",
            (subjects,),
        ).fetchall()
        engagement = conn.execute(
            "SELECT * FROM proj_engagement WHERE deal_id = %s ORDER BY recorded_at DESC", (deal_id,)
        ).fetchall()
        grouped: dict[str, list] = {"contact": [], "touchpoint": [], "next_action": [], "prequalification": []}
        for row in _rows(engagement):
            if row["kind"] == "contact":
                # The personal fields are encrypted with the key of the person (docs/06). After erasure they are empty.
                data = dict(row["data"])
                blob = data.pop("personal", None)
                data.update(_personal_view(conn, data.get("contact_id"), blob))
                row["data"] = data
            grouped[row["kind"]].append(row)
    return {
        "deal": _jsonable(dict(deal)),
        "buyer_roles": _rows(buyers),
        "contacts": grouped["contact"],
        "touchpoints": grouped["touchpoint"],
        "next_action": grouped["next_action"][0] if grouped["next_action"] else None,
        "prequalification": grouped["prequalification"],
    }


# ---------- timeline and evidence ----------


@router.get("/timeline")
def timeline(
    stream_type: str,
    stream_id: str,
    as_of: datetime | None = None,
    user: User = Depends(require_viewer),
) -> dict:
    """The events of one entity, project or deal, with evidence links, up to `as_of`."""
    with connection() as conn:
        events = stream_events(conn, stream_type, stream_id, as_of=as_of)
        # Proposal events that name this stream, so the timeline shows pending changes too.
        proposals = conn.execute(
            "SELECT id, title, status, created_at, decided_at, decided_by FROM proposal WHERE stream_type = %s AND stream_id = %s "
            + ("AND created_at <= %s " if as_of else "")
            + "ORDER BY created_at",
            [stream_type, stream_id, *([as_of] if as_of else [])],
        ).fetchall()
    items = [
        {
            "id": e["id"], "sequence": e["sequence"], "event_type": e["event_type"], "payload": _jsonable(e["payload"]),
            "evidence_ids": e["evidence_ids"], "certainty": e["certainty"], "actor_type": e["actor_type"],
            "actor_id": e["actor_id"], "proposal_id": e["proposal_id"], "supersedes_event_id": e["supersedes_event_id"],
            "occurred_at": _jsonable(e["occurred_at"]), "recorded_at": _jsonable(e["recorded_at"]),
        }
        for e in events
    ]
    state = FOLDS[stream_type](events) if stream_type in FOLDS else None
    return {"items": items, "proposals": _rows(proposals), "state": _jsonable(state), "as_of": as_of.isoformat() if as_of else None}


@router.get("/evidence")
def evidence(ids: list[str] = Query(...), user: User = Depends(require_viewer)) -> dict:
    """Evidence items: the quote with its span offsets and a link to the source.

    For a source with licence full, the response also gives a short text window around the span,
    so the frontend can highlight the span in context. For other licences it gives the quote only.
    """
    with connection() as conn:
        rows = conn.execute(
            "SELECT v.id, v.source_id, v.char_start, v.char_end, v.quote, v.verified, s.url, s.title, s.publisher, "
            "s.published_at, s.retention_policy, s.read_at_source, s.excerpt, s.type FROM evidence v "
            "JOIN source s ON s.id = v.source_id WHERE v.id = ANY(%s)",
            (ids,),
        ).fetchall()
    out = []
    for r in _rows(rows):
        r["context"] = None
        if r["retention_policy"] == "full" and r["excerpt"] and r["quote"] in r["excerpt"]:
            r["context"] = r["excerpt"]
        out.append(r)
    return {"items": out}
