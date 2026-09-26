"""Proposals, the approval policy, Tier 0 alerts, the evidence check, the quarantine API and the forecast.

Sources: docs/05-enrichment.md criteria 2, 5 and 7, docs/06-governance.md (the functions; M4 adds the routes).
"""

from __future__ import annotations

import socketserver
import threading

import pytest

from services.governance import proposals as gp

from .enrichment_support import add_source, enrich_text, site_id
from .helpers import make_evidence

# ---------- approval policy (config/approval-policy.yaml) ----------


@pytest.mark.parametrize("event,expected", [
    ({"event_type": "SignalScored", "certainty": "reported", "payload": {}}, "automatic"),
    ({"event_type": "EntityIdentified", "payload": {"new_entity": True, "resolution_confidence": 0.95}}, "automatic"),
    ({"event_type": "EntityIdentified", "payload": {"new_entity": True, "resolution_confidence": 0.9}}, "automatic"),
    ({"event_type": "EntityIdentified", "payload": {"new_entity": True, "resolution_confidence": 0.85}}, "review"),
    ({"event_type": "EntityIdentified", "payload": {"resolution_confidence": 0.99}}, "review"),
    ({"event_type": "EntityAttributeAsserted", "certainty": "stated", "payload": {}}, "automatic"),
    ({"event_type": "EntityAttributeAsserted", "certainty": "reported", "payload": {}}, "review"),
    ({"event_type": "EntityMerged", "certainty": "stated", "payload": {}}, "review"),
    ({"event_type": "DealIdentified", "certainty": "stated", "payload": {}}, "review"),
    ({"event_type": "DealStageChanged", "certainty": "stated", "payload": {}}, "review"),
    ({"event_type": "RelationshipAsserted", "certainty": "stated", "payload": {}}, "review"),
    ({"event_type": "SiteStatusChanged", "certainty": "stated", "payload": {}}, "review"),
    ({"event_type": "DemandDriverObserved", "certainty": "stated", "payload": {}}, "automatic"),
    ({"event_type": "DemandDriverObserved", "certainty": "speculative", "payload": {}}, "review"),
    ({"event_type": "ProjectStageChanged", "certainty": "stated", "payload": {}}, "automatic"),
    ({"event_type": "ProjectStageChanged", "certainty": "reported", "payload": {}}, "review"),
    ({"event_type": "ProcurementWindowForecast", "certainty": "reported", "payload": {}}, "automatic"),
    ({"event_type": "SourceProposed", "payload": {}}, "admin_review"),
])
def test_approval_policy_defaults(event, expected):
    assert gp.event_policy(event) == expected


def test_strictest_policy_and_forced_review():
    events = [{"event_type": "SignalScored", "payload": {}}, {"event_type": "SiteStatusChanged", "payload": {}}]
    assert gp.proposal_policy(events) == "review"
    assert gp.proposal_policy([events[0]], force_review=True) == "review"


# ---------- proposals ----------


def _evidence(conn, text: str, quote: str) -> tuple[dict, str]:
    from .helpers import make_source

    source = make_source(conn, text)
    return source, make_evidence(conn, source, text, quote)


def _driver(eid: str, certainty: str = "stated", title: str = "Fuel shortage in Lusaka") -> dict:
    return {"stream_type": "market", "stream_id": "zm", "event_type": "DemandDriverObserved",
            "payload": {"driver_type": "fuel_shortage", "title": title, "direction": "demand_up"},
            "evidence_ids": [eid], "certainty": certainty}


def test_automatic_proposal_writes_its_events_at_once(edb):
    text = "Filling stations in Lusaka ran out of diesel."
    source, eid = _evidence(edb, text, "ran out of diesel")
    row, created = gp.create_proposal(edb, kind="DemandDriverObserved", title="Fuel shortage", events=[_driver(eid)],
                                      created_by_type="agent", created_by="enrichment.classifier",
                                      model_id="deterministic-v1", prompt_version="rules-v1", source_id=source["id"],
                                      idempotency_key=f"{source['id']}:driver")
    assert created and row["status"] == "auto_approved" and row["policy"] == "automatic"
    written = edb.execute("SELECT * FROM event WHERE proposal_id = %s ORDER BY recorded_at", (row["id"],)).fetchall()
    kinds = [(e["stream_type"], e["event_type"], e["actor_type"]) for e in written]
    assert ("proposal", "ProposalCreated", "agent") in kinds
    assert ("market", "DemandDriverObserved", "agent") in kinds
    assert ("proposal", "ProposalApproved", "system") in kinds
    fact = next(e for e in written if e["event_type"] == "DemandDriverObserved")
    assert fact["model_id"] == "deterministic-v1" and fact["evidence_ids"] == [eid]
    again, created_again = gp.create_proposal(edb, kind="DemandDriverObserved", title="Fuel shortage",
                                              events=[_driver(eid)], created_by_type="agent",
                                              created_by="enrichment.classifier", model_id="deterministic-v1",
                                              prompt_version="rules-v1", idempotency_key=f"{source['id']}:driver")
    assert not created_again and again["id"] == row["id"]
    edb.commit()


def test_review_proposal_waits_and_an_approver_writes_it(edb):
    text = "The Mines Safety Department suspended operations at the Kansanshi mine."
    source, eid = _evidence(edb, text, "suspended operations at the Kansanshi mine")
    sid = site_id(edb, "kansanshi")
    ev = {"stream_type": "entity", "stream_id": sid, "event_type": "SiteStatusChanged",
          "payload": {"from_status": None, "to_status": "suspended"}, "evidence_ids": [eid], "certainty": "stated"}
    row, _ = gp.create_proposal(edb, kind="SiteStatusChanged", title="Kansanshi suspended", events=[ev],
                                created_by_type="agent", created_by="enrichment.extractor", model_id="deterministic-v1",
                                prompt_version="rules-v1", source_id=source["id"])
    assert row["status"] == "pending"
    assert edb.execute("SELECT count(*) AS n FROM event WHERE event_type = 'SiteStatusChanged' AND stream_id = %s",
                       (sid,)).fetchone()["n"] == 0
    assert edb.execute("SELECT status_pending FROM proj_entity WHERE id = %s", (sid,)).fetchone()["status_pending"] == "suspended"
    written = gp.approve(edb, row["id"], "approver-1")
    assert [w["event_type"] for w in written] == ["SiteStatusChanged"]
    state = edb.execute("SELECT status, status_pending FROM proj_entity WHERE id = %s", (sid,)).fetchone()
    assert state["status"] == "suspended" and state["status_pending"] is None
    decided = edb.execute("SELECT * FROM proposal WHERE id = %s", (row["id"],)).fetchone()
    assert decided["status"] == "approved" and decided["decided_by"] == "approver-1"
    approved = edb.execute("SELECT * FROM event WHERE stream_type = 'proposal' AND stream_id = %s "
                           "AND event_type = 'ProposalApproved'", (row["id"],)).fetchone()
    assert approved["actor_type"] == "human" and approved["actor_id"] == "approver-1"
    with pytest.raises(gp.ProposalError):
        gp.approve(edb, row["id"], "approver-2")
    edb.commit()


def test_an_approver_cannot_approve_an_own_proposal(edb):
    text = "Fuel queues in Kitwe grew on Monday."
    source, eid = _evidence(edb, text, "Fuel queues in Kitwe")
    row, _ = gp.create_proposal(edb, kind="DemandDriverObserved", title="Fuel queues", events=[_driver(eid, "reported")],
                                created_by_type="human", created_by="analyst-1", source_id=source["id"])
    assert row["status"] == "pending"
    with pytest.raises(gp.ProposalForbidden) as exc:
        gp.approve(edb, row["id"], "analyst-1")
    assert isinstance(exc.value, PermissionError)
    with pytest.raises(PermissionError):
        gp.edit_and_approve(edb, row["id"], "analyst-1", [{}])
    edb.rollback()


def test_reject_needs_a_reason_and_clears_the_pending_status(edb):
    text = "Operations at the Lumwana mine were suspended for a day."
    source, eid = _evidence(edb, text, "Operations at the Lumwana mine were suspended")
    sid = site_id(edb, "lumwana")
    ev = {"stream_type": "entity", "stream_id": sid, "event_type": "SiteStatusChanged",
          "payload": {"from_status": None, "to_status": "suspended"}, "evidence_ids": [eid], "certainty": "stated"}
    row, _ = gp.create_proposal(edb, kind="SiteStatusChanged", title="Lumwana suspended", events=[ev],
                                created_by_type="agent", created_by="enrichment.extractor", model_id="deterministic-v1",
                                prompt_version="rules-v1", source_id=source["id"])
    with pytest.raises(gp.ProposalError):
        gp.reject(edb, row["id"], "approver-1", " ")
    gp.reject(edb, row["id"], "approver-1", "The suspension lasted one day only")
    assert edb.execute("SELECT status FROM proposal WHERE id = %s", (row["id"],)).fetchone()["status"] == "rejected"
    assert edb.execute("SELECT status_pending FROM proj_entity WHERE id = %s", (sid,)).fetchone()["status_pending"] is None
    assert edb.execute("SELECT count(*) AS n FROM event WHERE event_type = 'SiteStatusChanged' AND stream_id = %s",
                       (sid,)).fetchone()["n"] == 0
    edb.commit()


def test_edit_and_approve_writes_human_events_that_keep_the_evidence(edb):
    text = "Sources say fuel is short in Ndola."
    source, eid = _evidence(edb, text, "fuel is short in Ndola")
    row, _ = gp.create_proposal(edb, kind="DemandDriverObserved", title="Fuel short", events=[_driver(eid, "reported")],
                                created_by_type="agent", created_by="enrichment.classifier", model_id="deterministic-v1",
                                prompt_version="rules-v1", source_id=source["id"])
    assert row["status"] == "pending"
    edited = [{"payload": {"driver_type": "fuel_shortage", "title": "Fuel shortage in Ndola (edited)",
                           "direction": "demand_up"}, "certainty": "reported"}]
    written = gp.edit_and_approve(edb, row["id"], "approver-1", edited, reason="Clearer title")
    assert written[0]["actor_type"] == "human" and written[0]["actor_id"] == "approver-1"
    assert written[0]["evidence_ids"] == [eid]
    assert written[0]["payload"]["title"] == "Fuel shortage in Ndola (edited)"
    assert edb.execute("SELECT status FROM proposal WHERE id = %s", (row["id"],)).fetchone()["status"] == "edited_approved"
    edb.commit()


def test_an_approved_stage_change_gets_its_forecast(edb):
    text = "The Chambishi Deep Project completed a definitive feasibility study in September 2026."
    source, eid = _evidence(edb, text, "completed a definitive feasibility study")
    from services.common.ids import new_id

    pid = new_id()
    gp.create_proposal(edb, kind="EntityIdentified", title="New project", events=[
        {"stream_type": "project", "stream_id": pid, "event_type": "EntityIdentified",
         "payload": {"entity_type": "project", "name": "Chambishi Deep Project", "new_entity": True,
                     "resolution_confidence": 0.95}, "evidence_ids": [eid], "certainty": "stated"}],
        created_by_type="agent", created_by="enrichment.resolver", model_id="deterministic-v1", prompt_version="rules-v1")
    stage, _ = gp.create_proposal(edb, kind="ProjectStageChanged", title="Stage", events=[
        {"stream_type": "project", "stream_id": pid, "event_type": "ProjectStageChanged",
         "payload": {"from_stage": None, "to_stage": "feasibility", "name": "Chambishi Deep Project"},
         "evidence_ids": [eid], "certainty": "reported", "occurred_at": "2026-09-15T00:00:00+00:00"}],
        created_by_type="agent", created_by="enrichment.lifecycle", model_id="deterministic-v1", prompt_version="rules-v1")
    assert stage["status"] == "pending"
    assert edb.execute("SELECT type FROM entity WHERE id = %s", (pid,)).fetchone()["type"] == "project"
    gp.approve(edb, stage["id"], "approver-1")
    project = edb.execute("SELECT * FROM proj_project WHERE id = %s", (pid,)).fetchone()
    assert project["stage"] == "feasibility" and project["in_engagement_window"]
    assert project["forecast_start"] is not None
    assert project["forecast_detail"]["intervals"][0]["n_projects"] == 6
    assert project["forecast_detail"]["evidence_ids"] == [eid]
    edb.commit()


# ---------- Tier 0 alerts ----------


class _SMTPHandler(socketserver.StreamRequestHandler):
    def handle(self):
        self.wfile.write(b"220 strata-test ESMTP\r\n")
        data, lines = False, []
        while True:
            line = self.rfile.readline()
            if not line:
                break
            if data:
                if line == b".\r\n":
                    data = False
                    self.server.messages.append(b"".join(lines).decode("utf-8", "replace"))
                    self.wfile.write(b"250 OK\r\n")
                else:
                    lines.append(line)
                continue
            cmd = line.strip().upper()
            if cmd.startswith(b"DATA"):
                data, lines = True, []
                self.wfile.write(b"354 go ahead\r\n")
            elif cmd.startswith(b"QUIT"):
                self.wfile.write(b"221 bye\r\n")
                break
            else:
                self.wfile.write(b"250 OK\r\n")


@pytest.fixture
def smtp(monkeypatch):
    from services.common.settings import get_settings

    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), _SMTPHandler)
    server.messages = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("STRATA_SMTP_HOST", "127.0.0.1")
    monkeypatch.setenv("STRATA_SMTP_PORT", str(server.server_address[1]))
    monkeypatch.setenv("STRATA_ALERT_EMAIL_TO", "alerts@strata.test")
    get_settings.cache_clear()
    yield server
    server.shutdown()
    server.server_close()
    get_settings.cache_clear()


def test_tier0_alert_is_raised_unconfirmed_at_once_with_frontend_and_email_delivery(edb, smtp):
    from services.governance.alerts import raise_alert

    text = "Filling stations in Solwezi ran out of diesel."
    source, eid = _evidence(edb, text, "ran out of diesel")
    row, created = raise_alert(edb, source=source, tier=0, tier_rule="t0_market_demand_driver",
                               title="Diesel shortage in Solwezi", evidence_ids=[eid])
    assert created
    again, created_again = raise_alert(edb, source=source, tier=0, tier_rule="t0_market_demand_driver",
                                       title="Diesel shortage in Solwezi", evidence_ids=[eid])
    assert not created_again and again["id"] == row["id"]
    alert = edb.execute("SELECT * FROM proj_alert WHERE id = %s", (row["stream_id"],)).fetchone()
    assert alert["status"] == "unconfirmed" and alert["tier_rule"] == "t0_market_demand_driver"
    assert alert["fetched_at"] is not None
    deliveries = {d["channel"]: d for d in edb.execute("SELECT * FROM alert_delivery WHERE alert_id = %s",
                                                       (row["stream_id"],)).fetchall()}
    assert deliveries["frontend"]["status"] == "broadcast"  # "delivered" when the live stream sends it (M4)
    assert deliveries["email"]["status"] == "delivered"
    assert len(smtp.messages) == 1 and "Diesel shortage in Solwezi" in smtp.messages[0]
    edb.commit()


def test_a_failed_email_does_not_stop_the_alert(edb, monkeypatch):
    from services.common.settings import get_settings
    from services.governance.alerts import raise_alert

    closed = socketserver.TCPServer(("127.0.0.1", 0), socketserver.BaseRequestHandler)
    port = closed.server_address[1]
    closed.server_close()
    monkeypatch.setenv("STRATA_SMTP_HOST", "127.0.0.1")
    monkeypatch.setenv("STRATA_SMTP_PORT", str(port))
    monkeypatch.setenv("STRATA_ALERT_EMAIL_TO", "alerts@strata.test")
    get_settings.cache_clear()
    try:
        text = "The TAZAMA pipeline stopped pumping after a leak."
        source, eid = _evidence(edb, text, "stopped pumping")
        row, created = raise_alert(edb, source=source, tier=0, tier_rule="t0_market_demand_driver",
                                   title="Pipeline outage", evidence_ids=[eid])
        assert created
        email = edb.execute("SELECT * FROM alert_delivery WHERE alert_id = %s AND channel = 'email'",
                            (row["stream_id"],)).fetchone()
        assert email["status"] == "failed" and email["detail"]["error"]
    finally:
        get_settings.cache_clear()
    edb.commit()


# ---------- docs/05 criterion 5: quarantine reason code in the API ----------


def test_c05_05_quarantine_reason_code_in_api(edb, client, auth):
    from services.enrichment.backends import DeterministicBackend, ScriptedBackend
    from services.enrichment.pipeline import enrich

    from .conftest import bearer

    text = "Fuel shortage hits Kitwe\n\nFilling stations in Kitwe ran out of diesel."
    source = add_source(edb, text)
    out = DeterministicBackend().call("classifier", "rules-v1", text, {"title": "Fuel shortage hits Kitwe"}, {})
    out["themes"] = ["space_tourism"]
    result = enrich(edb, source["id"], backend=ScriptedBackend(outputs={"classifier": [out]}))
    assert result["status"] == "quarantined"
    viewer = bearer(auth("viewer"))
    listed = client.get("/api/quarantine", params={"source_id": source["id"]}, headers=viewer)
    assert listed.status_code == 200
    body = listed.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["reason_code"] == "unknown_taxonomy_code" and item["agent"] == "classifier"
    assert item["reason"] == body["reason_codes"]["unknown_taxonomy_code"]
    one = client.get(f"/api/quarantine/{item['id']}", headers=viewer)
    assert one.status_code == 200
    assert one.json()["reason_code"] == "unknown_taxonomy_code"
    assert one.json()["detail"]["unknown"] == {"themes": ["space_tourism"]}
    assert one.json()["output"]["themes"] == ["space_tourism"]
    assert client.get("/api/quarantine").status_code == 401
    assert client.get("/api/quarantine/nope", headers=viewer).status_code == 404
    by_reason = client.get("/api/quarantine", params={"reason_code": "unknown_taxonomy_code"}, headers=viewer).json()
    assert by_reason["total"] >= 1


# ---------- docs/05 criterion 7: forecasts ----------

FEASIBILITY = ("GoviEx completes definitive feasibility study for the Muntanga Uranium Project\n\n"
               "GoviEx Uranium Inc. said that it has completed a definitive feasibility study for the Muntanga Uranium "
               "Project in Siavonga district. The study shows a capital cost of US$180 million.")
ZEMA = ("ZEMA invites comments on the Mimbula Phase 3 Expansion Project\n\n"
        "The Zambia Environmental Management Agency (ZEMA) has received an Environmental Impact Statement for the "
        "Mimbula Phase 3 Expansion Project in Chingola district. The developer, Mimbula Minerals Limited, submitted "
        "the Environmental Impact Statement on 14 September 2026.")


def test_c05_07_forecast_shows_intervals_and_evidence_and_no_date_below_five_projects(edb):
    from services.common.config import lifecycle

    enrich_text(edb, FEASIBILITY, source_type="web")
    enrich_text(edb, ZEMA, source_type="web")
    minimum = lifecycle()["min_projects_per_interval"]
    forecasts = edb.execute("SELECT * FROM event WHERE event_type = 'ProcurementWindowForecast'").fetchall()
    assert len(forecasts) >= 3
    dated = undated = 0
    for ev in forecasts:
        p = ev["payload"]
        assert p["intervals"], p
        for iv in p["intervals"]:
            assert {"from", "to", "median_days", "n_projects", "projects"} <= set(iv)
        assert ev["evidence_ids"]
        verified = edb.execute("SELECT count(*) AS n FROM evidence WHERE id = ANY(%s) AND verified",
                               (ev["evidence_ids"],)).fetchone()["n"]
        assert verified == len(ev["evidence_ids"])
        usable = [iv for iv in p["intervals"] if iv["n_projects"] >= minimum and not iv.get("insufficient")]
        if usable:
            assert p["start"] and p["end"] and p["supporting_projects"] == usable[0]["projects"]
            dated += 1
        else:
            assert p["start"] is None and p["end"] is None and p["stage_only"]
            undated += 1
    assert dated >= 1 and undated >= 1
    zema_project = edb.execute("SELECT * FROM proj_project WHERE name = 'Mimbula Phase 3 Expansion Project'").fetchone()
    assert zema_project["stage"] == "eia_filed" and zema_project["forecast_start"] is None
    assert zema_project["forecast_detail"]["stage_only"] is True


# ---------- docs/05 criterion 2: the SQL check ----------


def test_c05_02_sql_check_finds_zero_facts_without_verified_evidence(edb):
    import scripts.check_evidence as check_evidence

    enrich_text(edb, "Mines regulator suspends Mopani's Mufulira mine\n\nThe Mines Safety Department has suspended "
                     "underground operations at the Mufulira mine of Mopani Copper Mines Plc.")
    result = check_evidence.check(edb)
    assert result["fact_events"] > 0
    assert result["facts_without_verified_evidence"] == 0, result["problems"][:5]
    assert edb.execute("SELECT count_facts_without_verified_evidence() AS n").fetchone()["n"] == 0
    assert edb.execute("SELECT count(*) AS n FROM fact_evidence_problem").fetchone()["n"] == 0


def test_c05_02_sql_check_counts_a_fact_whose_evidence_is_wrong(edb):
    """The check is not blind: a wrong quote hash and a quote that is not the text both count. Runs last."""
    import scripts.check_evidence as check_evidence
    from services.common.ids import new_id
    from services.governance.event_store import append_event

    from .helpers import make_source

    text = "Diesel ran out at filling stations in Chingola."
    source = make_source(edb, text)
    bad_hash, wrong_text = new_id(), new_id()
    edb.execute("INSERT INTO evidence (id, source_id, char_start, char_end, quote, quote_hash, verified, verified_at) "
                "VALUES (%s, %s, 0, 6, 'Diesel', 'not-a-hash', true, now())", (bad_hash, source["id"]))
    edb.execute("INSERT INTO evidence (id, source_id, char_start, char_end, quote, quote_hash, verified, verified_at) "
                "VALUES (%s, %s, 7, 10, 'XYZ', encode(digest('XYZ', 'sha256'), 'hex'), true, now())",
                (wrong_text, source["id"]))
    for eid in (bad_hash, wrong_text):
        append_event(edb, stream_type="market", stream_id="zm", event_type="DemandDriverObserved",
                     payload={"driver_type": "fuel_shortage", "title": "t", "direction": "demand_up"},
                     actor_type="system", actor_id="test", evidence_ids=[eid], certainty="stated")
    result = check_evidence.check(edb)
    problems = {p["problem"] for p in result["problems"]}
    assert "quote hash mismatch" in problems and "quote is not the text at its offsets" in problems
    assert result["facts_without_verified_evidence"] == 2
    edb.rollback()
