"""docs/09 scenario 3: two articles name one company in two different ways. Strata gives one entity. A proposal to
merge two existing entities goes to the approval queue.

Part 1: the acceptance wire has "Copperbelt Earthmoving Limited" and "Copperbelt Earthmoving Ltd". The worker
collects both in one run and enriches them.
Part 2: an admin adds the company to the brief organisations in a new brief version. The start-up step (the migrate
service) makes each brief organisation a canonical entity, so two entities have one name. An analyst adds a third
article as a manual source. The resolver never merges existing entities: an EntityMerged proposal waits for an
approver, and no EntityMerged event exists.
"""

from __future__ import annotations

import yaml

from .stack import FIXTURE_INTERNAL_URL, wait_for, wait_proposals, wait_signal

NAME = "copperbelt earthmoving"


def _entities(api) -> list[dict]:
    items = api.ok("/api/entities", q="Copperbelt Earthmoving", type="organisation", limit=50)["items"]
    return [e for e in items if e["name"].lower().startswith(NAME)]


def test_s03_part1_two_names_give_one_entity(api, acceptance):
    first = wait_signal(api, "copperbelt-earthmoving-load-and-haul", q="Copperbelt Earthmoving")
    second = wait_signal(api, "copperbelt-earthmoving-adds-trucks", q="Copperbelt Earthmoving")
    entities = _entities(api)
    assert len(entities) == 1, f"two names gave {len(entities)} entities: {[e['name'] for e in entities]}"
    assert entities[0]["id"] in first["entity_ids"] and entities[0]["id"] in second["entity_ids"]


def test_s03_part2_a_merge_of_two_existing_entities_goes_to_the_approval_queue(api, acceptance, compose):
    wait_signal(api, "copperbelt-earthmoving-adds-trucks", q="Copperbelt Earthmoving")
    # The entity that the agents found is canonical (an approver approves it when it waits).
    for p in api.proposals(kind="EntityIdentified", status="pending"):
        if p["title"].lower().startswith(f"new organisation: {NAME}"):
            assert api.post(f"/api/proposals/{p['id']}/approve", "approver").status_code == 200
    # The admin adds the company to the organisations of the brief.
    active = api.ok("/api/briefs")["active_version"]
    content = api.ok(f"/api/briefs/{active}")["content"]
    if not any(o["id"] == "copperbelt_earthmoving" for o in content["organisations"]):
        content["organisations"].append({"id": "copperbelt_earthmoving", "name": "Copperbelt Earthmoving Ltd",
                                         "aliases": [], "role": "contractor", "country": "zm", "external_ids": {}})
    r = api.post("/api/briefs", "admin", {"yaml": yaml.safe_dump(content, sort_keys=False, allow_unicode=True),
                                          "change_note": "E2E: add Copperbelt Earthmoving", "activate": True})
    assert r.status_code == 201, r.text[:500]
    # The start-up step runs again (docker compose run migrate). It is idempotent.
    compose.run("run", "--rm", "--no-deps", "migrate", timeout=600)
    entities = wait_for(lambda: (lambda es: es if len(es) >= 2 else None)(_entities(api)), timeout=60,
                        what="two existing entities named Copperbelt Earthmoving")
    ids = {e["id"] for e in entities}
    # An analyst adds a third article as a manual source (a URL on the fixture server).
    url = f"{FIXTURE_INTERNAL_URL}/news/copperbelt-earthmoving-fleet.html"
    r = api.post("/api/sources/manual", "analyst", {"url": url})
    assert r.status_code == 201, r.text[:500]
    source_id = r.json()["source_id"] or r.json()["duplicate_of"]
    proposals = wait_proposals(api, source_id, lambda ps: any(p["kind"] == "EntityMerged" for p in ps), timeout=300,
                               what="an EntityMerged proposal for the third article")
    merge = next(p for p in proposals if p["kind"] == "EntityMerged")
    assert merge["status"] == "pending" and merge["policy"] == "review"
    payload = merge["events"][0]["payload"]
    assert set(payload["merged_ids"]) | {payload["into_id"]} <= ids
    queue = api.proposals(status="pending", kind="EntityMerged")
    assert merge["id"] in {p["id"] for p in queue}
    for entity_id in ids:
        events = api.timeline("entity", entity_id)["items"]
        assert not any(e["event_type"] == "EntityMerged" for e in events), "a merge was written without approval"
