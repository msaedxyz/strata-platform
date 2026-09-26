"""Quarantine records of the enrichment agents (docs/05-enrichment.md, criterion 5).

Each record shows its reason code and the description of the code from config/agent-schemas.yaml.
Read access needs the viewer role.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from services.common.db import connection
from services.enrichment import config as enrichment_config

from ..auth import User, require_viewer

router = APIRouter(prefix="/api", tags=["quarantine"])


class QuarantineRecord(BaseModel):
    id: str
    source_id: str | None
    agent: str
    reason_code: str
    reason: str | None
    detail: dict[str, Any]
    output: Any | None = None
    model_id: str | None
    prompt_version: str | None
    run_id: str | None
    created_at: datetime
    source_title: str | None = None
    source_url: str | None = None


class QuarantineList(BaseModel):
    items: list[QuarantineRecord]
    total: int
    reason_codes: dict[str, str]


def _reasons() -> dict[str, str]:
    return {r["code"]: r["description"] for r in enrichment_config.agent_schemas()["quarantine_reason_codes"]}


def _record(row: dict, reasons: dict[str, str], with_output: bool) -> QuarantineRecord:
    return QuarantineRecord(
        id=row["id"], source_id=row["source_id"], agent=row["agent"], reason_code=row["reason_code"],
        reason=reasons.get(row["reason_code"]), detail=row["detail"] or {},
        output=row["output"] if with_output else None, model_id=row["model_id"], prompt_version=row["prompt_version"],
        run_id=row["run_id"], created_at=row["created_at"], source_title=row.get("title"), source_url=row.get("url"),
    )


@router.get("/quarantine", response_model=QuarantineList)
def list_quarantine(
    reason_code: str | None = Query(None),
    agent: str | None = Query(None),
    source_id: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(require_viewer),
) -> QuarantineList:
    where, params = [], []
    for column, value in (("q.reason_code", reason_code), ("q.agent", agent), ("q.source_id", source_id)):
        if value:
            where.append(f"{column} = %s")
            params.append(value)
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    with connection() as conn:
        total = conn.execute(f"SELECT count(*) AS n FROM quarantine q {clause}", params).fetchone()["n"]
        rows = conn.execute(
            f"""SELECT q.*, s.title, s.url FROM quarantine q LEFT JOIN source s ON s.id = q.source_id {clause}
                ORDER BY q.created_at DESC, q.id DESC LIMIT %s OFFSET %s""",
            [*params, limit, offset],
        ).fetchall()
    reasons = _reasons()
    return QuarantineList(items=[_record(r, reasons, False) for r in rows], total=total, reason_codes=reasons)


@router.get("/quarantine/{quarantine_id}", response_model=QuarantineRecord)
def get_quarantine(quarantine_id: str, user: User = Depends(require_viewer)) -> QuarantineRecord:
    with connection() as conn:
        row = conn.execute(
            "SELECT q.*, s.title, s.url FROM quarantine q LEFT JOIN source s ON s.id = q.source_id WHERE q.id = %s",
            (quarantine_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "no quarantine record")
    return _record(row, _reasons(), True)
