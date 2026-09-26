"""Window forecaster (docs/05-enrichment.md). A model does not produce the forecast.

The forecaster calculates the start of contractor procurement from the current lifecycle stage of a
project and the intervals in config/lifecycle-intervals.generated.yaml (config/lifecycle.yaml names the
file). The forecast is a date range: base date + the shortest interval to base date + the longest
interval, with the median. It shows the intervals, the projects that support them and the evidence.

When fewer than min_projects_per_interval projects support the interval, start and end are null and
only the stage shows. shift_months_nearer compares the new start with the previous forecast, so that
the scorer can raise the Tier 0 rule "forecast moves six months nearer".
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta

import psycopg

from services.common import config as common_config
from services.common.logging import log

from . import config

logger = logging.getLogger("strata.enrichment.forecaster")
AGENT = "window_forecaster"
DAYS_PER_MONTH = 30.44


def model_id() -> str:
    return str(common_config.models()["agents"].get(AGENT, {}).get("model") or "none")


def prompt_version() -> str:
    data = config.lifecycle_intervals()
    return f"intervals:{data.get('generated_on', 'unknown')}"


def _as_date(value) -> date | None:
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


def _order(code: str) -> int | None:
    for s in common_config.lifecycle()["stages"]:
        if s["code"] == code:
            return s["order"]
    return None


def calculate(stage: str, base_date: date | datetime | str | None, previous_start: date | str | None = None) -> dict | None:
    """The forecast payload for a project at a stage, or None when procurement has started already."""
    lc = common_config.lifecycle()
    target = lc["procurement_stage"]
    if stage not in common_config.lifecycle_codes():
        return None
    stage_order, target_order = _order(stage), _order(target)
    if stage == target or (stage_order is not None and target_order is not None and stage_order > target_order
                           and stage != "care_maintenance_suspension_closure"):
        return None
    base = _as_date(base_date) or date.today()
    min_projects = int(lc.get("min_projects_per_interval", 5))
    data = config.lifecycle_intervals()
    matches = [i for i in data.get("intervals") or [] if i["from"] == stage and i["to"] == target]
    intervals = []
    for iv in matches:
        intervals.append({
            "from": iv["from"], "to": iv["to"], "median_days": iv.get("median_days"), "min_days": iv.get("min_days"),
            "max_days": iv.get("max_days"), "n_projects": iv.get("n_projects", 0), "projects": list(iv.get("projects") or []),
            "project_days": dict(iv.get("project_days") or {}),
            "insufficient": bool(iv.get("insufficient")) or iv.get("n_projects", 0) < min_projects,
        })
    usable = [i for i in intervals if not i["insufficient"] and i["median_days"] is not None]
    payload: dict = {
        "current_stage": stage,
        "procurement_stage": target,
        "base_date": base.isoformat(),
        "min_projects_per_interval": min_projects,
        "intervals": intervals,
        "intervals_source": lc.get("intervals_file"),
        "start": None,
        "end": None,
        "median": None,
        "stage_only": not usable,
        "supporting_projects": [],
        "shift_months_nearer": None,
    }
    if usable:
        iv = usable[0]
        payload["start"] = (base + timedelta(days=int(iv["min_days"]))).isoformat()
        payload["end"] = (base + timedelta(days=int(iv["max_days"]))).isoformat()
        payload["median"] = (base + timedelta(days=round(float(iv["median_days"])))).isoformat()
        payload["supporting_projects"] = iv["projects"]
        prev = _as_date(previous_start)
        if prev is not None:
            payload["shift_months_nearer"] = round((prev - date.fromisoformat(payload["start"])).days / DAYS_PER_MONTH, 1)
    return payload


def forecast_after_stage(conn: psycopg.Connection, stage_event: dict) -> dict | None:
    """After a ProjectStageChanged event is written by an approval: write the forecast (policy automatic)."""
    from services.governance.proposals import create_proposal

    project_id = stage_event["stream_id"]
    project = conn.execute("SELECT forecast_start, forecast_detail FROM proj_project WHERE id = %s", (project_id,)).fetchone()
    previous = project["forecast_start"] if project else None
    base = stage_event.get("occurred_at") or stage_event["recorded_at"]
    payload = calculate(stage_event["payload"]["to_stage"], base, previous)
    if payload is None:
        return None
    payload["stage_event_id"] = stage_event["id"]
    row, created = create_proposal(
        conn, kind="ProcurementWindowForecast", title=f"Procurement window: {project_id}",
        events=[{"stream_type": "project", "stream_id": project_id, "event_type": "ProcurementWindowForecast",
                 "payload": payload, "evidence_ids": list(stage_event["evidence_ids"]), "certainty": stage_event["certainty"],
                 "occurred_at": base}],
        created_by_type="agent", created_by=AGENT, model_id=model_id(), prompt_version=prompt_version(),
        brief_version_id=stage_event.get("brief_version_id"), idempotency_key=f"forecast:{stage_event['id']}",
    )
    if created:
        log(logger, logging.INFO, "forecast after approved stage", project_id=project_id, stage=payload["current_stage"])
    return row
