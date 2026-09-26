"""docs/06-governance.md criterion 3: each default of the approval policy has a test.

The unit cases check services/governance/proposals.event_policy against config/approval-policy.yaml. The
database cases check what create_proposal does with each policy: an automatic proposal writes its events at
once, a review proposal waits, an admin_review proposal waits for an admin, and an engagement event needs a
human actor.
"""

from __future__ import annotations

import pytest

from services.common.config import approval_policy
from services.governance import proposals as gp

from .governance_support import make_deal
from .helpers import make_evidence, make_source

# (default of docs/06, event, expected policy)
CASES = [
    ("SignalScored automatic", {"event_type": "SignalScored", "certainty": "speculative", "payload": {}}, "automatic"),
    ("EntityIdentified new, confidence 0.95", {"event_type": "EntityIdentified",
                                               "payload": {"new_entity": True, "resolution_confidence": 0.95}}, "automatic"),
    ("EntityIdentified new, confidence 0.9", {"event_type": "EntityIdentified",
                                              "payload": {"new_entity": True, "resolution_confidence": 0.9}}, "automatic"),
    ("EntityIdentified new, confidence 0.89", {"event_type": "EntityIdentified",
                                               "payload": {"new_entity": True, "resolution_confidence": 0.89}}, "review"),
    ("EntityIdentified new, no confidence", {"event_type": "EntityIdentified", "payload": {"new_entity": True}}, "review"),
    ("EntityIdentified not new", {"event_type": "EntityIdentified", "payload": {"resolution_confidence": 1.0}}, "review"),
    ("EntityAttributeAsserted stated", {"event_type": "EntityAttributeAsserted", "certainty": "stated", "payload": {}},
     "automatic"),
    ("EntityAttributeAsserted reported", {"event_type": "EntityAttributeAsserted", "certainty": "reported",
                                          "payload": {}}, "review"),
    ("EntityAttributeAsserted speculative", {"event_type": "EntityAttributeAsserted", "certainty": "speculative",
                                             "payload": {}}, "review"),
    ("EntityMerged always review", {"event_type": "EntityMerged", "certainty": "stated", "payload": {}}, "review"),
    ("EntitySplit always review", {"event_type": "EntitySplit", "certainty": "stated", "payload": {}}, "review"),
    ("DealIdentified always review", {"event_type": "DealIdentified", "certainty": "stated", "payload": {}}, "review"),
    ("DealStageChanged always review", {"event_type": "DealStageChanged", "certainty": "stated", "payload": {}}, "review"),
    ("RelationshipAsserted review", {"event_type": "RelationshipAsserted", "certainty": "stated", "payload": {}}, "review"),
    ("SiteStatusChanged review", {"event_type": "SiteStatusChanged", "certainty": "stated", "payload": {}}, "review"),
    ("DemandDriverObserved stated", {"event_type": "DemandDriverObserved", "certainty": "stated", "payload": {}},
     "automatic"),
    ("DemandDriverObserved reported", {"event_type": "DemandDriverObserved", "certainty": "reported", "payload": {}},
     "review"),
    ("SourceProposed admin review", {"event_type": "SourceProposed", "payload": {}}, "admin_review"),
    ("ProjectStageChanged stated", {"event_type": "ProjectStageChanged", "certainty": "stated", "payload": {}},
     "automatic"),
    ("ProjectStageChanged speculative", {"event_type": "ProjectStageChanged", "certainty": "speculative", "payload": {}},
     "review"),
    ("ProcurementWindowForecast automatic", {"event_type": "ProcurementWindowForecast", "certainty": "reported",
                                             "payload": {}}, "automatic"),
    ("ContactAdded automatic", {"event_type": "ContactAdded", "payload": {}}, "automatic"),
    ("TouchpointLogged automatic", {"event_type": "TouchpointLogged", "payload": {}}, "automatic"),
    ("NextActionSet automatic", {"event_type": "NextActionSet", "payload": {}}, "automatic"),
    ("PrequalificationStatusChanged automatic", {"event_type": "PrequalificationStatusChanged", "payload": {}},
     "automatic"),
]

# Event types of docs/06 that the table above must cover.
DOCS_06_DEFAULTS = {"SignalScored", "EntityIdentified", "EntityAttributeAsserted", "EntityMerged", "EntitySplit",
                    "DealIdentified", "DealStageChanged", "RelationshipAsserted", "SiteStatusChanged",
                    "DemandDriverObserved", "SourceProposed", "ProjectStageChanged", "ProcurementWindowForecast",
                    "ContactAdded", "TouchpointLogged", "NextActionSet", "PrequalificationStatusChanged"}


@pytest.mark.parametrize("name,event,expected", CASES, ids=[c[0] for c in CASES])
def test_c06_03_each_policy_default(name, event, expected):
    """Criterion 06-3: one case for each default (and each condition) of the approval policy."""
    assert gp.event_policy(event) == expected


def test_c06_03_every_default_of_docs_06_has_a_case_and_is_in_the_config():
    covered = {c[1]["event_type"] for c in CASES}
    assert DOCS_06_DEFAULTS <= covered
    assert DOCS_06_DEFAULTS <= set(approval_policy()["policies"])
    conds = approval_policy()["policies"]["EntityIdentified"]["automatic_if"]
    assert conds == {"new_entity": True, "min_resolution_confidence": 0.9}
    for engagement in ("ContactAdded", "TouchpointLogged", "NextActionSet", "PrequalificationStatusChanged"):
        assert approval_policy()["policies"][engagement] == {"policy": "automatic", "actor": "human"}


def test_c06_03_the_strictest_event_policy_decides_a_proposal():
    auto = {"event_type": "SignalScored", "payload": {}}
    assert gp.proposal_policy([auto]) == "automatic"
    assert gp.proposal_policy([auto, {"event_type": "SiteStatusChanged", "payload": {}}]) == "review"
    assert gp.proposal_policy([auto, {"event_type": "SourceProposed", "payload": {}}]) == "admin_review"
    assert gp.proposal_policy([auto], force_review=True) == "review"


# ---------- what create_proposal does with each policy ----------


def _evidence(conn, text: str, quote: str) -> str:
    return make_evidence(conn, make_source(conn, text), text, quote)


def _driver(eid: str, certainty: str) -> dict:
    return {"stream_type": "market", "stream_id": "zm", "event_type": "DemandDriverObserved",
            "payload": {"driver_type": "load_shedding", "title": "Load shedding", "direction": "demand_up"},
            "evidence_ids": [eid], "certainty": certainty}


@pytest.mark.db
def test_c06_03_automatic_writes_at_once_and_review_waits(edb):
    eid = _evidence(edb, "ZESCO extended load shedding to 12 hours a day.", "extended load shedding")
    auto, _ = gp.create_proposal(edb, kind="DemandDriverObserved", title="stated", events=[_driver(eid, "stated")],
                                 created_by_type="agent", created_by="enrichment.classifier",
                                 model_id="deterministic-v1", prompt_version="rules-v1")
    review, _ = gp.create_proposal(edb, kind="DemandDriverObserved", title="reported", events=[_driver(eid, "reported")],
                                   created_by_type="agent", created_by="enrichment.classifier",
                                   model_id="deterministic-v1", prompt_version="rules-v1")
    assert auto["status"] == "auto_approved" and auto["policy"] == "automatic"
    assert review["status"] == "pending" and review["policy"] == "review"
    count = edb.execute("SELECT count(*) AS n FROM event WHERE proposal_id = %s AND stream_type = 'market'",
                        (review["id"],)).fetchone()["n"]
    assert count == 0
    edb.rollback()


@pytest.mark.db
def test_c06_03_engagement_events_are_automatic_with_a_human_actor_only(edb):
    deal = make_deal(edb, title="Policy test deal")
    event = {"stream_type": "deal", "stream_id": deal["id"], "event_type": "NextActionSet",
             "payload": {"action": "Call the buyer", "owner_user_id": "u-analyst", "due_date": "2026-10-01"},
             "evidence_ids": [], "certainty": None}
    row, _ = gp.create_proposal(edb, kind="NextActionSet", title="next", events=[event], created_by_type="human",
                                created_by="u-analyst")
    assert row["status"] == "auto_approved"
    written = edb.execute("SELECT * FROM event WHERE proposal_id = %s AND event_type = 'NextActionSet'",
                          (row["id"],)).fetchone()
    assert written["actor_type"] == "human" and written["actor_id"] == "u-analyst"
    with pytest.raises(gp.ProposalError):
        gp.create_proposal(edb, kind="NextActionSet", title="agent", events=[event], created_by_type="agent",
                           created_by="enrichment.scorer", model_id="deterministic-v1", prompt_version="rules-v1")
    edb.rollback()


@pytest.mark.db
def test_c06_03_a_new_entity_below_the_confidence_threshold_waits(edb):
    from services.common.ids import new_id

    eid = _evidence(edb, "Chambeshi Lime Works Limited opened a quarry.", "Chambeshi Lime Works Limited")
    events = lambda conf: [{"stream_type": "entity", "stream_id": new_id(), "event_type": "EntityIdentified",  # noqa: E731
                            "payload": {"entity_type": "organisation", "name": "Chambeshi Lime Works Limited",
                                        "new_entity": True, "resolution_confidence": conf},
                            "evidence_ids": [eid], "certainty": "stated"}]
    high, _ = gp.create_proposal(edb, kind="EntityIdentified", title="high", events=events(0.9), created_by_type="agent",
                                 created_by="enrichment.resolver", model_id="deterministic-v1", prompt_version="rules-v1")
    low, _ = gp.create_proposal(edb, kind="EntityIdentified", title="low", events=events(0.6), created_by_type="agent",
                                created_by="enrichment.resolver", model_id="deterministic-v1", prompt_version="rules-v1")
    assert high["status"] == "auto_approved" and low["status"] == "pending"
    edb.rollback()
