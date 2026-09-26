"""M6 follow-up steps after the governance service writes events (services/enrichment/followups.py).

- Window forecaster: each ProjectStageChanged gets a fresh ProcurementWindowForecast, and a forecast that moves six
  months nearer or more raises the Tier 0 alert (docs/05 tier defaults, config/tiers.yaml).
- Opportunities from projects: one diesel supply DealIdentified proposal for each project, always review.
- Demand estimator: a DemandEstimated proposal when each input of a formula has a fact with evidence (docs/03).
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from services.governance.proposals import approve

from .enrichment_support import enrich_text
from .m6_support import approve_opportunity, assert_fact, change_stage, new_project, pending, today

pytestmark = pytest.mark.db


def _forecasts(conn, project_id: str) -> list[dict]:
    return conn.execute("SELECT * FROM event WHERE stream_type = 'project' AND stream_id = %s "
                        "AND event_type = 'ProcurementWindowForecast' ORDER BY sequence", (project_id,)).fetchall()


def _stage_changes(conn, project_id: str) -> list[dict]:
    return conn.execute("SELECT * FROM event WHERE stream_type = 'project' AND stream_id = %s "
                        "AND event_type = 'ProjectStageChanged' ORDER BY sequence", (project_id,)).fetchall()


# ---------- window forecaster and lifecycle agent ----------


def test_every_project_stage_change_gets_a_fresh_forecast(edb):
    p = new_project(edb, "Forecast Test Copper Project", "feasibility")
    change_stage(edb, p["id"], "Forecast Test Copper Project", "financing_fid")
    change_stage(edb, p["id"], "Forecast Test Copper Project", "construction_mobilisation")
    edb.commit()
    stages = _stage_changes(edb, p["id"])
    forecasts = _forecasts(edb, p["id"])
    assert len(stages) == 3 and len(forecasts) == 3
    # Each forecast cites its stage change and the evidence of that stage change.
    for stage, forecast in zip(stages, forecasts, strict=True):
        assert forecast["payload"]["stage_event_id"] == stage["id"]
        assert forecast["payload"]["current_stage"] == stage["payload"]["to_stage"]
        assert forecast["evidence_ids"] == stage["evidence_ids"]
    # Construction comes after contractor procurement: the forecast shows the stage only, with no old window.
    last = forecasts[-1]["payload"]
    assert last["procurement_reached"] is True and last["start"] is None and last["stage_only"] is True
    project = edb.execute("SELECT * FROM proj_project WHERE id = %s", (p["id"],)).fetchone()
    assert project["stage"] == "construction_mobilisation"
    assert project["forecast_start"] is None and project["forecast_detail"]["stage_event_id"] == stages[-1]["id"]


def test_a_reviewed_stage_change_gets_its_forecast_after_the_approval(edb):
    p = new_project(edb, "Reviewed Stage Nickel Project", "feasibility", certainty="stated")
    from .m6_support import AGENT, evidence

    text = "Reviewed Stage Nickel Project reportedly reached financial close."
    ev = evidence(edb, text)
    from services.governance.proposals import create_proposal

    row, _ = create_proposal(edb, kind="ProjectStageChanged", title="stage", events=[
        {"stream_type": "project", "stream_id": p["id"], "event_type": "ProjectStageChanged",
         "payload": {"to_stage": "financing_fid"}, "evidence_ids": [ev], "certainty": "reported"}], **AGENT)
    assert row["status"] == "pending"
    assert len(_forecasts(edb, p["id"])) == 1
    approve(edb, row["id"], "u-approver")
    edb.commit()
    forecasts = _forecasts(edb, p["id"])
    assert len(forecasts) == 2 and forecasts[-1]["payload"]["current_stage"] == "financing_fid"
    assert forecasts[-1]["payload"]["start"] is not None  # five projects support financing_fid -> procurement


def test_a_forecast_that_moves_six_months_nearer_raises_the_tier0_alert(edb):
    later = today() + timedelta(days=400)
    p = new_project(edb, "Shift Test Gold Project", "feasibility", occurred_at=later)
    first = _forecasts(edb, p["id"])[0]["payload"]
    assert first["start"] is not None
    # A later report dates the financing close earlier: the procurement start moves about 13 months nearer.
    change_stage(edb, p["id"], "Shift Test Gold Project", "financing_fid", occurred_at=today())
    edb.commit()
    second = _forecasts(edb, p["id"])[-1]["payload"]
    assert second["shift_months_nearer"] >= 6
    alerts = edb.execute("SELECT * FROM proj_alert WHERE tier_rule = 't0_forecast_moves_nearer' AND stream_id = %s",
                         (p["id"],)).fetchall()
    assert len(alerts) == 1 and alerts[0]["tier"] == 0 and alerts[0]["status"] == "unconfirmed"
    assert alerts[0]["stream_type"] == "project" and alerts[0]["evidence_ids"]


def test_a_forecast_that_moves_less_than_six_months_raises_no_alert(edb):
    base = today() + timedelta(days=60)
    p = new_project(edb, "Small Shift Zinc Project", "feasibility", occurred_at=base)
    change_stage(edb, p["id"], "Small Shift Zinc Project", "financing_fid", occurred_at=today())
    edb.commit()
    assert _forecasts(edb, p["id"])[-1]["payload"]["shift_months_nearer"] < 6
    assert edb.execute("SELECT count(*) AS n FROM proj_alert WHERE stream_id = %s", (p["id"],)).fetchone()["n"] == 0


def test_scenario_16_still_gives_eia_filed_tier0_calendar_entry_and_an_opportunity(api, tokens, edb):
    text = ("Public notice: Environmental Impact Statement for the proposed Mwinilunga West Copper Project\n\n"
            "The Zambia Environmental Management Agency (ZEMA) gives notice that the developer of the proposed Mwinilunga "
            "West Copper Project in Mwinilunga district, North-Western Province, has submitted an Environmental Impact "
            "Statement (EIS) for review. The project includes an open pit mine and a concentrator.")
    source, result = enrich_text(edb, text, source_type="web", publisher="ZEMA (synthetic)")
    assert result["tier"] == 0 and result["tier_rule"] == "t0_new_project_first_trace"
    project = edb.execute("SELECT * FROM proj_project WHERE name = 'Mwinilunga West Copper Project'").fetchone()
    assert project["stage"] == "eia_filed" and project["forecast_detail"]["stage_event_id"] == project["stage_event_id"]
    calendar = api.get("/api/calendar", params={"months": 24}, headers=tokens("viewer")).json()
    item = next(i for i in calendar["items"] if i["id"] == project["id"])
    assert item["stage"] == "eia_filed" and item["stage_evidence_ids"] and item["stage_event_id"]
    detail = item["forecast_detail"]
    assert detail["intervals"] and detail["evidence_ids"] and detail["start"] is None
    for iv in detail["intervals"]:
        assert {"from", "to", "median_days", "n_projects", "projects"} <= set(iv)
    # The project gets one diesel supply opportunity for review. A second run gives no second proposal.
    [opp] = pending(edb, "DealIdentified", project_id=project["id"])
    payload = opp["events"][0]["payload"]
    assert payload["title"] == "Diesel supply for Mwinilunga West Copper Project"
    assert payload["deal_type"] == "fuel_supply_contract" and opp["policy"] == "review"
    assert opp["events"][0]["evidence_ids"] == list(project["stage_evidence_ids"])
    enrich_text(edb, text, source_type="web", publisher="ZEMA (synthetic)", url="https://synthetic.test/zema/again")
    assert len(pending(edb, "DealIdentified", project_id=project["id"])) == 1
    edb.commit()


def test_calendar_shows_the_dated_window_with_intervals_supporting_projects_and_evidence(api, tokens, edb):
    p = new_project(edb, "Calendar Window Cobalt Project", "financing_fid")
    edb.commit()
    item = next(i for i in api.get("/api/calendar", headers=tokens("viewer")).json()["items"] if i["id"] == p["id"])
    assert item["forecast_start"] and item["forecast_end"]
    detail = item["forecast_detail"]
    assert detail["supporting_projects"] and len(detail["supporting_projects"]) >= 5
    assert detail["intervals"][0]["projects"] == detail["supporting_projects"]
    assert detail["evidence_ids"] == [p["evidence_id"]] and detail["event_id"]


# ---------- opportunities from projects ----------


def test_project_opportunity_is_proposed_once_for_review_and_approval_gives_a_deal(api, tokens, edb):
    p = new_project(edb, "Opportunity Test Copper Project", "feasibility")
    change_stage(edb, p["id"], "Opportunity Test Copper Project", "environmental_approval")
    edb.commit()
    rows = pending(edb, "DealIdentified", project_id=p["id"])
    assert len(rows) == 1
    assert rows[0]["created_by_type"] == "agent" and rows[0]["model_id"] and rows[0]["prompt_version"]
    deal_id = approve_opportunity(edb, p["id"])
    edb.commit()
    deal = next(d for d in api.get("/api/deals", headers=tokens("viewer")).json()["items"] if d["id"] == deal_id)
    assert deal["project_id"] == p["id"] and deal["deal_type"] == "fuel_supply_contract" and deal["stage"] == "signal"
    assert deal["evidence_ids"] and deal["stage_event_id"] and deal["stage_evidence_ids"] == deal["evidence_ids"]
    item = next(i for i in api.get("/api/priority", headers=tokens("viewer")).json()["items"] if i["id"] == deal_id)
    assert item["priority_breakdown"]["parts"] and item["priority_score"] is not None
    rel = api.get(f"/api/deals/{deal_id}/relationship", headers=tokens("viewer"))
    assert rel.status_code == 200
    # A new stage of the same project gives no second opportunity.
    change_stage(edb, p["id"], "Opportunity Test Copper Project", "licence_granted")
    assert pending(edb, "DealIdentified", project_id=p["id"]) == []


def test_no_opportunity_for_a_project_first_seen_after_contractor_procurement(edb):
    p = new_project(edb, "Late Trace Steady Mine Project", "steady_operation")
    edb.commit()
    assert pending(edb, "DealIdentified", project_id=p["id"]) == []


def test_no_second_fuel_supply_opportunity_when_the_document_gives_one(edb):
    text = ("Kalumbila East Copper Project invites bids for diesel supply\n\n"
            "The developer of the Kalumbila East Copper Project invites sealed bids from licensed oil marketing companies "
            "for the supply of diesel to the project. The closing date for bids is 15 October 2026.")
    enrich_text(edb, text, source_type="web")
    project = edb.execute("SELECT id FROM proj_project WHERE name ILIKE 'Kalumbila East Copper Project'").fetchone()
    if project is None:
        pytest.skip("the rules gave no project for this text")
    deals = pending(edb, "DealIdentified", project_id=project["id"])
    assert len([d for d in deals if d["events"][0]["payload"]["deal_type"] == "fuel_supply_contract"]) <= 1
    edb.commit()


# ---------- demand estimator ----------


def test_demand_estimate_from_facts_with_evidence_goes_to_review_with_formula_inputs_and_evidence(api, tokens, edb):
    p = new_project(edb, "Demand Test Copper Project", "feasibility")
    # A fact that is no input of a formula gives no estimate.
    assert_fact(edb, "project", p["id"], "capex", "180000000 USD", "The capital cost is US$180 million.", "US$180 million")
    assert pending(edb, "DemandEstimated") == [] or all(
        r["stream_id"] != p["id"] for r in pending(edb, "DemandEstimated"))
    ev = assert_fact(edb, "project", p["id"], "fleet_trucks", "40", "The mine plan uses a fleet of 40 haul trucks.",
                     "40 haul trucks")
    edb.commit()
    [row] = [r for r in pending(edb, "DemandEstimated") if r["stream_id"] == p["id"]]
    assert row["policy"] == "review" and row["created_by_type"] == "agent"
    event = row["events"][0]
    payload = event["payload"]
    assert payload["label"] == "estimate" and payload["formula_id"] == "haul_fleet"
    assert payload["expression"] == "trucks * litres_per_truck_hour * operating_hours_per_month"
    assert payload["factors"] == {"litres_per_truck_hour": 90, "operating_hours_per_month": 500}
    assert payload["inputs"]["trucks"]["value"] == 40 and payload["inputs"]["trucks"]["evidence_ids"] == [ev]
    assert payload["value"] == 40 * 90 * 500 and payload["unit"] == "litres_per_month"
    assert event["evidence_ids"] == [ev]
    approve(edb, row["id"], "u-approver")
    edb.commit()
    project = api.get(f"/api/projects/{p['id']}", headers=tokens("viewer")).json()["project"]
    assert project["demand_estimate"]["value"] == 1800000 and project["demand_estimate"]["inputs"]["trucks"]["evidence_ids"]
    # The same facts give no second proposal.
    from services.enrichment import demand

    assert demand.propose(edb, "project", p["id"]) is None


def test_no_demand_estimate_when_an_input_has_no_evidence(edb):
    from services.enrichment import demand

    p = new_project(edb, "No Evidence Demand Project", "feasibility")
    # "2500000 t" is not a quantity per year: the input of ore_tonnage has no fact with evidence.
    assert_fact(edb, "project", p["id"], "tonnes_moved_per_year", "2500000 t", "It will move 2.5 million tonnes.",
                "2.5 million tonnes")
    edb.commit()
    assert demand.estimate(edb, [("project", p["id"])]) is None
    assert [r for r in pending(edb, "DemandEstimated") if r["stream_id"] == p["id"]] == []


def test_a_project_takes_the_input_from_its_site_and_the_site_gets_its_own_estimate(edb):
    from .enrichment_support import site_id

    site = site_id(edb, "kansanshi")
    p = new_project(edb, "Site Input Expansion Project", "feasibility", site_id=site)
    ev = assert_fact(edb, "entity", site, "generation_mw", "20", "The mine has 20 MW of standby diesel generation.",
                     "20 MW")
    edb.commit()
    rows = {r["stream_id"]: r for r in pending(edb, "DemandEstimated")}
    assert p["id"] in rows and site in rows
    inp = rows[p["id"]]["events"][0]["payload"]["inputs"]["megawatts"]
    assert inp["subject_type"] == "entity" and inp["subject_id"] == site and inp["evidence_ids"] == [ev]
    assert rows[p["id"]]["events"][0]["payload"]["value"] == round(20 * 270 * 730 * 0.6, 1)


def test_formula_evaluator_allows_arithmetic_only():
    from services.enrichment import demand

    assert demand.evaluate("a * b / 12", {"a": 12, "b": 2}) == 2
    for bad in ("__import__('os')", "a ** 2", "a if a else b", "open('x')"):
        with pytest.raises((demand.FormulaError, SyntaxError)):
            demand.evaluate(bad, {"a": 1, "b": 2})
    assert demand.parse_value("2500000 t/y", ["t/y"]) == 2500000
    assert demand.parse_value("2500000 t", ["t/y"]) is None
    assert demand.parse_value("40", [""]) == 40


def test_followups_leave_the_hash_chain_and_the_evidence_check_clean(edb):
    assert edb.execute("SELECT count(*) AS n FROM check_hash_chain()").fetchone()["n"] == 0
    assert edb.execute("SELECT count_facts_without_verified_evidence() AS n").fetchone()["n"] == 0
