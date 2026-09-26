"""Tier 0 alerts. Source: docs/06-governance.md, Tier 0 alerts and alert telemetry.

A Tier 0 alert goes out at once. It has no approval gate: the governance service writes AlertRaised
with the status unconfirmed (the alert fold starts each alert as unconfirmed). An approver confirms or
dismisses it later (M4).

raise_alert() writes one alert for each source and tier rule (idempotent). It records a delivery row
for the channel frontend (the live SSE stream carries the event) and, when STRATA_SMTP_HOST is set, sends
an email and records the email delivery row. A failed email does not stop the pipeline.
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

import psycopg
from psycopg.types.json import Jsonb

from services.common.ids import new_id
from services.common.logging import log
from services.common.settings import get_settings

from .event_store import append_event

logger = logging.getLogger("strata.governance.alerts")
ACTOR = "governance.alerts"


def _iso(value) -> str | None:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def find_alert(conn: psycopg.Connection, source_id: str, tier_rule: str) -> dict | None:
    return conn.execute(
        "SELECT * FROM event WHERE event_type = 'AlertRaised' AND payload->>'source_id' = %s "
        "AND payload->>'tier_rule' = %s LIMIT 1",
        (source_id, tier_rule),
    ).fetchone()


def _record_delivery(conn: psycopg.Connection, alert_id: str, channel: str, status: str, detail: dict) -> None:
    conn.execute(
        "INSERT INTO alert_delivery (id, alert_id, channel, status, detail) VALUES (%s, %s, %s, %s, %s)",
        (new_id(), alert_id, channel, status, Jsonb(detail)),
    )


def send_email(subject: str, body: str) -> tuple[str, dict]:
    """Send one alert email through SMTP. Returns (status, detail). Never raises."""
    s = get_settings()
    if not s.smtp_host:
        return "skipped", {"reason": "STRATA_SMTP_HOST is not set"}
    if not s.alert_email_to:
        return "failed", {"error": "STRATA_ALERT_EMAIL_TO is not set"}
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = s.alert_email_from
    msg["To"] = s.alert_email_to
    msg.set_content(body)
    try:
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=10) as smtp:
            smtp.send_message(msg)
    except (OSError, smtplib.SMTPException) as exc:
        return "failed", {"error": str(exc)}
    return "delivered", {"to": s.alert_email_to}


def raise_alert(
    conn: psycopg.Connection,
    *,
    source: dict,
    tier: int,
    tier_rule: str,
    title: str,
    evidence_ids: list[str],
    signal_id: str | None = None,
    related_stream_type: str | None = None,
    related_stream_id: str | None = None,
    brief_version_id: str | None = None,
    email: bool = True,
) -> tuple[dict, bool]:
    """Write AlertRaised at once (no approval gate). Returns (event row, created). The caller commits."""
    existing = find_alert(conn, source["id"], tier_rule)
    if existing:
        return existing, False
    alert_id = new_id()
    row = append_event(
        conn, stream_type="alert", stream_id=alert_id, event_type="AlertRaised",
        payload={
            "tier": tier, "tier_rule": tier_rule, "title": title[:500], "signal_id": signal_id, "source_id": source["id"],
            "related_stream_type": related_stream_type, "related_stream_id": related_stream_id,
            "published_at": _iso(source.get("published_at")), "fetched_at": _iso(source.get("fetched_at")),
            "status": "unconfirmed", "url": source.get("url"),
        },
        actor_type="system", actor_id=ACTOR, evidence_ids=evidence_ids, certainty=None,
        brief_version_id=brief_version_id or source.get("brief_version_id"),
    )
    _record_delivery(conn, alert_id, "frontend", "delivered", {"via": "live SSE stream", "event_id": row["id"]})
    if email and get_settings().smtp_host:
        status, detail = send_email(
            f"[Strata Tier {tier}] {title[:150]}",
            f"Tier {tier} alert ({tier_rule}). Status: unconfirmed.\n\n{title}\n\nSource: {source.get('url')}\n"
            f"Published: {_iso(source.get('published_at'))}\nFetched: {_iso(source.get('fetched_at'))}\n",
        )
        _record_delivery(conn, alert_id, "email", status, detail)
        if status != "delivered":
            log(logger, logging.WARNING, "alert email not delivered", alert_id=alert_id, **detail)
    log(logger, logging.INFO, "tier 0 alert raised", alert_id=alert_id, tier_rule=tier_rule, source_id=source["id"])
    return row, True
