"""Personal data: docs/06-governance.md criterion 6 and the personal data rules of docs/03 and docs/06.

1. The personal fields (name, business email, business phone) of each person are encrypted with a key for
   that person. No event holds them in clear text.
2. Erasure deletes the key. After it, the API returns no personal fields, and the hash chain check passes.
"""

from __future__ import annotations

import json

import pytest

from services.governance import personal

from .governance_support import make_deal, org_id

pytestmark = pytest.mark.db

NAME, EMAIL, PHONE = "Chanda Mwape Testperson", "c.testperson@kcm.example", "+260 977 000111"


def _add_contact(api, tokens, deal_id: str, conn, **extra) -> dict:
    body = {"name": NAME, "role": "Head of procurement", "organisation_id": org_id(conn, "kcm"), "email": EMAIL,
            "phone": PHONE, "found_via": "KCM supplier day, 12 September 2026", **extra}
    r = api.post(f"/api/deals/{deal_id}/contacts", headers=tokens("analyst"), json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_personal_fields_are_encrypted_with_a_key_for_each_person(api, tokens, edb):
    deal = make_deal(edb, title="Encryption test deal")
    first = _add_contact(api, tokens, deal["id"], edb)
    person = first["contact_id"]
    other = _add_contact(api, tokens, deal["id"], edb, name="Other Testperson", email="other@kcm.example")
    assert other["contact_id"] != person
    # The same business email gives the same person.
    again = _add_contact(api, tokens, deal["id"], edb, role="Procurement director")
    assert again["contact_id"] == person
    keys = edb.execute("SELECT entity_id, wrapped_key FROM person_key WHERE entity_id = ANY(%s)",
                       ([person, other["contact_id"]],)).fetchall()
    assert len(keys) == 2 and keys[0]["wrapped_key"] != keys[1]["wrapped_key"]
    assert personal.data_key(edb, person) != personal.data_key(edb, other["contact_id"])
    # No clear personal field anywhere in the event store or the proposals.
    dump = json.dumps([dict(r) for r in edb.execute("SELECT payload FROM event").fetchall()], default=str)
    dump += json.dumps([r["events"] for r in edb.execute("SELECT events FROM proposal").fetchall()], default=str)
    for value in (NAME, EMAIL, PHONE, "Testperson"):
        assert value not in dump
    identified = edb.execute("SELECT * FROM event WHERE stream_type = 'entity' AND stream_id = %s "
                             "AND event_type = 'EntityIdentified'", (person,)).fetchone()
    assert identified["actor_type"] == "human" and identified["payload"]["entity_type"] == "person"
    assert identified["payload"]["personal"]["alg"] == "AES-256-GCM"
    # A reader gets the clear business contact data.
    view = api.get(f"/api/persons/{person}", headers=tokens("viewer")).json()
    assert view["name"] == NAME and view["email"] == EMAIL and view["phone"] == PHONE and view["erased"] is False
    assert view["role"] == "Head of procurement" and len(view["contacts"]) == 2
    rel = api.get(f"/api/deals/{deal['id']}/relationship", headers=tokens("viewer")).json()
    names = {c["data"]["name"] for c in rel["contacts"]}
    assert NAME in names and all("personal" not in c["data"] for c in rel["contacts"])
    # The canonical fact check does not count the person entity from the team (docs/03, engagement).
    assert edb.execute("SELECT count_facts_without_verified_evidence() AS n").fetchone()["n"] == 0
    edb.commit()


def test_c06_06_after_erasure_the_api_returns_no_personal_fields_and_the_hash_chain_passes(api, tokens, edb):
    """Criterion 06-6 (scenario 10 is in test_scenarios_governance.py)."""
    deal = make_deal(edb, title="Erasure test deal")
    person = _add_contact(api, tokens, deal["id"], edb, email="erase.me@kcm.example")["contact_id"]
    events_before = edb.execute("SELECT count(*) AS n FROM event").fetchone()["n"]
    assert api.post(f"/api/persons/{person}/erase", headers=tokens("approver"), json={"reason": "x"}).status_code == 403
    assert api.post(f"/api/persons/{person}/erase", headers=tokens("admin"), json={}).status_code == 422
    r = api.post(f"/api/persons/{person}/erase", headers=tokens("admin"),
                 json={"reason": "Request of the person under the retention rule"})
    assert r.status_code == 200 and r.json()["status"] == "erased"
    assert edb.execute("SELECT count(*) AS n FROM person_key WHERE entity_id = %s", (person,)).fetchone()["n"] == 0
    log = edb.execute("SELECT * FROM security_log WHERE action = 'erasure' AND detail->>'entity_id' = %s",
                      (person,)).fetchone()
    assert log["user_id"] == "u-admin"
    erased = edb.execute("SELECT * FROM event WHERE stream_id = %s AND event_type = 'PersonErased'", (person,)).fetchone()
    assert erased["actor_type"] == "human" and erased["payload"]["security_log_id"] == log["id"]
    # The history stays: no event was removed.
    assert edb.execute("SELECT count(*) AS n FROM event").fetchone()["n"] == events_before + 1
    view = api.get(f"/api/persons/{person}", headers=tokens("viewer")).json()
    assert view["erased"] is True and view["email"] is None and view["phone"] is None
    assert view["name"] == personal.policy()["erased_name"]
    rel = api.get(f"/api/deals/{deal['id']}/relationship", headers=tokens("viewer")).json()
    contact = next(c for c in rel["contacts"] if c["data"]["contact_id"] == person)
    assert contact["data"]["erased"] is True and contact["data"]["email"] is None
    body = json.dumps([api.get(f"/api/persons/{person}", headers=tokens("viewer")).json(), rel])
    assert "erase.me@kcm.example" not in body and NAME not in body
    assert list(edb.execute("SELECT * FROM check_hash_chain()").fetchall()) == []
    # The encrypted blob stays in the event store but cannot be read without the key.
    blob = edb.execute("SELECT payload FROM event WHERE stream_id = %s AND event_type = 'EntityIdentified'",
                       (person,)).fetchone()["payload"]["personal"]
    assert personal.decrypt(edb, person, blob) is None
    # A second erasure and a new contact for the erased person fail.
    assert api.post(f"/api/persons/{person}/erase", headers=tokens("admin"), json={"reason": "again"}).status_code == 422
    r = api.post(f"/api/deals/{deal['id']}/contacts", headers=tokens("analyst"),
                 json={"person_id": person, "role": "x", "found_via": "y"})
    assert r.status_code == 422
    edb.commit()


def test_an_engagement_event_with_clear_personal_fields_is_refused(edb):
    from services.governance.event_store import EventValidationError, validate_payload

    with pytest.raises(EventValidationError):
        validate_payload("ContactAdded", {"contact_id": "p1", "role": "r", "organisation_id": None, "found_via": "f",
                                          "email": "clear@example.test"})


def test_the_master_key_must_be_set(monkeypatch):
    from services.common.settings import get_settings

    monkeypatch.delenv("STRATA_MASTER_KEY", raising=False)
    get_settings.cache_clear()
    with pytest.raises(personal.PersonalDataUnavailable):
        personal.master_key()
    monkeypatch.setenv("STRATA_MASTER_KEY", "too-short")
    get_settings.cache_clear()
    with pytest.raises(personal.PersonalDataUnavailable):
        personal.master_key()
    get_settings.cache_clear()
