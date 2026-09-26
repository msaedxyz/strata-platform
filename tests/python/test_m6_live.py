"""docs/07 criterion 5 (API part): a new event reaches the live stream two seconds or less after the database commit.

The test runs the API in a uvicorn thread (the real /api/live SSE stream with its LISTEN connection), commits events
through the governance service and measures the time from the commit to the SSE message in the reader. The browser
part of the criterion (the module shows the event) is an M7 test on the Compose stack.
"""

from __future__ import annotations

import statistics
import time

import pytest

from services.common.db import connect
from services.governance import engagement

from .governance_support import SSEReader, make_deal

pytestmark = pytest.mark.db
LIMIT_SECONDS = 2.0


def test_c07_05_api_part_a_committed_event_reaches_the_live_stream_in_two_seconds_or_less(live_server, auth, edb_setup):
    reader = SSEReader(live_server.url, auth("viewer", sub="u-viewer-live")).start()
    delays: list[float] = []
    try:
        with connect(edb_setup["app_url"]) as conn:
            deal = make_deal(conn, title="Live latency deal")
            for n in range(5):
                result = engagement.log_touchpoint(conn, deal["id"], "u-analyst", kind="call", date="2026-09-26",
                                                   note=f"Live latency call {n}")
                committed = time.time()
                conn.commit()
                message = reader.wait_for(lambda m, eid=result["event_id"]: m["data"].get("id") == eid, timeout=10)
                assert message["event"] == "TouchpointLogged"
                assert message["data"]["stream_type"] == "deal" and message["data"]["stream_id"] == deal["id"]
                delays.append(message["received_at"] - committed)
    finally:
        reader.stop()
    assert max(delays) <= LIMIT_SECONDS, f"delays in seconds: {delays}"
    print(f"live stream delay after commit: median {statistics.median(delays):.3f} s, max {max(delays):.3f} s")
