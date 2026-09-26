"""Sources, source health, known gaps, manual upload, brief versions and source proposals.

Source: docs/04-ingestion.md and docs/06-governance.md. A Viewer gets 403 on every write.
The API never returns the full text of a source whose licence is not full.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

from services.collectors import brief as brief_mod
from services.collectors.http import FetchError, ForbiddenDomainError, RobotsDisallowedError
from services.collectors.manual import ManualUploadError, ingest_file, ingest_url
from services.collectors.retention import text_is_public
from services.collectors.schedule import next_fire
from services.collectors.text import collectors_config
from services.common.db import connection
from services.common.storage import get_storage
from services.governance.source_proposals import ProposalError, ProposalForbidden, approve_source_proposal

from ..auth import User, require_admin, require_analyst, require_viewer

router = APIRouter(prefix="/api", tags=["sources"])


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime) else value


# ---------- source health and known gaps ----------


@router.get("/sources/health")
def source_health(user: User = Depends(require_viewer)) -> dict:
    """For each source of the active brief: last success, error rate, documents per run, last error, next run."""
    window = collectors_config()["health"]["window_runs"]
    now = datetime.now(UTC)
    with connection() as conn:
        active = brief_mod.active_brief(conn)
        if active is None:
            return {"brief_version": None, "sources": [], "known_gaps": []}
        rows = conn.execute(
            """SELECT brief_source_id,
                 max(finished_at) FILTER (WHERE status = 'success') AS last_success_at,
                 max(started_at) AS last_run_at,
                 count(*) AS runs,
                 count(*) FILTER (WHERE status = 'failed') AS failed_runs,
                 avg(documents_found) AS documents_per_run,
                 avg(documents_new) AS new_per_run
               FROM (SELECT *, row_number() OVER (PARTITION BY brief_source_id ORDER BY started_at DESC) AS rn
                     FROM collector_run WHERE status IN ('success', 'failed')) r
               WHERE rn <= %s GROUP BY brief_source_id""",
            (window,),
        ).fetchall()
        last_errors = conn.execute(
            """SELECT DISTINCT ON (brief_source_id) brief_source_id, error, started_at FROM collector_run
               WHERE error IS NOT NULL ORDER BY brief_source_id, started_at DESC"""
        ).fetchall()
        last_runs = conn.execute(
            """SELECT DISTINCT ON (brief_source_id) brief_source_id, status, documents_found, documents_new
               FROM collector_run WHERE status IN ('success', 'failed') ORDER BY brief_source_id, started_at DESC"""
        ).fetchall()
    stats = {r["brief_source_id"]: r for r in rows}
    errors = {r["brief_source_id"]: r for r in last_errors}
    last = {r["brief_source_id"]: r for r in last_runs}
    out = []
    for s in brief_mod.brief_sources(active["content"]):
        st = stats.get(s.id)
        err = errors.get(s.id)
        lr = last.get(s.id)
        out.append({
            "id": s.id, "name": s.name, "kind": s.kind, "section": s.section, "source_type": s.source_type,
            "url": s.url, "schedule": s.schedule, "licence_code": s.licence_code,
            "retention_policy": s.retention_policy,
            "last_success_at": _iso(st["last_success_at"]) if st else None,
            "last_run_at": _iso(st["last_run_at"]) if st else None,
            "last_status": lr["status"] if lr else None,
            "runs": st["runs"] if st else 0,
            "error_rate": round(st["failed_runs"] / st["runs"], 4) if st and st["runs"] else None,
            "documents_per_run": round(float(st["documents_per_run"]), 2) if st and st["documents_per_run"] is not None else None,
            "new_per_run": round(float(st["new_per_run"]), 2) if st and st["new_per_run"] is not None else None,
            "last_documents_found": lr["documents_found"] if lr else None,
            "last_error": err["error"] if err else None,
            "last_error_at": _iso(err["started_at"]) if err else None,
            "next_run_at": next_fire(s.schedule, now).isoformat(),
        })
    return {"brief_version": active["version"], "brief_version_id": active["id"], "sources": out,
            "known_gaps": active["content"].get("known_gaps") or []}


@router.get("/sources/known-gaps")
def known_gaps(user: User = Depends(require_viewer)) -> dict:
    with connection() as conn:
        active = brief_mod.active_brief(conn)
    if active is None:
        return {"brief_version": None, "known_gaps": []}
    return {"brief_version": active["version"], "known_gaps": active["content"].get("known_gaps") or []}


# ---------- manual upload ----------


class ManualUrl(BaseModel):
    url: str = Field(pattern=r"^https?://")
    title: str | None = None
    publisher: str | None = None
    licence_code: str | None = None


def _manual_response(result) -> dict:
    return {"source_id": result.source_id, "status": result.status, "duplicate_of": result.duplicate_of}


_MANUAL_BODY = {
    "requestBody": {
        "required": True,
        "content": {
            "application/json": {"schema": ManualUrl.model_json_schema()},
            "multipart/form-data": {"schema": {
                "type": "object", "required": ["file"],
                "properties": {"file": {"type": "string", "format": "binary"}, "title": {"type": "string"},
                               "publisher": {"type": "string"}, "licence_code": {"type": "string"},
                               "url": {"type": "string"}}}},
        },
    }
}


@router.post("/sources/manual", status_code=status.HTTP_201_CREATED, openapi_extra=_MANUAL_BODY)
async def manual_upload(
    request: Request,
    user: User = Depends(require_analyst),
) -> dict:
    """An analyst uploads a file (multipart: file, title, publisher, licence_code, url) or a URL (JSON)."""
    ctype = request.headers.get("content-type", "")
    try:
        if ctype.startswith("multipart/form-data"):
            form = await request.form()
            upload = form.get("file")
            if upload is None or not hasattr(upload, "read"):
                raise HTTPException(422, "multipart upload needs a file field")
            data = await upload.read()
            if not data:
                raise HTTPException(422, "the file is empty")
            with connection() as conn:
                result = ingest_file(
                    conn, data=data, filename=upload.filename or "upload", content_type=upload.content_type,
                    user_id=user.id, title=form.get("title") or None, publisher=form.get("publisher") or None,
                    licence_code=form.get("licence_code") or None, url=form.get("url") or None,
                )
            return _manual_response(result)
        body = ManualUrl.model_validate(await request.json())
        with connection() as conn:
            result = ingest_url(conn, url=body.url, user_id=user.id, title=body.title, publisher=body.publisher,
                                licence_code=body.licence_code)
        return _manual_response(result)
    except ForbiddenDomainError as exc:
        raise HTTPException(422, f"{exc}. Upload the file instead") from exc
    except RobotsDisallowedError as exc:
        raise HTTPException(422, f"{exc}. Upload the file instead") from exc
    except FetchError as exc:
        raise HTTPException(502, str(exc)) from exc
    except ManualUploadError as exc:
        raise HTTPException(422, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


# ---------- one source ----------


@router.get("/sources/{source_id}")
def get_source(source_id: str, user: User = Depends(require_viewer)) -> dict:
    with connection() as conn:
        row = conn.execute("SELECT * FROM source WHERE id = %s", (source_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "source not found")
        urls = conn.execute(
            "SELECT url, brief_source_id, seen_at FROM source_url WHERE source_id = %s ORDER BY seen_at, id",
            (source_id,),
        ).fetchall()
        brief = conn.execute("SELECT version FROM monitoring_brief_version WHERE id = %s",
                             (row["brief_version_id"],)).fetchone() if row["brief_version_id"] else None
    out = {
        "id": row["id"], "type": row["type"], "url": row["url"], "title": row["title"],
        "publisher": row["publisher"], "published_at": _iso(row["published_at"]),
        "fetched_at": _iso(row["fetched_at"]), "licence_code": row["licence_code"],
        "retention_policy": row["retention_policy"], "brief_version_id": row["brief_version_id"],
        "brief_version": brief["version"] if brief else None, "brief_source_id": row["brief_source_id"],
        "content_hash": row["content_hash"], "duplicate_of": row["duplicate_of"], "excerpt": row["excerpt"],
        "text_length": row["text_length"], "page_map": row["page_map"], "language": row["language"],
        "ocr": row["ocr"], "read_at_source": row["read_at_source"], "purge_after": _iso(row["purge_after"]),
        "purged_at": _iso(row["purged_at"]),
        "metadata": {k: v for k, v in (row["metadata"] or {}).items() if k != "text"},
        "links": [{"url": u["url"], "brief_source_id": u["brief_source_id"], "seen_at": _iso(u["seen_at"])}
                  for u in urls],
        "text": None,
        "text_available": False,
    }
    if text_is_public(row["retention_policy"]) and row["text_uri"]:
        out["text"] = get_storage().get(row["text_uri"]).decode("utf-8")
        out["text_available"] = True
    return out


# ---------- brief versions ----------


def _brief_summary(row: dict, active_id: str | None) -> dict:
    return {"id": row["id"], "version": row["version"], "name": row["name"], "created_by": row["created_by"],
            "created_at": _iso(row["created_at"]), "parent_version_id": row["parent_version_id"],
            "change_note": row["change_note"], "content_hash": row["content_hash"], "active": row["id"] == active_id}


@router.get("/briefs")
def list_briefs(user: User = Depends(require_viewer)) -> dict:
    with connection() as conn:
        active = brief_mod.active_brief(conn)
        rows = conn.execute("SELECT * FROM monitoring_brief_version ORDER BY version DESC").fetchall()
    active_id = active["id"] if active else None
    return {"active_version": active["version"] if active else None,
            "versions": [_brief_summary(r, active_id) for r in rows]}


@router.get("/briefs/diff")
def brief_diff(from_: int = Query(alias="from"), to: int = Query(), user: User = Depends(require_viewer)) -> dict:
    with connection() as conn:
        a = brief_mod.get_version(conn, from_)
        b = brief_mod.get_version(conn, to)
    if a is None or b is None:
        raise HTTPException(404, "brief version not found")
    return {"from": from_, "to": to, "changes": brief_mod.diff(a["content"], b["content"])}


@router.get("/briefs/{version}")
def get_brief(version: int, user: User = Depends(require_viewer)) -> dict:
    with connection() as conn:
        row = brief_mod.get_version(conn, version)
        active = brief_mod.active_brief(conn)
    if row is None:
        raise HTTPException(404, "brief version not found")
    return {**_brief_summary(row, active["id"] if active else None), "content": row["content"], "yaml": row["yaml"]}


class NewBrief(BaseModel):
    yaml: str = Field(min_length=1)
    change_note: str | None = None
    activate: bool = False


@router.post("/briefs", status_code=status.HTTP_201_CREATED)
def create_brief(body: NewBrief, user: User = Depends(require_admin)) -> dict:
    with connection() as conn:
        try:
            row, created = brief_mod.create_version_from_yaml(conn, body.yaml, created_by=user.id,
                                                              change_note=body.change_note)
        except brief_mod.BriefValidationError as exc:
            conn.rollback()
            raise HTTPException(422, {"errors": exc.errors}) from exc
        if body.activate:
            brief_mod.activate(conn, row["id"], actor_type="human", actor_id=user.id)
        conn.commit()
        active = brief_mod.active_brief(conn)
    return {**_brief_summary(row, active["id"] if active else None), "created": created}


@router.post("/briefs/{version}/activate")
def activate_brief(version: int, user: User = Depends(require_admin)) -> dict:
    with connection() as conn:
        row = brief_mod.get_version(conn, version)
        if row is None:
            raise HTTPException(404, "brief version not found")
        brief_mod.activate(conn, row["id"], actor_type="human", actor_id=user.id)
        conn.commit()
    return {**_brief_summary(row, row["id"])}


# ---------- source proposals ----------


class Decision(BaseModel):
    reason: str | None = None


@router.post("/proposals/{proposal_id}/approve-source")
def approve_source(proposal_id: str, body: Decision | None = None, user: User = Depends(require_admin)) -> dict:
    """Approve a SourceProposed proposal: a new brief version with the source, active at once."""
    with connection() as conn:
        try:
            new_version = approve_source_proposal(conn, proposal_id, user_id=user.id,
                                                  reason=body.reason if body else None)
        except LookupError as exc:
            conn.rollback()
            raise HTTPException(404, str(exc)) from exc
        except ProposalForbidden as exc:
            conn.rollback()
            raise HTTPException(403, str(exc)) from exc
        except (ProposalError, brief_mod.BriefValidationError) as exc:
            conn.rollback()
            raise HTTPException(409, str(exc)) from exc
        conn.commit()
    return {"proposal_id": proposal_id, "status": "approved", "brief_version": new_version["version"],
            "brief_version_id": new_version["id"]}
