"""Live updates. The database sends NOTIFY on each event insert. The API sends it to each browser with SSE."""

from __future__ import annotations

import asyncio
import json
import logging

import psycopg

from services.common.settings import get_settings

logger = logging.getLogger("strata.live")


class Broadcaster:
    def __init__(self) -> None:
        self._queues: set[asyncio.Queue] = set()
        self._task: asyncio.Task | None = None

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._queues.discard(q)

    def publish(self, message: dict) -> None:
        for q in list(self._queues):
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                pass

    async def _listen(self) -> None:
        while True:
            try:
                aconn = await psycopg.AsyncConnection.connect(get_settings().database_url, autocommit=True)
                async with aconn:
                    await aconn.execute("LISTEN strata_event")
                    await aconn.execute("LISTEN strata_live")
                    async for notify in aconn.notifies():
                        try:
                            payload = json.loads(notify.payload)
                        except json.JSONDecodeError:
                            continue
                        payload["channel"] = notify.channel
                        self.publish(payload)
            except asyncio.CancelledError:
                raise
            except Exception:  # reconnect after a database restart
                logger.exception("live listener failed, retrying")
                await asyncio.sleep(2)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._listen())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None


broadcaster = Broadcaster()


def alert_message(message: dict, user_id: str | None = None) -> dict:
    """Add the alert and its status to a live message of stream 'alert' (docs/06: the alert shows its status in
    every place where it appears). A Tier 0 alert arrives with the status unconfirmed before any approval."""
    from services.common.db import connection

    try:
        with connection() as conn:
            row = conn.execute(
                "SELECT id, tier, tier_rule, title, status, signal_id, source_id, stream_type, stream_id, raised_at "
                "FROM proj_alert WHERE id = %s", (message.get("stream_id"),),
            ).fetchone()
    except Exception:  # the stream must go on without the extra fields
        logger.exception("live alert lookup failed")
        return message
    if row is None:
        return message
    alert = {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in dict(row).items()}
    return {**message, "alert": alert, "alert_status": alert["status"]}


def record_alert_delivery(alert_id: str, user_id: str) -> None:
    """Telemetry: the first time that the live stream sends an alert to a connected client."""
    from services.common.db import connection
    from services.governance.alerts import record_frontend_delivery

    try:
        with connection() as conn:
            record_frontend_delivery(conn, alert_id, {"user_id": user_id})
            conn.commit()
    except Exception:
        logger.exception("alert delivery record failed", extra={"alert_id": alert_id})
