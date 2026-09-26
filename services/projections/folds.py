"""Pure functions that calculate the state of one stream from its events.

The projector uses them to write the read models. The API uses them for `as_of` reads.
Each function uses event data only, so a rebuild gives the same result.
"""

from __future__ import annotations

import unicodedata
from typing import Any

from services.common import config


def normalise_name(name: str) -> str:
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii").lower()
    for token in (" limited", " ltd", " plc", " inc", " corporation", " corp", " company", " co.", " sa", " llc", ".", ",", "(", ")"):
        text = text.replace(token, " ")
    return " ".join(text.split())


def _ts(event: dict) -> Any:
    return event["recorded_at"]


def fold_entity(events: list[dict]) -> dict | None:
    state: dict | None = None
    for ev in events:
        p = ev["payload"]
        t = ev["event_type"]
        if t == "EntityIdentified":
            if state is None:
                state = {
                    "id": ev["stream_id"], "type": p["entity_type"], "name": p["name"],
                    "aliases": list(p.get("aliases") or []), "site_class": p.get("site_class"),
                    "watch": p.get("watch") or "none", "status": None, "status_pending": None,
                    "operator_id": None, "district": p.get("district"), "province": p.get("province"),
                    "country": p.get("country"), "attributes": {}, "merged_into": None,
                    "last_signal_at": None, "identity_evidence_ids": list(ev["evidence_ids"]),
                    "status_event_id": None, "status_evidence_ids": [], "status_certainty": None,
                    "demand_estimate": None,
                }
            else:
                for alias in [p["name"], *(p.get("aliases") or [])]:
                    if alias != state["name"] and alias not in state["aliases"]:
                        state["aliases"].append(alias)
        if state is None:
            continue
        if t == "EntityAttributeAsserted":
            state["attributes"][p["predicate"]] = {
                "value": p["value"], "event_id": ev["id"], "certainty": ev["certainty"],
                "evidence_ids": list(ev["evidence_ids"]),
            }
            if p["predicate"] == "operates" or p["predicate"] == "operator":
                state["operator_id"] = p["value"] if isinstance(p["value"], str) else state["operator_id"]
        elif t == "ClaimRetracted":
            for key, attr in list(state["attributes"].items()):
                if attr["event_id"] == p["event_id"]:
                    del state["attributes"][key]
        elif t == "SiteStatusChanged":
            state["status"] = p["to_status"]
            state["status_pending"] = None
            # The provenance of the status (docs/07 rule 1): the event and its evidence.
            state["status_event_id"] = ev["id"]
            state["status_evidence_ids"] = list(ev["evidence_ids"])
            state["status_certainty"] = ev["certainty"]
        elif t == "DemandEstimated":
            state["demand_estimate"] = {**p, "event_id": ev["id"], "evidence_ids": list(ev["evidence_ids"])}
        elif t == "EntityMerged" and ev["stream_id"] in p["merged_ids"] and p["into_id"] != ev["stream_id"]:
            state["merged_into"] = p["into_id"]
        elif t == "SignalScored":
            state["last_signal_at"] = p.get("published_at") or _ts(ev)
        state["last_event_id"] = ev["id"]
        state["updated_at"] = _ts(ev)
    if state is not None:
        state["normalised_name"] = normalise_name(state["name"])
    return state


def fold_deal(events: list[dict]) -> dict | None:
    state: dict | None = None
    for ev in events:
        p = ev["payload"]
        t = ev["event_type"]
        if t == "DealIdentified" and state is None:
            state = {
                "id": ev["stream_id"], "title": p["title"], "deal_type": p.get("deal_type"),
                "stage": p.get("stage") or config.stage_codes()[0], "stage_pending": None,
                "pending_proposal_id": None, "site_id": p.get("site_id"), "project_id": p.get("project_id"),
                "organisation_id": p.get("organisation_id"), "has_contact": False,
                "prequalification_status": None, "next_action": None, "attributes": {},
                "evidence_ids": list(ev["evidence_ids"]), "created_at": _ts(ev), "touchpoints": 0,
                "stage_history": [], "certainty": ev["certainty"],
                # The provenance of the stage (docs/07 rule 1). The first stage comes from DealIdentified.
                "stage_event_id": ev["id"], "stage_evidence_ids": list(ev["evidence_ids"]), "stage_reason": None,
                "stage_actor_type": ev["actor_type"],
            }
        if state is None:
            continue
        if t == "DealStageChanged":
            state["stage_history"].append({"from": state["stage"], "to": p["to_stage"], "event_id": ev["id"], "at": _ts(ev)})
            state["stage"] = p["to_stage"]
            state["stage_pending"] = None
            state["pending_proposal_id"] = None
            state["stage_event_id"] = ev["id"]
            state["stage_evidence_ids"] = list(ev["evidence_ids"])
            state["stage_reason"] = p.get("reason")
            state["stage_actor_type"] = ev["actor_type"]
        elif t == "DealAttributeAsserted":
            state["attributes"][p["predicate"]] = {"value": p["value"], "event_id": ev["id"], "evidence_ids": list(ev["evidence_ids"])}
        elif t == "ContactAdded":
            state["has_contact"] = True
        elif t == "TouchpointLogged":
            state["touchpoints"] += 1
        elif t == "NextActionSet":
            state["next_action"] = {"action": p["action"], "owner_user_id": p["owner_user_id"], "due_date": p["due_date"], "event_id": ev["id"]}
        elif t == "PrequalificationStatusChanged":
            state["prequalification_status"] = p["status"]
        state["updated_at"] = _ts(ev)
    return state


def _stage_order(code: str | None) -> int | None:
    if code is None:
        return None
    for s in config.lifecycle()["stages"]:
        if s["code"] == code:
            return s["order"]
    return None


def in_engagement_window(stage: str | None) -> bool:
    lc = config.lifecycle()
    order = _stage_order(stage)
    lo, hi = _stage_order(lc["engagement_window"]["from"]), _stage_order(lc["engagement_window"]["to"])
    return order is not None and lo is not None and hi is not None and lo <= order <= hi


def fold_project(events: list[dict]) -> dict | None:
    state: dict | None = None
    for ev in events:
        p = ev["payload"]
        t = ev["event_type"]
        if state is None and t in ("EntityIdentified", "ProjectStageChanged"):
            state = {
                "id": ev["stream_id"], "name": p.get("name") or ev["stream_id"], "site_id": p.get("site_id"),
                "project_type": p.get("project_type"), "sector": p.get("sector"), "stage": None, "stage_order": None,
                "stage_evidence_ids": [], "stage_certainty": None, "stage_changed_at": None,
                "in_engagement_window": False, "first_trace_at": ev.get("occurred_at") or _ts(ev),
                "forecast_start": None, "forecast_end": None, "forecast_detail": None, "demand_estimate": None,
                "stage_history": [], "stage_event_id": None,
            }
        if state is None:
            continue
        if t == "EntityIdentified":
            state["name"] = p.get("name") or state["name"]
        elif t == "ProjectStageChanged":
            state["stage_history"].append({"from": state["stage"], "to": p["to_stage"], "event_id": ev["id"], "at": _ts(ev)})
            state["stage"] = p["to_stage"]
            state["stage_order"] = _stage_order(p["to_stage"])
            state["stage_evidence_ids"] = list(ev["evidence_ids"])
            state["stage_certainty"] = ev["certainty"]
            state["stage_changed_at"] = ev.get("occurred_at") or _ts(ev)
            state["in_engagement_window"] = in_engagement_window(p["to_stage"])
            state["stage_event_id"] = ev["id"]
            if p.get("site_id"):
                state["site_id"] = p["site_id"]
            # The forecast of the old stage is out of date. The window forecaster writes a fresh forecast for the
            # new stage (services/enrichment/followups.py), so the calendar never shows a window of an old stage.
            state["forecast_start"] = state["forecast_end"] = state["forecast_detail"] = None
        elif t == "ProcurementWindowForecast":
            state["forecast_start"] = p.get("start")
            state["forecast_end"] = p.get("end")
            state["forecast_detail"] = {**p, "event_id": ev["id"], "evidence_ids": list(ev["evidence_ids"])}
        elif t == "DemandEstimated":
            state["demand_estimate"] = {**p, "event_id": ev["id"], "evidence_ids": list(ev["evidence_ids"])}
        state["updated_at"] = _ts(ev)
    return state


def fold_alert(events: list[dict]) -> dict | None:
    state: dict | None = None
    for ev in events:
        p = ev["payload"]
        t = ev["event_type"]
        if t == "AlertRaised" and state is None:
            state = {
                "id": ev["stream_id"], "tier": p["tier"], "tier_rule": p["tier_rule"], "title": p["title"],
                "status": "unconfirmed", "stream_type": p.get("related_stream_type"),
                "stream_id": p.get("related_stream_id"), "signal_id": p.get("signal_id"),
                "source_id": p.get("source_id"), "evidence_ids": list(ev["evidence_ids"]),
                "published_at": p.get("published_at"), "fetched_at": p.get("fetched_at"), "raised_at": _ts(ev),
                "acknowledged_at": None, "acknowledged_by": None, "decided_at": None, "decided_by": None,
                "decision_reason": None,
            }
        if state is None:
            continue
        if t == "AlertAcknowledged" and state["acknowledged_at"] is None:
            state["acknowledged_at"] = _ts(ev)
            state["acknowledged_by"] = ev["actor_id"]
        elif t == "AlertConfirmed":
            state.update(status="confirmed", decided_at=_ts(ev), decided_by=ev["actor_id"], decision_reason=p.get("reason"))
        elif t == "AlertDismissed":
            state.update(
                status="false_positive" if p.get("false_positive") else "dismissed",
                decided_at=_ts(ev), decided_by=ev["actor_id"], decision_reason=p.get("reason"),
            )
        state["updated_at"] = _ts(ev)
    return state


FOLDS = {"entity": fold_entity, "deal": fold_deal, "project": fold_project, "alert": fold_alert}
