"""docs/04-ingestion.md criterion 13, the brief API, and docs/06 criterion 1 for the M2 write endpoints."""

from __future__ import annotations

import pytest

from .collector_support import activate_fixture_brief, run_fixture
from .conftest import bearer

pytestmark = pytest.mark.db


@pytest.fixture(scope="module")
def proposal_setup(fresh_db, fixture_server):
    """The fixture brief is active. Governance bootstrap loads its proposed source as a proposal."""
    from services.common.db import connect
    from services.governance.bootstrap import bootstrap_brief

    with connect(fresh_db["app_url"]) as conn:
        brief = activate_fixture_brief(conn, fixture_server)
        result = bootstrap_brief(conn)
        proposal = conn.execute("SELECT * FROM proposal WHERE kind = 'SourceProposed'").fetchone()
    return {"brief": brief, "bootstrap": result, "proposal": proposal}


WRITE_ENDPOINTS = [
    ("post", "/api/sources/manual", {"json": {"url": "https://example.test/a"}}),
    ("post", "/api/briefs", {"json": {"yaml": "version: 1"}}),
    ("post", "/api/briefs/1/activate", {}),
    ("post", "/api/proposals/some-id/approve-source", {}),
]


@pytest.mark.parametrize("method, path, kwargs", WRITE_ENDPOINTS)
def test_c06_01_viewer_gets_403_on_each_m2_write_endpoint(proposal_setup, client, auth, method, path, kwargs):
    r = getattr(client, method)(path, headers=bearer(auth("viewer")), **kwargs)
    assert r.status_code == 403


@pytest.mark.parametrize("method, path, kwargs", WRITE_ENDPOINTS[1:])
def test_admin_endpoints_need_the_admin_role(proposal_setup, client, auth, method, path, kwargs):
    for role in ("analyst", "approver"):
        assert getattr(client, method)(path, headers=bearer(auth(role)), **kwargs).status_code == 403


def test_c04_13_approved_source_proposal_makes_a_new_brief_version_and_the_next_run_collects_it(
        proposal_setup, client, auth, cdb, fixture_server, fake_clock):
    """Criterion 13: approve the SourceProposed proposal, check the new active version, run, collect."""
    proposal = proposal_setup["proposal"]
    assert proposal["policy"] == "admin_review" and proposal["status"] == "pending"
    old = cdb.execute("SELECT * FROM active_brief").fetchone()
    assert "fx_prop_corridor" not in {s["id"] for s in old["content"]["sources"]["news"]}

    r = client.post(f"/api/proposals/{proposal['id']}/approve-source", headers=bearer(auth("admin", sub="admin-1")),
                    json={"reason": "useful corridor source"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["brief_version"] == old["version"] + 1

    new = cdb.execute("SELECT * FROM active_brief").fetchone()
    assert new["id"] == body["brief_version_id"] and new["parent_version_id"] == old["id"]
    news_ids = {s["id"] for s in new["content"]["sources"]["news"]}
    assert "fx_prop_corridor" in news_ids
    assert "fx_prop_corridor" not in {s["id"] for s in new["content"]["sources"].get("proposed") or []}
    decided = cdb.execute("SELECT * FROM proposal WHERE id = %s", (proposal["id"],)).fetchone()
    assert decided["status"] == "approved" and decided["decided_by"] == "admin-1"
    events = [e["event_type"] for e in cdb.execute(
        "SELECT event_type FROM event WHERE stream_type = 'proposal' AND stream_id = %s ORDER BY sequence",
        (proposal["id"],)).fetchall()]
    assert events == ["ProposalCreated", "ProposalApproved"]

    diff = client.get(f"/api/briefs/diff?from={old['version']}&to={new['version']}",
                      headers=bearer(auth("viewer"))).json()
    assert any(c["path"] == "sources.news[id=fx_prop_corridor]" and c["op"] == "added" for c in diff["changes"])

    fixture_server.reset()
    results, _ = run_fixture(cdb, fixture_server, fake_clock)
    by_id = {r.brief_source_id: r for r in results}
    assert by_id["fx_prop_corridor"].status == "success" and by_id["fx_prop_corridor"].new == 1
    src = cdb.execute("SELECT * FROM source WHERE brief_source_id = 'fx_prop_corridor'").fetchone()
    assert src["brief_version_id"] == new["id"]
    assert "/feeds/corridor.xml" in fixture_server.paths()


def test_c04_13_a_decided_proposal_cannot_be_approved_again(proposal_setup, client, auth):
    r = client.post(f"/api/proposals/{proposal_setup['proposal']['id']}/approve-source",
                    headers=bearer(auth("admin", sub="admin-2")))
    assert r.status_code == 409
    assert client.post("/api/proposals/missing/approve-source", headers=bearer(auth("admin"))).status_code == 404


def test_c06_02_admin_cannot_approve_an_own_source_proposal(proposal_setup, cdb, client, auth):
    from services.governance.source_proposals import create_source_proposal

    from .helpers import make_evidence, make_source

    text = "Admin found a new source: https://example.test/feed"
    src = make_source(cdb, text)
    ev = make_evidence(cdb, src, text, "https://example.test/feed")
    row, _ = create_source_proposal(
        cdb, {"id": "own_source", "name": "Own", "type": "rss", "url": "https://example.test/feed", "schedule": "daily",
              "licence_code": "verify_then_purge"},
        created_by_type="human", created_by="admin-own", evidence_ids=[ev], source_id=src["id"])
    cdb.commit()
    r = client.post(f"/api/proposals/{row['id']}/approve-source", headers=bearer(auth("admin", sub="admin-own")))
    assert r.status_code == 403


def test_c04_brief_api_lists_gets_creates_and_activates_versions(proposal_setup, client, auth, cdb):
    listing = client.get("/api/briefs", headers=bearer(auth("viewer"))).json()
    versions = [v["version"] for v in listing["versions"]]
    assert versions == sorted(versions, reverse=True)
    active = listing["active_version"]
    current = client.get(f"/api/briefs/{active}", headers=bearer(auth("viewer"))).json()
    assert current["active"] is True and current["content"]["version"] == active

    import yaml

    content = yaml.safe_load(current["yaml"])
    content["exclusions"] = [*content.get("exclusions", []), "lottery"]
    edited = yaml.safe_dump(content, sort_keys=False)
    r = client.post("/api/briefs", headers=bearer(auth("admin")), json={"yaml": edited, "change_note": "add exclusion"})
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["version"] == active + 1 and created["active"] is False and created["created"] is True
    again = client.post("/api/briefs", headers=bearer(auth("admin")), json={"yaml": edited}).json()
    assert again["created"] is False and again["version"] == created["version"]

    bad = client.post("/api/briefs", headers=bearer(auth("admin")), json={"yaml": "version: 1\nname: x\n"})
    assert bad.status_code == 422 and bad.json()["detail"]["errors"]

    r = client.post(f"/api/briefs/{created['version']}/activate", headers=bearer(auth("admin")))
    assert r.status_code == 200
    assert cdb.execute("SELECT version FROM active_brief").fetchone()["version"] == created["version"]
    assert client.get("/api/briefs/999", headers=bearer(auth("viewer"))).status_code == 404
