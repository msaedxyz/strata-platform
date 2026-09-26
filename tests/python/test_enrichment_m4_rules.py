"""General rule fixes of M4 (reports/M3.md known risks and the review of the snapshot run).

Each case uses new synthetic text, not the text of a gold or held-out document.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from services.enrichment import rules
from services.enrichment.analysis import Doc, analyse
from services.enrichment.backends import DeterministicBackend
from services.enrichment.entity_index import MemoryIndex, brief_records
from services.enrichment.eval import load_brief
from services.enrichment.runner import AgentRunner

from .enrichment_support import enrich_text, proposals_of, site_id


@pytest.fixture(scope="module")
def brief():
    return load_brief()


def run(text: str, brief: dict, index: MemoryIndex | None = None, source_type: str = "rss"):
    index = index or MemoryIndex(brief_records(brief))
    counter = iter(range(10_000))
    doc = Doc(text=text, title=text.split("\n", 1)[0], source_type=source_type, source_id="m4-test",
              published_at=datetime(2026, 9, 20, tzinfo=UTC), fetched_at=datetime(2026, 9, 21, tzinfo=UTC), brief=brief)
    return analyse(doc, index, AgentRunner(DeterministicBackend()), lambda k, key: f"new:{k}:{key}:{next(counter)}")


def claims(a, predicate: str) -> list[dict]:
    return [c for c in a.claims if c["predicate"] == predicate]


def test_a_plan_in_other_words_is_no_status_or_stage(brief):
    a = run("Sentinel owner eyes new pit\n\nFirst Quantum expects first ore from the Sentinel mine east pit in 2029. "
            "The mine is set for commissioning of a new crusher next year.", brief)
    assert claims(a, "site_status") == []
    assert not any(p.get("stage") for p in a.projects)


def test_trucks_that_waited_with_words_between_are_a_border_delay(brief):
    a = run("Long wait at Chirundu\n\nHeavy goods trucks loaded with sulphuric acid and maize waited for three days at "
            "the Chirundu one-stop border post after a customs system failure.", brief)
    assert "border_delay" in a.classification["themes"]
    assert "transport_infrastructure_project" not in a.classification["themes"]


def test_a_one_stop_border_post_under_construction_is_a_project(brief):
    a = run("Works start on border facilities in Zambia\n\nThe government started construction of the new Mwami "
            "one-stop border post facilities in Chipata, with a contract worth US$25 million.", brief)
    assert "transport_infrastructure_project" in a.classification["themes"]


def test_capital_spending_belongs_to_the_project_that_a_later_sentence_names(brief):
    a = run("Kansanshi owner approves smelter plan\n\nFirst Quantum approved a US$220 million plan at the Kansanshi mine. "
            "The work is the Kansanshi Acid Plant Project, due in 2028.", brief)
    capex = claims(a, "capex")
    assert capex and capex[0]["subject"] == "Kansanshi Acid Plant Project"


def test_a_sale_of_a_stake_is_no_ownership_claim(brief):
    a = run("Owner weighs exit\n\nZCCM Investments Holdings Plc plans the sale of its 20 percent stake in Kansanshi "
            "Mining Plc.", brief)
    assert claims(a, "ownership_percent") == []
    held = run("Shareholding\n\nFirst Quantum owns 80 percent of Kansanshi Mining Plc.", brief)
    assert claims(held, "ownership_percent")


def test_title_words_before_a_project_name_are_not_part_of_the_name(brief):
    a = run("A Look Inside The Kalumbila Township Power Project – Council News", brief, source_type="snapshot")
    assert [p["name"] for p in a.projects] == ["Kalumbila Township Power Project"]


def test_a_name_of_generic_words_only_is_no_project(brief):
    for title in ("Firm Commissions 40 MW Solar Project in Zambia", "Zambia copper expansion gathers pace",
                  "New Hydro Power Project announced"):
        a = run(title, brief)
        assert a.projects == [], title
    assert rules.distinctive_project_name("Chisamba Solar Project")
    assert not rules.distinctive_project_name("Zambia Solar Project")


def test_title_cues_name_a_stage_or_its_event(brief):
    started = run("Construction of the Mkushi Farm Block Dam Project kicks off", brief)
    assert [p.get("stage") for p in started.projects] == ["construction_mobilisation"]
    commissioned = run("Utility Announces Commissioning of the Kafue Gorge Lower Unit Five Project", brief)
    assert [p.get("stage") for p in commissioned.projects] == ["commissioning_rampup"]
    planned = run("Chingola Bypass Road Project to Break Ground in 2027", brief)
    assert planned.projects and planned.projects[0].get("stage") is None


def test_a_new_project_first_seen_at_commissioning_or_later_is_not_a_first_trace(brief):
    late = run("Kitwe Cement Plant Project commissioned\n\nKitwe Cement Plant Project commissioned the new kiln line.",
               brief)
    assert late.projects and late.projects[0]["new"] and late.projects[0].get("stage") == "commissioning_rampup"
    assert late.features["project_first_trace"] is False
    assert late.tier_rule != "t0_new_project_first_trace"
    early = run("Feasibility study for Mufumbwe Gold Project\n\nThe owner completed a definitive feasibility study for "
                "the Mufumbwe Gold Project.", brief)
    assert early.features["project_first_trace"] is True and early.tier == 0


# ---------- database cases: duplicate projects, site names in titles, from_status ----------


@pytest.mark.db
def test_a_second_name_of_a_project_at_the_same_site_resolves_to_the_known_project(edb):
    enrich_text(edb, "Sentinel Mine Expansion gets board nod\n\nThe board of First Quantum approved the Sentinel Mine "
                     "Expansion at the Sentinel mine.")
    second, _ = enrich_text(edb, "First Quantum Sentinel Pit Four Expansion on track\n\nFirst Quantum said that the "
                                 "First Quantum Sentinel Pit Four Expansion is on schedule.")
    projects = edb.execute("SELECT id, name FROM proj_project WHERE name ILIKE %s", ("%sentinel%",)).fetchall()
    pending = [ev for p in proposals_of(edb, second["id"]) for ev in p["events"]
               if ev["event_type"] == "EntityIdentified" and ev["payload"]["entity_type"] == "project"]
    assert len(projects) == 1 and pending == []
    edb.commit()


@pytest.mark.db
def test_a_project_site_proposal_names_the_site_and_a_status_change_has_a_from_status(edb):
    source, _ = enrich_text(edb, "Mimbula Deeps Project approved\n\nThe board approved the Mimbula Deeps Project at "
                                 "the Mimbula mine.")
    titles = [p["title"] for p in proposals_of(edb, source["id"]) if p["kind"] == "RelationshipAsserted"]
    assert titles and all(" is at a site" not in t for t in titles)
    assert any("Mimbula" in t.split(" is at ", 1)[1] for t in titles)
    sid = site_id(edb, "kansanshi")
    status_source, _ = enrich_text(edb, "Kansanshi mine halts operations\n\nKansanshi Mining Plc halted operations at "
                                        "the Kansanshi mine after a power failure.")
    status = [p for p in proposals_of(edb, status_source["id"]) if p["kind"] == "SiteStatusChanged"]
    assert status
    payload = status[0]["events"][0]["payload"]
    assert status[0]["events"][0]["stream_id"] == sid
    assert payload["from_status"] == "producing" and payload["from_status_source"] == "brief_status_hint"
    edb.commit()


# ---------- faults that the lead time backtest found ----------


@pytest.mark.parametrize("text,normal", [
    ("$1.1 Billion", "1100000000 USD"), ("$2 Billion", "2000000000 USD"), ("$1B", "1000000000 USD"),
    ("US$2 BN", "2000000000 USD"), ("$498M", "498000000 USD"), ("K2.5 Million", "2500000 ZMW"),
    ("20 Million US Dollars", "20000000 USD"), ("$1.2bn", "1200000000 USD"), ("K28.40 per litre", "28.4 ZMW"),
])
def test_money_units_in_headline_case_give_the_full_amount(text, normal):
    from services.enrichment.normalisers import normalise_value

    assert normalise_value("money", text) == normal


def test_capital_that_an_investor_puts_into_an_asset_belongs_to_the_asset(brief):
    a = run("Gulf fund to put money into Kansanshi\n\nA Gulf fund will invest US$800 Million in Kansanshi Mining Plc "
            "over five years.", brief)
    capex = claims(a, "capex")
    assert [(c["subject"], c["normalised"]) for c in capex] == [("Kansanshi Mining Plc", "800000000 USD")]
    no_asset = run("Development bank backs Zambian trade route\n\nThe African Development Bank invests $2B in the "
                   "southern trade corridor of Zambia.", brief)
    assert claims(no_asset, "capex") == []
    noun = run("Mimbula plant approved\n\nThe board approved the Mimbula Leach Plant Project. The investment is "
               "US$70 million.", brief)
    assert [c["subject"] for c in claims(noun, "capex")] == ["Mimbula Leach Plant Project"]


def test_an_amount_below_the_minimum_is_no_project_amount(brief):
    a = run("Odd figure\n\nKansanshi Mining Plc will spend $12 on the Kansanshi Sulphide Project.", brief)
    assert claims(a, "capex") == []


def test_a_bare_distinctive_site_word_names_the_one_watched_site(brief):
    a = run("Great year ahead for Lumwana\n\nBarrick said that Lumwana will grow.", brief)
    assert "site:lumwana" in {r["entity_id"] for r in a.resolutions}
    mfez = run("Investors tour the Lumwana MFEZ in North-Western Province, Zambia", brief)
    assert "site:lumwana" not in {r["entity_id"] for r in mfez.resolutions}


def test_a_feasibility_study_that_is_due_names_the_feasibility_stage(brief):
    from services.enrichment.entity_index import EntityRecord

    records = brief_records(brief) + [EntityRecord(id="project:known", type="project", name="Lumwana copper expansion",
                                                   site_id="site:lumwana", watch="daily")]
    a = run("Feasibility study on Lumwana Super Pit expansion expected by year-end", brief, MemoryIndex(records),
            source_type="snapshot")
    assert [(p["id"], p.get("stage"), p["new"]) for p in a.projects] == [("project:known", "feasibility", False)]
    stage = [f for f in a.facts if f.kind == "ProjectStageChanged"]
    assert stage and stage[0].events[0].payload["to_stage"] == "feasibility"
    # The project enters the engagement window (docs/05 Tier 0). Else the watched stage change rule gives Tier 1.
    assert a.tier_rule in ("t0_enters_engagement_window", "t1_stage_change_watched")
    planned = run("Owner plans to start a feasibility study on the Kitumba Deeps Project next year, Zambia", brief)
    assert not any(p.get("stage") == "feasibility" for p in planned.projects)


def test_an_item_that_names_only_the_operator_of_a_watched_site_is_watched(brief):
    a = run("Equipment maker wins large order from Mopani Copper Mines in Zambia", brief, source_type="snapshot")
    assert a.features["watched"] is True and a.features["watched_via_operator"] is True
    assert a.tier == 1 and a.tier_rule == "t1_contractor_award_watched"
