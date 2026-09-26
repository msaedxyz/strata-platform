"""Volume data for docs/07 criteria 6 and 7 on the real stack: 10 000 signals and 500 deals.

Run it in the api container, so that the governance service writes each event:
    docker compose exec -T api python - --signals 10000 --deals 500 < tests/e2e/seed_volume.py

1. Each signal has its own synthetic source row (type manual, licence full, host volume.strata.test) and one verified
   evidence span: the title in the excerpt. The collectors and the agents do not run on these rows. Each source gets a
   "skipped" enrichment run, so that the enrichment sweep leaves it alone.
2. The events go through services.governance.event_store.append_event: SignalScored (stream source) and
   DealIdentified (stream deal). The projections update in the same transaction, like for any other event.
3. The script is idempotent. It counts the volume sources that exist and adds only the missing ones.
All text is invented test data. The script prints one JSON line with the counts.
"""

from __future__ import annotations

import argparse
import json
import random
import time
from datetime import UTC, datetime, timedelta

from psycopg.types.json import Jsonb

from services.common.db import connect
from services.common.ids import new_id, sha256_hex
from services.governance.event_store import append_event

KIND = "e2e_volume"
ACTOR = "tests.e2e.seed_volume"
SITES = ["Kansanshi", "Lumwana", "Mufulira", "Nchanga", "Konkola", "Kasumbalesa", "Mimbula", "Lubambe", "Chambishi"]
TOPICS = ["haulage tender", "fuel supply review", "fleet expansion", "contract mining award", "maintenance shutdown",
          "power supply upgrade", "road works", "border queue", "plant expansion", "drilling programme"]
DEAL_TYPES = ["fuel_supply_contract", "haulage_contract", "contract_mining", "tender", "eoi"]
STAGES = ["signal", "qualified", "contact_found", "approach", "relationship_active", "prequalification"]


def volume_sources(conn) -> list[dict]:
    return conn.execute(
        "SELECT s.id, s.title, v.id AS evidence_id FROM source s JOIN evidence v ON v.source_id = s.id "
        "WHERE s.metadata->>'kind' = %s ORDER BY s.id", (KIND,)).fetchall()


def add_signal(conn, i: int, now: datetime, rng: random.Random, fresh: bool = False) -> None:
    site, topic = rng.choice(SITES), rng.choice(TOPICS)
    title = f"Volume item {i:05d}: {site} {topic}"
    source_id = new_id()
    published = datetime.now(UTC) if fresh else now - timedelta(minutes=rng.randint(0, 60 * 24 * 60))
    url = f"https://volume.strata.test/item/{i:05d}"
    conn.execute(
        "INSERT INTO source (id, type, url, title, publisher, published_at, licence_code, retention_policy, content_hash, "
        "text_length, excerpt, metadata) VALUES (%s, 'manual', %s, %s, %s, %s, 'full', 'full', %s, %s, %s, %s)",
        (source_id, url, title, "Volume Wire (synthetic)", published, sha256_hex(f"{KIND}:{i}:{title}"), len(title), title,
         Jsonb({"kind": KIND, "synthetic": True})))
    evidence_id = new_id()
    conn.execute(
        "INSERT INTO evidence (id, source_id, char_start, char_end, quote, quote_hash, verified, verified_at) "
        "VALUES (%s, %s, 0, %s, %s, %s, true, clock_timestamp())",
        (evidence_id, source_id, len(title), title, sha256_hex(title)))
    conn.execute(
        "INSERT INTO enrichment_run (id, source_id, status, backend, finished_at, error) "
        "VALUES (%s, %s, 'skipped', 'none', clock_timestamp(), 'e2e volume data')", (new_id(), source_id))
    tier = 0 if i % 50 == 0 else 1 if i % 7 == 0 else 2
    append_event(
        conn, stream_type="source", stream_id=source_id, event_type="SignalScored",
        payload={"source_id": source_id, "title": title, "url": url, "publisher": "Volume Wire (synthetic)",
                 "published_at": published.isoformat(), "fetched_at": now.isoformat(), "tier": tier,
                 "tier_rule": {0: "t0_volume_test", 1: "t1_volume_test", 2: "t2_relevant"}[tier],
                 "score": round(rng.uniform(1, 12), 2), "breakdown": {"base": 1.0, "volume_test": True},
                 "sectors": ["mining"], "geographies": ["zm"], "themes": [], "directions": [], "deal_types": [],
                 "entity_ids": [], "summary": [{"text": title, "evidence_ids": [evidence_id]}], "read_at_source": False},
        actor_type="system", actor_id=ACTOR, evidence_ids=[evidence_id], certainty="stated", occurred_at=published)


def add_deal(conn, j: int, source: dict, rng: random.Random) -> None:
    deal_type = rng.choice(DEAL_TYPES)
    append_event(
        conn, stream_type="deal", stream_id=new_id(), event_type="DealIdentified",
        payload={"title": f"Volume deal {j:03d}: {source['title'].split(': ', 1)[1]}", "deal_type": deal_type,
                 "stage": rng.choice(STAGES), "site_id": None, "project_id": None, "organisation_id": None},
        actor_type="system", actor_id=ACTOR, evidence_ids=[source["evidence_id"]], certainty="stated")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--signals", type=int, default=10000)
    parser.add_argument("--deals", type=int, default=500)
    parser.add_argument("--batch", type=int, default=500)
    parser.add_argument("--delay-ms", type=int, default=0,
                        help="commit each signal on its own and wait this long after it (live updates for criterion 7)")
    args = parser.parse_args()
    if args.delay_ms:
        args.batch = 1
    rng = random.Random(20260926)
    started = time.monotonic()
    now = datetime.now(UTC)
    with connect() as conn:
        have = len(volume_sources(conn))
        for start in range(have, args.signals, args.batch):
            for i in range(start, min(start + args.batch, args.signals)):
                add_signal(conn, i, now, rng, fresh=bool(args.delay_ms))
            conn.commit()
            if args.delay_ms:
                time.sleep(args.delay_ms / 1000)
        sources = volume_sources(conn)
        have_deals = conn.execute("SELECT count(*) AS n FROM event WHERE event_type = 'DealIdentified' AND actor_id = %s",
                                  (ACTOR,)).fetchone()["n"]
        for j in range(have_deals, args.deals):
            add_deal(conn, j, sources[j % len(sources)], rng)
            if j % args.batch == args.batch - 1:
                conn.commit()
        conn.commit()
        signals = conn.execute("SELECT count(*) AS n FROM proj_signal").fetchone()["n"]
        deals = conn.execute("SELECT count(*) AS n FROM proj_deal").fetchone()["n"]
    print(json.dumps({"volume_sources": len(sources), "signals_total": signals, "deals_total": deals,
                      "seconds": round(time.monotonic() - started, 1)}))


if __name__ == "__main__":
    main()
