"""The only writer of the canonical record.

Agents and analysts write proposals. The governance service calls append_event.
Each payload is checked against config/event-schemas.yaml before insert.
The database adds the sequence and the hash chain, and rejects facts without verified evidence.
"""

from __future__ import annotations

import json
from datetime import datetime
from functools import lru_cache
from typing import Any

import jsonschema
import psycopg
from psycopg.types.json import Jsonb

from services.common.config import load_yaml
from services.common.ids import new_id


class EventValidationError(ValueError):
    pass


@lru_cache
def _schemas() -> dict:
    return load_yaml("event-schemas.yaml")


def validate_payload(event_type: str, payload: dict) -> None:
    doc = _schemas()
    schema = doc["schemas"].get(event_type)
    if schema is None:
        raise EventValidationError(f"unknown event type {event_type}")
    full = dict(schema)
    full["definitions"] = doc.get("definitions", {})
    try:
        jsonschema.validate(payload, full)
    except jsonschema.ValidationError as exc:
        raise EventValidationError(f"{event_type}: {exc.message}") from exc


def append_event(
    conn: psycopg.Connection,
    *,
    stream_type: str,
    stream_id: str,
    event_type: str,
    payload: dict[str, Any],
    actor_type: str,
    actor_id: str,
    evidence_ids: list[str] | tuple[str, ...] = (),
    certainty: str | None = None,
    model_id: str | None = None,
    prompt_version: str | None = None,
    proposal_id: str | None = None,
    brief_version_id: str | None = None,
    supersedes_event_id: str | None = None,
    occurred_at: datetime | str | None = None,
    project: bool = True,
) -> dict:
    """Insert one event and update the projections in the same transaction. The caller commits."""
    validate_payload(event_type, payload)
    event_id = new_id()
    # Round-trip through JSON so the stored payload and the projector see the same values.
    payload = json.loads(json.dumps(payload, default=str))
    row = conn.execute(
        """
        INSERT INTO event (id, stream_type, stream_id, sequence, event_type, payload, evidence_ids, certainty,
                           actor_type, actor_id, model_id, prompt_version, proposal_id, brief_version_id,
                           supersedes_event_id, occurred_at, hash)
        VALUES (%s, %s, %s, 0, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, '')
        RETURNING *
        """,
        (
            event_id, stream_type, stream_id, event_type, Jsonb(payload), list(evidence_ids), certainty,
            actor_type, actor_id, model_id, prompt_version, proposal_id, brief_version_id,
            supersedes_event_id, occurred_at,
        ),
    ).fetchone()
    if project:
        from services.projections.projector import apply_event

        apply_event(conn, row)
    return row


def stream_events(conn: psycopg.Connection, stream_type: str, stream_id: str, as_of: datetime | None = None) -> list[dict]:
    if as_of is None:
        return conn.execute(
            "SELECT * FROM event WHERE stream_type = %s AND stream_id = %s ORDER BY sequence",
            (stream_type, stream_id),
        ).fetchall()
    return conn.execute(
        "SELECT * FROM event WHERE stream_type = %s AND stream_id = %s AND recorded_at <= %s ORDER BY sequence",
        (stream_type, stream_id, as_of),
    ).fetchall()
