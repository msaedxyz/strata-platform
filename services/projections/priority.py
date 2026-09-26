"""Priority list calculator (M6). Source: docs/05-enrichment.md, scorer rules 5 and 6.

Rule 5: rank opportunities by lead time, demand estimate, confidence and the fit of the buyer.
Rule 6: a project in the engagement window with no contact found gets the highest rank in its group.

The calculator is a projector hook (projector.register_hook). It runs in the transaction of each event insert
and in a rebuild, after the folds. It reads the projections only, never an event that comes later, so a rebuild
gives the same values and hashes (docs/03 criterion 4). It writes the derived columns of proj_deal:
priority_score, priority_breakdown, lead_time_days, demand_litres_month, confidence and buyer_fit.

Lead time counts from the "as of" date of the calculation: the recorded time of the event that caused it.
Each part of the breakdown has its value, score, weight and contribution, and the event ids and the evidence ids
that it uses (docs/07 rule 1). All weights, scores and groups are in config/priority.yaml.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from services.common import config

DEAL_EVENTS = {"DealIdentified", "DealStageChanged", "DealAttributeAsserted", "ContactAdded", "TouchpointLogged",
               "NextActionSet", "PrequalificationStatusChanged"}
PROJECT_EVENTS = {"EntityIdentified", "ProjectStageChanged", "ProcurementWindowForecast", "DemandEstimated",
                  "RelationshipAsserted", "EntityAttributeAsserted"}
PARTS = ("lead_time", "demand", "confidence", "buyer_fit")
ROUND = 6


def _date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def interpolate(points: list[list[float]], x: float) -> float:
    """Linear interpolation between the points [x, score]. Outside the points, the nearest end score."""
    pts = sorted((float(a), float(b)) for a, b in points)
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:], strict=False):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0) if x1 != x0 else y1
    return pts[-1][1]


def _part(value: Any, score: float, weight: float, event_ids: list[str], evidence_ids: list[str], **extra) -> dict:
    return {"value": value, "score": round(score, ROUND), "weight": weight, "contribution": round(score * weight, ROUND),
            "event_ids": sorted(set(i for i in event_ids if i)), "evidence_ids": sorted(set(evidence_ids)), **extra}


def group_of(stage: str) -> dict:
    for order, g in enumerate(config.priority().get("groups") or [], start=1):
        if stage in g.get("stages", []):
            return {"id": g["id"], "name": g.get("name", g["id"]), "order": order}
    return {"id": "other", "name": "Other", "order": 999}


def _stage_index(code: str | None) -> int | None:
    codes = config.stage_codes()
    return codes.index(code) if code in codes else None


# ---------- the parts ----------


def _lead_time(cfg: dict, weight: float, project: dict | None, as_of: date) -> tuple[int | None, dict]:
    c = cfg.get("lead_time") or {}
    detail = (project or {}).get("forecast_detail") or {}
    start = _date((project or {}).get("forecast_start"))
    days = (start - as_of).days if start else None
    if days is not None and abs(days) > int(c.get("horizon_days", 3650)):
        days = None
    score = interpolate(c["points"], days) if days is not None else float(c.get("unknown_score", 0.0))
    return days, _part(days, score, weight, [detail.get("event_id")], list(detail.get("evidence_ids") or []),
                       unit="days", forecast_start=start.isoformat() if start else None,
                       forecast_end=_date((project or {}).get("forecast_end")).isoformat()
                       if (project or {}).get("forecast_end") else None,
                       project_stage=(project or {}).get("stage"), as_of=as_of.isoformat())


def _demand(cfg: dict, weight: float, estimate: dict | None, source: str | None) -> tuple[float | None, dict]:
    c = cfg.get("demand") or {}
    unit = config.demand_model().get("unit")
    value = float(estimate["value"]) if estimate and estimate.get("unit") == unit and estimate.get("value") is not None else None
    score = interpolate(c["points"], value) if value is not None else float(c.get("unknown_score", 0.0))
    inputs = (estimate or {}).get("inputs") or {}
    events = [(estimate or {}).get("event_id"), *(v.get("fact_event_id") for v in inputs.values())]
    evidence = [i for v in inputs.values() for i in v.get("evidence_ids") or []]
    return value, _part(value, score, weight, events, evidence, unit=unit, label="estimate" if value is not None else None,
                        formula_id=(estimate or {}).get("formula_id"), estimate_of=source,
                        inputs={k: {"value": v.get("value"), "evidence_ids": sorted(v.get("evidence_ids") or []),
                                    "fact_event_id": v.get("fact_event_id")} for k, v in sorted(inputs.items())})


def _confidence(conn: psycopg.Connection, cfg: dict, weight: float, deal: dict) -> tuple[float, dict]:
    c = cfg.get("confidence") or {}
    certainty = deal.get("certainty")
    score = float((c.get("certainty_scores") or {}).get(certainty, c.get("unknown_score", 0.5)))
    first = conn.execute(
        "SELECT id FROM event WHERE stream_type = 'deal' AND stream_id = %s AND event_type = 'DealIdentified' "
        "ORDER BY sequence LIMIT 1", (deal["id"],),
    ).fetchone()
    return score, _part(certainty, score, weight, [first["id"]] if first else [], list(deal.get("evidence_ids") or []))


def _buyer_fit(conn: psycopg.Connection, cfg: dict, weight: float, deal: dict) -> tuple[float, dict]:
    c = cfg.get("buyer_fit") or {}
    role_scores: dict[str, float] = c.get("role_scores") or {}
    subjects = [x for x in (deal.get("project_id"), deal.get("site_id")) if x]
    roles = conn.execute(
        "SELECT r.event_id, r.predicate, r.object_id, r.evidence_ids, o.name AS organisation_name FROM proj_relationship r "
        "LEFT JOIN proj_entity o ON o.id = r.object_id WHERE r.subject_id = ANY(%s) AND r.predicate LIKE 'buyer_role_%%' "
        "AND r.superseded_by IS NULL ORDER BY r.event_id",
        (subjects,),
    ).fetchall() if subjects else []
    contractors = {k for k in role_scores if k != "buyer_role_owner" and k != "buyer_role_fuel_supplier"}
    has_contractor = any(r["predicate"] in contractors for r in roles)
    best, best_rows, detail = None, [], []
    for r in roles:
        score = float(role_scores.get(r["predicate"], 0.0))
        basis = r["predicate"]
        if r["predicate"] == "buyer_role_owner":
            operates = deal.get("site_id") and conn.execute(
                "SELECT 1 FROM proj_relationship WHERE subject_id = %s AND object_id = %s AND predicate = 'operates' "
                "AND superseded_by IS NULL LIMIT 1", (r["object_id"], deal["site_id"]),
            ).fetchone()
            if r["object_id"] == deal.get("organisation_id") or (operates and not has_contractor):
                score, basis = float(c.get("owner_direct_buyer_score", score)), "owner_direct_buyer"
        detail.append({"role": r["predicate"], "organisation_id": r["object_id"], "organisation_name": r["organisation_name"],
                       "score": score, "basis": basis, "event_id": r["event_id"]})
        if best is None or score > best:
            best, best_rows = score, [r]
        elif score == best:
            best_rows.append(r)
    if best is None:
        if deal.get("organisation_id"):
            best, basis = float(c.get("organisation_only_score", 0.4)), "organisation_only"
        else:
            best, basis = float(c.get("unknown_score", 0.3)), "unknown"
        return best, _part(basis, best, weight, [], [], roles=[])
    return best, _part(max(detail, key=lambda d: d["score"])["basis"], best, weight,
                       [r["event_id"] for r in best_rows], [i for r in best_rows for i in r["evidence_ids"]],
                       roles=sorted(detail, key=lambda d: (-d["score"], d["event_id"])))


def _no_contact(conn: psycopg.Connection, cfg: dict, deal: dict, project: dict | None) -> dict:
    c = cfg.get("no_contact_rule") or {}
    contact_events = conn.execute(
        "SELECT event_id, kind FROM proj_engagement WHERE deal_id = %s AND (kind = 'contact' OR "
        "(kind = 'touchpoint' AND coalesce(data->>'contact_id', '') <> '')) ORDER BY event_id",
        (deal["id"],),
    ).fetchall()
    from_idx = _stage_index(c.get("contact_found_from_stage"))
    stage_idx = _stage_index(deal.get("stage"))
    by_stage = from_idx is not None and stage_idx is not None and stage_idx >= from_idx
    contact_found = bool(deal.get("has_contact") or contact_events or by_stage)
    in_window = bool(project and project.get("in_engagement_window"))
    applied = in_window and not contact_found
    boost = float(c.get("boost", 1.0))
    return {"value": applied, "applied": applied, "in_engagement_window": in_window, "contact_found": contact_found,
            "contact_found_by": "stage" if by_stage and not (deal.get("has_contact") or contact_events)
            else ("engagement" if contact_found else None),
            "project_stage": (project or {}).get("stage"), "contribution": boost if applied else 0.0, "weight": None,
            "event_ids": sorted({*([project["stage_event_id"]] if project and project.get("stage_event_id") else []),
                                 *(r["event_id"] for r in contact_events)}),
            "evidence_ids": sorted(set((project or {}).get("stage_evidence_ids") or []))}


# ---------- calculation ----------


def calculate(conn: psycopg.Connection, deal: dict, as_of: datetime | date) -> dict:
    """The derived values and the breakdown of one deal (a proj_deal row)."""
    cfg = config.priority()
    weights = cfg["weights"]
    as_of_date = _date(as_of) or date.today()
    project = conn.execute("SELECT * FROM proj_project WHERE id = %s", (deal["project_id"],)).fetchone() \
        if deal.get("project_id") else None
    estimate, source = (project or {}).get("demand_estimate"), ("project" if project and project.get("demand_estimate") else None)
    if estimate is None and deal.get("site_id"):
        site = conn.execute("SELECT demand_estimate FROM proj_entity WHERE id = %s", (deal["site_id"],)).fetchone()
        estimate = site["demand_estimate"] if site else None
        source = "site" if estimate else None
    lead_days, lead = _lead_time(cfg, float(weights["lead_time"]), project, as_of_date)
    litres, demand = _demand(cfg, float(weights["demand"]), estimate, source)
    confidence, conf = _confidence(conn, cfg, float(weights["confidence"]), deal)
    fit, buyer = _buyer_fit(conn, cfg, float(weights["buyer_fit"]), deal)
    rule = _no_contact(conn, cfg, deal, project)
    weighted = round(sum(p["contribution"] for p in (lead, demand, conf, buyer)), ROUND)
    total = round(weighted + rule["contribution"], ROUND)
    breakdown = {
        "version": cfg.get("version"), "as_of": as_of_date.isoformat(), "parts": [*PARTS, "no_contact_boost"],
        "lead_time": lead, "demand": demand, "confidence": conf, "buyer_fit": buyer, "no_contact_boost": rule,
        "weighted_score": weighted, "total": total, "group": group_of(deal["stage"]),
        "project_id": deal.get("project_id"),
    }
    return {"priority_score": total, "priority_breakdown": breakdown, "lead_time_days": lead_days,
            "demand_litres_month": litres, "confidence": round(confidence, ROUND), "buyer_fit": round(fit, ROUND)}


def recalculate(conn: psycopg.Connection, deal_id: str, as_of: datetime | date) -> dict | None:
    deal = conn.execute("SELECT * FROM proj_deal WHERE id = %s", (deal_id,)).fetchone()
    if deal is None:
        return None
    values = calculate(conn, deal, as_of)
    conn.execute(
        "UPDATE proj_deal SET priority_score = %s, priority_breakdown = %s, lead_time_days = %s, demand_litres_month = %s, "
        "confidence = %s, buyer_fit = %s WHERE id = %s",
        (values["priority_score"], Jsonb(values["priority_breakdown"]), values["lead_time_days"],
         values["demand_litres_month"], values["confidence"], values["buyer_fit"], deal_id),
    )
    return values


def _deals_of(conn: psycopg.Connection, ids: list[str]) -> list[str]:
    ids = [i for i in ids if i]
    if not ids:
        return []
    rows = conn.execute(
        "SELECT id FROM proj_deal WHERE project_id = ANY(%s) OR site_id = ANY(%s) OR organisation_id = ANY(%s) ORDER BY id",
        (ids, ids, ids),
    ).fetchall()
    return [r["id"] for r in rows]


def affected_deals(conn: psycopg.Connection, event: dict) -> list[str]:
    """The deals whose priority an event can change."""
    t, stream_type, stream_id, p = event["event_type"], event["stream_type"], event["stream_id"], event["payload"]
    if stream_type == "deal" and t in DEAL_EVENTS:
        return [stream_id]
    if t == "RelationshipAsserted":
        return _deals_of(conn, [p.get("subject_id"), p.get("object_id")])
    if t == "ClaimRetracted":
        rel = conn.execute("SELECT subject_id, object_id FROM proj_relationship WHERE event_id = %s",
                           (p.get("event_id"),)).fetchone()
        return _deals_of(conn, [stream_id, *([rel["subject_id"], rel["object_id"]] if rel else [])])
    if stream_type == "project" and t in PROJECT_EVENTS:
        return [r["id"] for r in conn.execute("SELECT id FROM proj_deal WHERE project_id = %s ORDER BY id",
                                              (stream_id,)).fetchall()]
    if stream_type == "entity" and t == "DemandEstimated":
        return [r["id"] for r in conn.execute("SELECT id FROM proj_deal WHERE site_id = %s ORDER BY id",
                                              (stream_id,)).fetchall()]
    return []


def on_event(conn: psycopg.Connection, event: dict) -> None:
    """The projector hook: recalculate each deal that the event can change."""
    for deal_id in affected_deals(conn, event):
        recalculate(conn, deal_id, event["recorded_at"])
