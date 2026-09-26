"""Follow-up steps after the governance service writes events to the record (M6).

services/governance/proposals.py calls after_write() for each written batch: an automatic proposal, an
approval and an edit and approve. The steps only propose. They never write events directly.

1. Window forecaster: each ProjectStageChanged gets a fresh ProcurementWindowForecast (policy automatic).
   A forecast that moves six months nearer or more raises the Tier 0 alert (config/tiers.yaml).
2. Opportunities from projects: a project that is first identified, or reaches a stage up to contractor
   procurement, gets one diesel supply opportunity proposal (policy review, config/priority.yaml).
3. Demand estimator: a project, or a site, with facts for the inputs of a formula gets a DemandEstimated
   proposal (policy review, config/demand-model.yaml).
"""

from __future__ import annotations

import psycopg

from . import demand, forecaster, opportunities

_PROJECT_EVENTS = ("EntityIdentified", "ProjectStageChanged")


def after_write(conn: psycopg.Connection, written: list[dict]) -> None:
    projects: dict[str, str | None] = {}
    demand_subjects: dict[tuple[str, str], str | None] = {}
    predicates = demand.input_predicates()
    for row in written:
        t, stream_type, stream_id = row["event_type"], row["stream_type"], row["stream_id"]
        if t == "ProjectStageChanged":
            forecaster.forecast_after_stage(conn, row)
        if stream_type == "project" and t in _PROJECT_EVENTS:
            projects[stream_id] = row.get("brief_version_id")
            demand_subjects[("project", stream_id)] = row.get("brief_version_id")
        if t == "EntityAttributeAsserted" and row["payload"].get("predicate") in predicates:
            demand_subjects[(stream_type, stream_id)] = row.get("brief_version_id")
            if stream_type == "entity":
                for p in conn.execute("SELECT id FROM proj_project WHERE site_id = %s ORDER BY id", (stream_id,)).fetchall():
                    demand_subjects[("project", p["id"])] = row.get("brief_version_id")
    for project_id, brief_version_id in projects.items():
        opportunities.propose_for_project(conn, project_id, brief_version_id=brief_version_id)
    for (stream_type, stream_id), brief_version_id in demand_subjects.items():
        if stream_type in ("project", "entity"):
            demand.propose(conn, stream_type, stream_id, brief_version_id=brief_version_id)
