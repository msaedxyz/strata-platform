"""Opportunities from projects (M6). Source: docs/05-enrichment.md (scorer rule 5) and docs/03-data-model.md (buyers).

When the record gets a project (EntityIdentified) or a project reaches a lifecycle stage up to the stage of
config/priority.yaml project_opportunity.max_stage, this step proposes one DealIdentified opportunity for the
diesel supply of the project. The deal links to the project and its site, and cites the evidence of the project.
The proposal always goes to review (config/approval-policy.yaml DealIdentified: review), once for each project
(idempotency key). An approver decides it, and then the priority list, the Kanban board and the relationship
panel show the opportunity.

The step runs after the governance service writes the project events (services/enrichment/followups.py), so the
opportunity never refers to a project that is not in the record. A model does not produce the proposal.
"""

from __future__ import annotations

import logging

import psycopg

from services.common import config as common_config
from services.common.ids import new_id
from services.common.logging import log

logger = logging.getLogger("strata.enrichment.opportunities")
AGENT = "opportunity_proposer"


def rule() -> dict:
    return common_config.priority().get("project_opportunity") or {}


def model_id() -> str:
    return str(common_config.models()["agents"].get(AGENT, {}).get("model") or "none")


def prompt_version() -> str:
    return f"priority-config:{common_config.priority().get('version', 'unknown')}"


def stage_allows(stage: str | None, max_stage: str | None) -> bool:
    """True for an unknown stage, or a stage at or before max_stage. A restart stage uses the restart path order."""
    if stage is None or not max_stage:
        return True
    lc = common_config.lifecycle()
    main = [s["code"] for s in lc["stages"]]
    restart = [s["code"] for s in lc.get("restart_path") or []]
    if stage in main and max_stage in main:
        return main.index(stage) <= main.index(max_stage)
    if stage in restart and max_stage in restart:
        return restart.index(stage) <= restart.index(max_stage)
    return False


def _project_evidence(conn: psycopg.Connection, project: dict) -> tuple[list[str], str | None]:
    """The evidence of the current stage of the project, else the evidence of its identity."""
    if project["stage_evidence_ids"]:
        return list(project["stage_evidence_ids"]), project["stage_certainty"]
    first = conn.execute(
        "SELECT evidence_ids, certainty FROM event WHERE stream_type = 'project' AND stream_id = %s "
        "AND cardinality(evidence_ids) > 0 ORDER BY sequence LIMIT 1",
        (project["id"],),
    ).fetchone()
    return (list(first["evidence_ids"]), first["certainty"]) if first else ([], None)


def _has_open_deal(conn: psycopg.Connection, project_id: str, deal_types: list[str]) -> bool:
    if not deal_types:
        return False
    terminal = [s["code"] for s in common_config.stages() if s.get("terminal")]
    found = conn.execute(
        "SELECT 1 FROM proj_deal WHERE project_id = %s AND deal_type = ANY(%s) AND NOT (stage = ANY(%s)) LIMIT 1",
        (project_id, deal_types, terminal),
    ).fetchone()
    if found:
        return True
    return conn.execute(
        "SELECT 1 FROM proposal p, jsonb_array_elements(p.events) e WHERE p.status = 'pending' "
        "AND e->>'event_type' = 'DealIdentified' AND e->'payload'->>'project_id' = %s "
        "AND e->'payload'->>'deal_type' = ANY(%s) LIMIT 1",
        (project_id, deal_types),
    ).fetchone() is not None


def propose_for_project(conn: psycopg.Connection, project_id: str, *, brief_version_id: str | None = None) -> dict | None:
    """Propose the diesel supply opportunity of one project. Returns the proposal row, or None. The caller commits."""
    from services.governance.proposals import create_proposal, find_by_key

    r = rule()
    if not r.get("enabled", True):
        return None
    key = f"project-opportunity:{project_id}"
    if find_by_key(conn, key):
        return None
    project = conn.execute("SELECT * FROM proj_project WHERE id = %s", (project_id,)).fetchone()
    if project is None or not stage_allows(project["stage"], r.get("max_stage")):
        return None
    if _has_open_deal(conn, project_id, list(r.get("skip_if_deal_types") or [])):
        return None
    evidence_ids, certainty = _project_evidence(conn, project)
    if not evidence_ids:
        return None  # a DealIdentified event needs evidence (docs/03)
    owner = conn.execute(
        "SELECT object_id FROM proj_relationship WHERE subject_id = %s AND predicate = 'buyer_role_owner' "
        "AND superseded_by IS NULL ORDER BY recorded_at DESC, event_id DESC LIMIT 1",
        (project_id,),
    ).fetchone()
    source = conn.execute("SELECT source_id FROM evidence WHERE id = %s", (evidence_ids[0],)).fetchone()
    first_stage = common_config.stage_codes()[0]
    title = str(r.get("title", "Diesel supply for {project_name}")).format(project_name=project["name"])
    payload = {"title": title, "deal_type": r.get("deal_type", "fuel_supply_contract"), "stage": first_stage,
               "site_id": project["site_id"], "project_id": project_id,
               "organisation_id": owner["object_id"] if owner else None,
               "origin": "project_opportunity", "project_stage": project["stage"]}
    row, created = create_proposal(
        conn, kind="DealIdentified", title=title,
        events=[{"stream_type": "deal", "stream_id": new_id(), "event_type": "DealIdentified", "payload": payload,
                 "evidence_ids": evidence_ids, "certainty": certainty or "stated"}],
        created_by_type="agent", created_by=f"enrichment.{AGENT}", model_id=model_id(), prompt_version=prompt_version(),
        source_id=source["source_id"] if source else None, brief_version_id=brief_version_id, idempotency_key=key,
        force_review=True,
    )
    if created:
        log(logger, logging.INFO, "project opportunity proposed", project_id=project_id, proposal_id=row["id"])
    return row
