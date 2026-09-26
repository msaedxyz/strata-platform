"""Tier 0 alerts. Source: docs/06-governance.md, Tier 0 alerts and alert telemetry.

A Tier 0 alert goes out at once. It has no approval gate: the governance service writes AlertRaised
with the status unconfirmed (the alert fold starts each alert as unconfirmed). An approver confirms or
dismisses it later.

raise_alert() writes one alert for each source and tier rule (idempotent). It records a "broadcast" row
for the channel frontend (the live SSE stream carries the event) and, when STRATA_SMTP_HOST is set, sends
an email and records the email delivery row with the send time. A failed email does not stop the pipeline.
The live stream records a "delivered" row when it sends the alert to a connected client.

acknowledge(), confirm() and dismiss() write the human events AlertAcknowledged, AlertConfirmed and
AlertDismissed. telemetry() gives the timestamps of each alert and the metrics of docs/06.
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
    # The NOTIFY of the insert trigger goes to the live stream at commit. The stream records "delivered"
    # when it sends the alert to a connected client (record_frontend_delivery).
    _record_delivery(conn, alert_id, "frontend", "broadcast", {"via": "live SSE stream", "event_id": row["id"]})
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


# ---------- decisions of users ----------


class AlertError(ValueError):
    pass


class AlertStateError(AlertError):
    """The alert is already decided. The API maps this error to HTTP 409."""


def _alert(conn: psycopg.Connection, alert_id: str) -> dict:
    row = conn.execute("SELECT * FROM proj_alert WHERE id = %s FOR UPDATE", (alert_id,)).fetchone()
    if row is None:
        raise LookupError(f"no alert {alert_id}")
    return row


def acknowledge(conn: psycopg.Connection, alert_id: str, user_id: str) -> dict:
    """An analyst acknowledges an alert: AlertAcknowledged with actor human. A second call writes nothing.

    The caller commits. Returns the alert projection.
    """
    alert = _alert(conn, alert_id)
    if alert["acknowledged_at"] is None:
        append_event(conn, stream_type="alert", stream_id=alert_id, event_type="AlertAcknowledged", payload={},
                     actor_type="human", actor_id=user_id)
        log(logger, logging.INFO, "alert acknowledged", alert_id=alert_id, user=user_id)
    return conn.execute("SELECT * FROM proj_alert WHERE id = %s", (alert_id,)).fetchone()


def _decide(conn: psycopg.Connection, alert_id: str, user_id: str, event_type: str, payload: dict) -> dict:
    alert = _alert(conn, alert_id)
    if alert["status"] != "unconfirmed":
        raise AlertStateError(f"alert {alert_id} is {alert['status']}")
    # The decision cites the evidence of the alert (docs/03: AlertConfirmed and AlertDismissed need evidence).
    append_event(conn, stream_type="alert", stream_id=alert_id, event_type=event_type, payload=payload,
                 actor_type="human", actor_id=user_id, evidence_ids=list(alert["evidence_ids"]))
    log(logger, logging.INFO, "alert decided", alert_id=alert_id, user=user_id, decision=event_type)
    return conn.execute("SELECT * FROM proj_alert WHERE id = %s", (alert_id,)).fetchone()


def confirm(conn: psycopg.Connection, alert_id: str, user_id: str, reason: str | None = None) -> dict:
    """An approver confirms an unconfirmed alert. The caller commits."""
    payload = {"reason": reason.strip()} if reason and reason.strip() else {}
    return _decide(conn, alert_id, user_id, "AlertConfirmed", payload)


def dismiss(conn: psycopg.Connection, alert_id: str, user_id: str, reason: str, false_positive: bool = False) -> dict:
    """An approver dismisses an unconfirmed alert, with a reason. false_positive marks a wrong alert."""
    if not reason or not reason.strip():
        raise AlertError("a dismissal needs a reason")
    return _decide(conn, alert_id, user_id, "AlertDismissed",
                   {"reason": reason.strip(), "false_positive": bool(false_positive)})


def record_frontend_delivery(conn: psycopg.Connection, alert_id: str, detail: dict | None = None) -> bool:
    """Record the first delivery of an alert to a connected client of the live stream. The caller commits."""
    exists = conn.execute(
        "SELECT 1 FROM alert_delivery WHERE alert_id = %s AND channel = 'frontend' AND status = 'delivered' LIMIT 1",
        (alert_id,),
    ).fetchone()
    if exists:
        return False
    _record_delivery(conn, alert_id, "frontend", "delivered", {"via": "live SSE stream", **(detail or {})})
    return True


# ---------- telemetry ----------


def percentile(values: list[float], p: float) -> float | None:
    """Linear interpolation between the closest ranks (the default method of numpy.percentile)."""
    if not values:
        return None
    ordered = sorted(values)
    k = (len(ordered) - 1) * p / 100
    lo = int(k)
    hi = min(lo + 1, len(ordered) - 1)
    return round(ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo), 3)


def _seconds(later, earlier) -> float | None:
    if later is None or earlier is None:
        return None
    return round((later - earlier).total_seconds(), 3)


def _stats(values: list[float]) -> dict:
    return {"n": len(values), "median": percentile(values, 50), "p90": percentile(values, 90)}


def telemetry(conn: psycopg.Connection, limit: int = 1000) -> dict:
    """The timestamps of each alert and the metrics of docs/06 (alert telemetry)."""
    alerts = conn.execute("SELECT * FROM proj_alert ORDER BY raised_at DESC LIMIT %s", (limit,)).fetchall()
    ids = [a["id"] for a in alerts]
    deliveries: dict[str, dict[str, dict]] = {}
    for d in conn.execute(
        "SELECT alert_id, channel, status, min(delivered_at) AS at FROM alert_delivery WHERE alert_id = ANY(%s) "
        "GROUP BY alert_id, channel, status", (ids,),
    ).fetchall():
        deliveries.setdefault(d["alert_id"], {}).setdefault(d["channel"], {})[d["status"]] = d["at"]
    items = []
    latency: list[float] = []
    ack: list[float] = []
    by_rule: dict[str, dict] = {}
    for a in alerts:
        chans = deliveries.get(a["id"], {})
        frontend = chans.get("frontend", {})
        email = chans.get("email", {})
        outcome = a["status"] if a["status"] != "unconfirmed" else None
        lat = _seconds(a["raised_at"], a["fetched_at"])
        tta = _seconds(a["acknowledged_at"], a["raised_at"])
        if lat is not None:
            latency.append(lat)
        if tta is not None:
            ack.append(tta)
        rule = by_rule.setdefault(a["tier_rule"], {"tier_rule": a["tier_rule"], "tier": a["tier"], "alerts": 0,
                                                    "decided": 0, "confirmed": 0, "dismissed": 0, "false_positive": 0})
        rule["alerts"] += 1
        if outcome:
            rule["decided"] += 1
            rule[outcome] += 1
        items.append({
            "id": a["id"], "tier": a["tier"], "tier_rule": a["tier_rule"], "title": a["title"], "status": a["status"],
            "outcome": outcome, "source_id": a["source_id"], "signal_id": a["signal_id"],
            "published_at": _iso(a["published_at"]), "fetched_at": _iso(a["fetched_at"]),
            "raised_at": _iso(a["raised_at"]),
            "delivered": {"frontend": _iso(frontend.get("delivered")), "frontend_broadcast": _iso(frontend.get("broadcast")),
                          "email": _iso(email.get("delivered"))},
            "delivery_status": {"frontend": "delivered" if "delivered" in frontend else ("broadcast" if frontend else None),
                                "email": "delivered" if "delivered" in email else (sorted(email)[0] if email else None)},
            "acknowledged_at": _iso(a["acknowledged_at"]), "acknowledged_by": a["acknowledged_by"],
            "decided_at": _iso(a["decided_at"]), "decided_by": a["decided_by"], "decision_reason": a["decision_reason"],
            "latency_fetch_to_alert_seconds": lat,
            "latency_publish_to_alert_seconds": _seconds(a["raised_at"], a["published_at"]),
            "time_to_acknowledgement_seconds": tta,
        })
    for rule in by_rule.values():
        rule["false_positive_rate"] = round(rule["false_positive"] / rule["decided"], 4) if rule["decided"] else None
    return {
        "items": items,
        "metrics": {
            "latency_fetch_to_alert_seconds": _stats(latency),
            "time_to_acknowledgement_seconds": _stats(ack),
            "false_positive_rate_by_tier_rule": sorted(by_rule.values(), key=lambda r: (r["tier"], r["tier_rule"])),
        },
    }
