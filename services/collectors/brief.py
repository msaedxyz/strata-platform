"""Monitoring Brief versions. Source: docs/04-ingestion.md.

Each version is immutable. A change makes a new version. The active version is the latest activation.
Each collector run reads the active version at its start and stamps its id on each source.
"""

from __future__ import annotations

import copy
import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any
from urllib.parse import urlencode

import jsonschema
import psycopg
import yaml
from croniter import croniter
from psycopg.types.json import Jsonb

from services.common.config import config_path, load_yaml
from services.common.ids import new_id, sha256_hex
from services.common.logging import log, setup_logging
from services.common.settings import get_settings

from .text import collectors_config

logger = logging.getLogger("strata.collectors.brief")

BRIEF_STREAM = ("brief", "main")
_VERSION_LINE = re.compile(r"^version:\s*\d+\s*$", re.MULTILINE)


class BriefValidationError(ValueError):
    def __init__(self, errors: list[str]) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors


# ---------- parse and validate ----------


@lru_cache
def brief_schema() -> dict:
    return load_yaml("monitoring-brief", "schema.yaml")


def parse_yaml(text: str) -> dict:
    try:
        content = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise BriefValidationError([f"YAML: {exc}"]) from exc
    if not isinstance(content, dict):
        raise BriefValidationError(["the brief must be a YAML mapping"])
    return content


def _valid_schedule(value: str) -> bool:
    return value in collectors_config()["schedules"] or croniter.is_valid(value)


def validate_brief(content: dict) -> None:
    """Check the JSON schema and the rules that a schema cannot give. Raise BriefValidationError."""
    validator = jsonschema.Draft202012Validator(brief_schema())
    errors = [f"{'/'.join(str(p) for p in e.absolute_path) or '(root)'}: {e.message}"
              for e in sorted(validator.iter_errors(content), key=lambda e: list(e.absolute_path))]
    if errors:
        raise BriefValidationError(errors)
    licences = content["licences"]
    sites = [s for level in ("daily", "weekly") for s in content["watch"][level]]
    org_ids = [o["id"] for o in content["organisations"]]
    site_ids = [s["id"] for s in sites]
    for label, ids in (("site", site_ids), ("organisation", org_ids)):
        dupes = sorted({i for i in ids if ids.count(i) > 1})
        if dupes:
            errors.append(f"duplicate {label} ids: {', '.join(dupes)}")
    for s in sites:
        for org in [s.get("operator"), *(s.get("owners") or [])]:
            if org and org not in org_ids:
                errors.append(f"watch/{s['id']}: unknown organisation {org}")
    gn = content["google_news"]
    if gn["licence_code"] not in licences:
        errors.append(f"google_news: unknown licence code {gn['licence_code']}")
    source_ids: list[str] = []
    for q in gn["queries"]:
        source_ids.append(q["id"])
        if not _valid_schedule(q["schedule"]):
            errors.append(f"google_news/{q['id']}: invalid schedule {q['schedule']}")
    for section, entries in content["sources"].items():
        for s in entries or []:
            source_ids.append(s["id"])
            if s["licence_code"] not in licences:
                errors.append(f"sources/{section}/{s['id']}: unknown licence code {s['licence_code']}")
            if not _valid_schedule(s["schedule"]):
                errors.append(f"sources/{section}/{s['id']}: invalid schedule {s['schedule']}")
    dupes = sorted({i for i in source_ids if source_ids.count(i) > 1})
    if dupes:
        errors.append(f"duplicate source ids: {', '.join(dupes)}")
    if errors:
        raise BriefValidationError(errors)


def content_hash(content: dict) -> str:
    """SHA-256 of the canonical JSON of the content. The version number is not part of the hash."""
    body = {k: v for k, v in content.items() if k != "version"}
    return sha256_hex(json.dumps(body, sort_keys=True, ensure_ascii=False, default=str))


def dump_yaml(content: dict) -> str:
    return yaml.safe_dump(content, sort_keys=False, allow_unicode=True, width=120)


def set_version_in_yaml(text: str, version: int) -> str:
    if _VERSION_LINE.search(text):
        return _VERSION_LINE.sub(f"version: {version}", text, count=1)
    return f"version: {version}\n{text}"


# ---------- store and activate ----------


def get_version(conn: psycopg.Connection, version: int) -> dict | None:
    return conn.execute("SELECT * FROM monitoring_brief_version WHERE version = %s", (version,)).fetchone()


def get_version_by_id(conn: psycopg.Connection, version_id: str) -> dict | None:
    return conn.execute("SELECT * FROM monitoring_brief_version WHERE id = %s", (version_id,)).fetchone()


def active_brief(conn: psycopg.Connection) -> dict | None:
    return conn.execute("SELECT * FROM active_brief").fetchone()


def next_version_number(conn: psycopg.Connection) -> int:
    row = conn.execute("SELECT coalesce(max(version), 0) + 1 AS n FROM monitoring_brief_version").fetchone()
    return row["n"]


def store_version(
    conn: psycopg.Connection,
    content: dict,
    yaml_text: str,
    *,
    created_by: str,
    parent_version_id: str | None = None,
    change_note: str | None = None,
) -> tuple[dict, bool]:
    """Insert a version. Idempotent by content hash: the same content gives the existing row.

    Returns (row, created). The caller commits.
    """
    validate_brief(content)
    digest = content_hash(content)
    existing = conn.execute(
        "SELECT * FROM monitoring_brief_version WHERE content_hash = %s ORDER BY version LIMIT 1", (digest,)
    ).fetchone()
    if existing:
        return existing, False
    same_number = get_version(conn, content["version"])
    if same_number:
        raise BriefValidationError([f"version {content['version']} exists with other content. Make a new version"])
    row = conn.execute(
        """INSERT INTO monitoring_brief_version (id, version, name, content, yaml, content_hash, created_by,
             parent_version_id, change_note)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (new_id(), content["version"], content["name"], Jsonb(content), yaml_text, digest, created_by,
         parent_version_id, change_note),
    ).fetchone()
    log(logger, logging.INFO, "brief version stored", version=row["version"], id=row["id"])
    return row, True


def create_version_from_yaml(
    conn: psycopg.Connection, yaml_text: str, *, created_by: str, change_note: str | None = None,
    parent_version_id: str | None = None,
) -> tuple[dict, bool]:
    """Make a new version from YAML text (the brief editor). The version number is the next free number."""
    content = parse_yaml(yaml_text)
    number = next_version_number(conn)
    content["version"] = number
    text = set_version_in_yaml(yaml_text, number)
    if parent_version_id is None:
        active = active_brief(conn)
        parent_version_id = active["id"] if active else None
    return store_version(conn, content, text, created_by=created_by, parent_version_id=parent_version_id,
                         change_note=change_note)


def derive_version(
    conn: psycopg.Connection,
    base: dict,
    change: Callable[[dict], None] | dict,
    *,
    created_by: str,
    change_note: str,
) -> dict:
    """Make a new version from an old version with changes. `change` is a function that edits a copy
    of the content, or a dict of top-level sections that replace the old sections. The caller commits."""
    content = copy.deepcopy(base["content"])
    if callable(change):
        change(content)
    else:
        content.update(copy.deepcopy(change))
    if content_hash(content) == base["content_hash"]:
        raise BriefValidationError(["the change gives the same content as the base version"])
    content["version"] = next_version_number(conn)
    row, _ = store_version(conn, content, dump_yaml(content), created_by=created_by, parent_version_id=base["id"],
                           change_note=change_note)
    return row


def activate(conn: psycopg.Connection, version_id: str, *, actor_type: str, actor_id: str) -> dict:
    """Make a version active: a brief_activation row and a BriefVersionActivated event. The caller commits."""
    from services.governance.event_store import append_event

    row = get_version_by_id(conn, version_id)
    if row is None:
        raise LookupError(f"brief version {version_id} does not exist")
    conn.execute(
        "INSERT INTO brief_activation (id, brief_version_id, activated_by) VALUES (%s, %s, %s)",
        (new_id(), version_id, actor_id),
    )
    append_event(
        conn, stream_type=BRIEF_STREAM[0], stream_id=BRIEF_STREAM[1], event_type="BriefVersionActivated",
        payload={"brief_version_id": version_id, "version": row["version"]}, actor_type=actor_type,
        actor_id=actor_id, brief_version_id=version_id,
    )
    log(logger, logging.INFO, "brief version activated", version=row["version"], id=version_id, actor=actor_id)
    return row


def load_brief_files(conn: psycopg.Connection) -> list[dict]:
    """Store each config/monitoring-brief/v*.yaml. Activate the highest version if none is active."""
    directory = config_path("monitoring-brief")
    files = sorted(directory.glob("v*.yaml"), key=lambda p: int(re.sub(r"\D", "", p.stem) or 0))
    rows: list[dict] = []
    parent: str | None = None
    for path in files:
        text = path.read_text(encoding="utf-8")
        content = parse_yaml(text)
        try:
            row, created = store_version(conn, content, text, created_by=f"file:{path.name}",
                                         parent_version_id=parent, change_note=f"Loaded from {path.name}")
        except BriefValidationError as exc:
            log(logger, logging.ERROR, "brief file not loaded", file=path.name, errors=exc.errors)
            continue
        rows.append(row)
        parent = row["id"]
    if rows and active_brief(conn) is None:
        highest = max(rows, key=lambda r: r["version"])
        activate(conn, highest["id"], actor_type="system", actor_id="collectors.brief.bootstrap")
    return rows


# ---------- diff ----------


def _keyed(items: list) -> dict | None:
    if items and all(isinstance(i, dict) and ("id" in i or "code" in i or "name" in i) for i in items):
        key = "id" if all("id" in i for i in items) else "code" if all("code" in i for i in items) else "name"
        keyed = {str(i[key]): i for i in items}
        if len(keyed) == len(items):
            return {"__key__": key, **keyed}
    return None


def diff(old: Any, new: Any, path: str = "") -> list[dict]:
    """Differences between two brief contents. Lists of entries with ids are matched by id."""
    changes: list[dict] = []
    if isinstance(old, dict) and isinstance(new, dict):
        for key in sorted(set(old) | set(new), key=str):
            sub = f"{path}.{key}" if path else str(key)
            if key not in old:
                changes.append({"path": sub, "op": "added", "to": new[key]})
            elif key not in new:
                changes.append({"path": sub, "op": "removed", "from": old[key]})
            else:
                changes.extend(diff(old[key], new[key], sub))
        return changes
    if isinstance(old, list) and isinstance(new, list):
        ko, kn = _keyed(old), _keyed(new)
        if ko is not None and kn is not None and ko["__key__"] == kn["__key__"]:
            key = ko.pop("__key__")
            kn.pop("__key__")
            for ident in list(ko) + [i for i in kn if i not in ko]:
                sub = f"{path}[{key}={ident}]"
                if ident not in kn:
                    changes.append({"path": sub, "op": "removed", "from": ko[ident]})
                elif ident not in ko:
                    changes.append({"path": sub, "op": "added", "to": kn[ident]})
                else:
                    changes.extend(diff(ko[ident], kn[ident], sub))
            return changes
        if old != new:
            added = [v for v in new if v not in old]
            removed = [v for v in old if v not in new]
            if added or removed:
                changes.append({"path": path, "op": "changed", "added": added, "removed": removed})
            else:
                changes.append({"path": path, "op": "changed", "from": old, "to": new})
        return changes
    if old != new:
        changes.append({"path": path, "op": "changed", "from": old, "to": new})
    return changes


# ---------- sources of a brief ----------


@dataclass
class BriefSource:
    id: str
    name: str
    kind: str                  # google_news, rss, atom, web, sitemap or pdf
    url: str
    schedule: str
    licence_code: str
    retention_policy: str
    section: str               # google_news, news, early_signal
    rate_limit_seconds: float | None = None
    source_type: str | None = None
    query: str | None = None
    publisher: str | None = None
    credentials_env: str | None = None
    extra: dict = field(default_factory=dict)

    @property
    def table_type(self) -> str:
        return collectors_config()["source_types"][self.kind]


def google_news_url(query: str, edition: dict, base_url: str | None = None) -> str:
    base = base_url or get_settings().google_news_base_url or collectors_config()["google_news"]["base_url"]
    return f"{base}?{urlencode({'q': query, 'hl': edition['hl'], 'gl': edition['gl'], 'ceid': edition['ceid']})}"


def retention_for(content: dict, licence_code: str) -> str:
    return content["licences"].get(licence_code, "verify_then_purge")


def brief_sources(content: dict, *, google_news_base_url: str | None = None) -> list[BriefSource]:
    """Every source that the collectors fetch for this brief. Proposed sources are not collected."""
    out: list[BriefSource] = []
    gn = content["google_news"]
    for q in gn["queries"]:
        licence = q.get("licence_code") or gn["licence_code"]
        out.append(BriefSource(
            id=q["id"], name=f"Google News: {q['q']}", kind="google_news",
            url=google_news_url(q["q"], gn["edition"], google_news_base_url), schedule=q["schedule"],
            licence_code=licence, retention_policy=retention_for(content, licence), section="google_news",
            rate_limit_seconds=collectors_config()["google_news"]["rate_limit_seconds"], query=q["q"],
            publisher="Google News",
        ))
    for section in ("news", "early_signal"):
        for s in content["sources"].get(section) or []:
            out.append(BriefSource(
                id=s["id"], name=s["name"], kind=s["type"], url=s["url"], schedule=s["schedule"],
                licence_code=s["licence_code"], retention_policy=retention_for(content, s["licence_code"]),
                section=section, rate_limit_seconds=s.get("rate_limit_seconds"), source_type=s.get("source_type"),
                publisher=s.get("publisher") or s["name"], credentials_env=s.get("credentials_env"),
                extra={k: v for k, v in s.items() if k not in {"id", "name", "type", "url", "schedule", "licence_code"}},
            ))
    return out


def find_source(content: dict, source_id: str, **kw) -> BriefSource | None:
    return next((s for s in brief_sources(content, **kw) if s.id == source_id), None)


# ---------- bootstrap ----------


def bootstrap() -> None:
    """Load the brief files and activate the highest version when none is active. Idempotent."""
    from services.common.db import connect

    setup_logging()
    with connect() as conn:
        rows = load_brief_files(conn)
        conn.commit()
        active = active_brief(conn)
    log(logger, logging.INFO, "brief bootstrap done", versions=[r["version"] for r in rows],
        active=active["version"] if active else None)
