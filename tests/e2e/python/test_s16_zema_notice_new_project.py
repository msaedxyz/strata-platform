"""docs/09 scenario 16: a fixture ZEMA notice describes a new mine project. Strata creates a project at the stage
"Environmental assessment filed", raises a Tier 0 alert, and puts it on the procurement calendar.

The notice is tests/fixtures/site/notices/zema-eis-kasempa-north.html, an early signal source (zema_eia) of the
acceptance brief. No brief, snapshot or other fixture names the project, so it is a new project.
"""

from __future__ import annotations

from .stack import wait_for, wait_signal

PROJECT = "Kasempa North Copper Project"


def test_s16_a_zema_notice_of_a_new_mine_project_gives_eia_filed_a_tier0_alert_and_a_calendar_entry(api, acceptance):
    signal = wait_signal(api, "zema-eis-kasempa-north", q="Kasempa North")
    assert signal["tier"] == 0 and signal["tier_rule"] == "t0_new_project_first_trace", signal["tier_rule"]
    stages = {s["code"]: s for s in api.ok("/api/config/stages")["lifecycle_stages"]}
    assert stages["eia_filed"]["name"].lower().startswith("environmental assessment filed")
    project = wait_for(lambda: next((p for p in api.ok("/api/projects")["items"] if p["name"] == PROJECT), None),
                       timeout=60, what=f"the project {PROJECT}")
    assert project["stage"] == "eia_filed" and project["stage_certainty"] == "stated"
    detail = api.ok(f"/api/projects/{project['id']}")["project"]
    assert detail["stage"] == "eia_filed"
    alert = next(a for a in api.alerts(tier=0) if a["source_id"] == signal["source_id"])
    assert alert["stream_type"] == "project" and alert["stream_id"] == project["id"]
    assert alert["status"] == "unconfirmed"
    calendar = api.ok("/api/calendar", months=24)["items"]
    entry = next((c for c in calendar if c["id"] == project["id"]), None)
    assert entry is not None, "the project is not on the procurement calendar"
    assert entry["stage"] == "eia_filed" and entry["forecast_detail"] is not None
    assert entry["forecast_detail"]["current_stage"] == "eia_filed"
