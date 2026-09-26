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


def no_window(stage: str, base_date: date | datetime | str | None) -> dict:
    """The forecast payload for a stage that has no procurement window to forecast: contractor procurement has
    started or passed, or the stage has no interval (for example a restart stage). The forecast shows the stage
    only, so that the calendar never keeps the window of an old stage (M6)."""
    lc = common_config.lifecycle()
    target = lc["procurement_stage"]
    base = _as_date(base_date) or date.today()
    main = [s["code"] for s in lc["stages"]]
    restart = [s["code"] for s in lc.get("restart_path") or []]
    if stage in main and target in main and stage != "care_maintenance_suspension_closure":
        reached = main.index(stage) >= main.index(target)
    else:
        reached = stage in restart and target in restart and restart.index(stage) >= restart.index(target)
    return {
        "current_stage": stage, "procurement_stage": target, "base_date": base.isoformat(),
        "min_projects_per_interval": int(lc.get("min_projects_per_interval", 5)), "intervals": [],
        "intervals_source": lc.get("intervals_file"), "start": None, "end": None, "median": None, "stage_only": True,
        "supporting_projects": [], "shift_months_nearer": None, "procurement_reached": reached,
    }


def previous_start(conn: psycopg.Connection, project_id: str) -> date | None:
    """The start of the last forecast of a project. The stage change clears the forecast of the projection
    (services/projections/folds.py), so the forecaster reads the last ProcurementWindowForecast event."""
    row = conn.execute(
        "SELECT payload->>'start' AS start FROM event WHERE stream_type = 'project' AND stream_id = %s "
        "AND event_type = 'ProcurementWindowForecast' AND payload->>'start' IS NOT NULL ORDER BY sequence DESC LIMIT 1",
        (project_id,),
    ).fetchone()
    return _as_date(row["start"]) if row else None


def shift_threshold_months() -> float | None:
    """The threshold of the Tier 0 rule "a forecast procurement start that moves six months nearer or more"."""
    rule = (common_config.tiers().get("feature_thresholds") or {}).get("forecast_shift_months_nearer_gte_6") or {}
    return float(rule["min"]) if "min" in rule else None


def forecast_after_stage(conn: psycopg.Connection, stage_event: dict) -> dict | None:
    """After a ProjectStageChanged event is written (automatic or approved): write a fresh forecast (policy automatic).

    Every stage change gets a forecast. A stage without a window gets a forecast that shows the stage only. When the
    new start moves nearer by the threshold of config/tiers.yaml or more, the forecast raises the Tier 0 alert
    "forecast moves nearer" for the source of the stage evidence (one alert for each source and rule).
    """
    from services.governance.proposals import create_proposal

    project_id = stage_event["stream_id"]
    project = conn.execute("SELECT name FROM proj_project WHERE id = %s", (project_id,)).fetchone()
    name = project["name"] if project else project_id
    previous = previous_start(conn, project_id)
    base = stage_event.get("occurred_at") or stage_event["recorded_at"]
    stage = stage_event["payload"]["to_stage"]
    payload = calculate(stage, base, previous) or no_window(stage, base)
    payload["stage_event_id"] = stage_event["id"]
    row, created = create_proposal(
        conn, kind="ProcurementWindowForecast", title=f"Procurement window: {name}",
        events=[{"stream_type": "project", "stream_id": project_id, "event_type": "ProcurementWindowForecast",
                 "payload": payload, "evidence_ids": list(stage_event["evidence_ids"]), "certainty": stage_event["certainty"],
                 "occurred_at": base}],
        created_by_type="agent", created_by=AGENT, model_id=model_id(), prompt_version=prompt_version(),
        brief_version_id=stage_event.get("brief_version_id"), idempotency_key=f"forecast:{stage_event['id']}",
    )
    if created:
        log(logger, logging.INFO, "forecast after stage change", project_id=project_id, stage=payload["current_stage"],
            start=payload["start"], shift_months_nearer=payload["shift_months_nearer"])
        _alert_on_shift(conn, stage_event, payload, name)
    return row


def _alert_on_shift(conn: psycopg.Connection, stage_event: dict, payload: dict, name: str) -> None:
    threshold = shift_threshold_months()
    shift = payload.get("shift_months_nearer")
    if threshold is None or shift is None or shift < threshold or not stage_event["evidence_ids"]:
        return
    from services.governance.alerts import raise_alert

    source = conn.execute(
        "SELECT s.* FROM evidence v JOIN source s ON s.id = v.source_id WHERE v.id = ANY(%s) ORDER BY v.id LIMIT 1",
        (list(stage_event["evidence_ids"]),),
    ).fetchone()
    if source is None:
        return
    rule = next((r["id"] for t in common_config.tiers()["tiers"] if t["tier"] == 0 for r in t["rules"]
                 if "forecast_shift_months_nearer_gte_6" in (r.get("all") or {})), None)
    if rule is None:
        return
    raise_alert(conn, source=source, tier=0, tier_rule=rule,
                title=f"{name}: procurement forecast moved {shift} months nearer", evidence_ids=list(stage_event["evidence_ids"]),
                signal_id=source["id"], related_stream_type="project", related_stream_id=stage_event["stream_id"],
                brief_version_id=stage_event.get("brief_version_id"))
