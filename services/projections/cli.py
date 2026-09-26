"""Command line tools: rebuild projections and check the hash chain."""

from __future__ import annotations

import argparse
import json
import sys

from services.common.db import connect

from .projector import projection_hashes, rebuild


def main() -> int:
    parser = argparse.ArgumentParser(prog="strata-projections")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("rebuild", help="Delete all projections and replay all events")
    sub.add_parser("hashes", help="Print the hash of each projection")
    sub.add_parser("check-chain", help="Check the hash chain of every stream")
    args = parser.parse_args()
    with connect() as conn:
        if args.cmd == "rebuild":
            before = projection_hashes(conn)
            n = rebuild(conn)
            after = projection_hashes(conn)
            conn.commit()
            print(json.dumps({"events_replayed": n, "unchanged": before == after, "hashes": after}, indent=2))
            return 0
        if args.cmd == "hashes":
            print(json.dumps(projection_hashes(conn), indent=2))
            return 0
        if args.cmd == "check-chain":
            breaks = conn.execute("SELECT * FROM check_hash_chain()").fetchall()
            total = conn.execute("SELECT count(*) AS n, count(DISTINCT (stream_type, stream_id)) AS s FROM event").fetchone()
            print(json.dumps({"events": total["n"], "streams": total["s"], "breaks": len(breaks), "detail": breaks}, default=str, indent=2))
            return 1 if breaks else 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
