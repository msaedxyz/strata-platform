"""docs/09 scenario 10: an admin erases a person. The API returns no personal fields for that person. The hash chain
check passes.

An analyst adds a contact to an opportunity and logs a touchpoint with that contact. The contact data is invented
test data. The admin erases the person. The check of the hash chain runs in the api container
(`python -m services.projections.cli check-chain`, exit code 0) and as SQL (`check_hash_chain()`, zero rows).
"""

from __future__ import annotations

import json

from .stack import approved_deal

CONTACT = {"name": "Mutale Erasure-Test", "role": "Fleet manager", "email": "mutale.erasure@kcm.example",
           "phone": "+260 966 000 101", "found_via": "Site visit"}


def test_s10_an_admin_erases_a_person(api, compose, acceptance):
    card = approved_deal(api, "business/2026/09/kcm-plan-konkola-deep", "Prequalification:", q="Konkola Deep")
    org = api.ok("/api/entities", q="Konkola Copper Mines", type="organisation")["items"][0]["id"]
    r = api.post(f"/api/deals/{card['id']}/contacts", "analyst", {**CONTACT, "organisation_id": org})
    assert r.status_code == 200, r.text
    person = r.json()["contact_id"]
    r = api.post(f"/api/deals/{card['id']}/touchpoints", "analyst",
                 {"kind": "site_visit", "date": "2026-09-20", "note": "Met the fleet manager", "contact_id": person})
    assert r.status_code == 200, r.text
    assert api.ok(f"/api/persons/{person}")["email"] == CONTACT["email"]
    # Only an admin can erase.
    assert api.post(f"/api/persons/{person}/erase", "approver", {"reason": "Erasure request"}).status_code == 403
    r = api.post(f"/api/persons/{person}/erase", "admin", {"reason": "Erasure request from the person"})
    assert r.status_code == 200, r.text
    view = api.ok(f"/api/persons/{person}")
    relationship = api.ok(f"/api/deals/{card['id']}/relationship")
    text = json.dumps(view) + json.dumps(relationship)
    for value in (CONTACT["name"], CONTACT["email"], CONTACT["phone"], "Mutale"):
        assert value not in text, value
    assert view["erased"] is True and view["email"] is None and view["phone"] is None
    # The history stays: the ContactAdded event is still in the stream, and the hash chain has no break.
    assert any(i["event_type"] == "ContactAdded" for i in api.timeline("deal", card["id"])["items"])
    result = compose.exec("api", "python", "-m", "services.projections.cli", "check-chain", check=False)
    assert result.returncode == 0, result.stdout[-2000:]
    assert json.loads(result.stdout)["breaks"] == 0
    assert compose.scalar("SELECT count(*) FROM strata.check_hash_chain()") == "0"
    # No clear personal value is in the event store.
    rows = compose.scalar("SELECT count(*) FROM strata.event WHERE payload::text LIKE '%mutale.erasure%' "
                          "OR payload::text LIKE '%Erasure-Test%'")
    assert rows == "0"
