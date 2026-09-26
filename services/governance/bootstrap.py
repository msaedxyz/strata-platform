"""Governance start-up step: the watch lists of the active brief become canonical entities.

1. The brief YAML text becomes a source document (type manual, licence full), so that each fact
   has an evidence span in that text.
2. Each watched site and each organisation gets an entity registry row and an EntityIdentified event.
   The evidence quote is the span of the YAML text that names the site or the organisation.
3. Each operator and owner link gets a RelationshipAsserted event with its evidence span.
4. Geometry comes only from the brief geometry, with its dataset and licence. A null geometry stays null.
5. The entries in sources.proposed become SourceProposed proposals for an admin.

Each step is idempotent.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import psycopg
import yaml
from psycopg.types.json import Jsonb

from services.collectors.brief import active_brief
from services.collectors.pipeline import Document, IngestContext, ingest
from services.collectors.text import content_hash, normalise
from services.common.ids import new_id, sha256_hex
from services.common.logging import log, setup_logging

from .event_store import append_event
from .source_proposals import create_source_proposal

logger = logging.getLogger("strata.governance.bootstrap")
ACTOR = "governance.bootstrap"
MAX_QUOTE = 500
BRIEF_LICENCE = "full"


@dataclass
class BriefDocument:
    source_id: str
    text: str
    root: yaml.Node
    brief: dict


# ---------- the brief as a source document ----------


def register_brief_document(conn: psycopg.Connection, brief: dict) -> BriefDocument:
    text = normalise(brief["yaml"])
    digest = content_hash(text)
    row = conn.execute("SELECT id FROM source WHERE content_hash = %s ORDER BY fetched_at LIMIT 1", (digest,)).fetchone()
    if row:
        source_id = row["id"]
    else:
        doc = Document(
            url=f"strata://monitoring-brief/v{brief['version']}.yaml",
            source_type="manual",
            text=text,
            title=f"Monitoring Brief v{brief['version']}: {brief['name']}",
            publisher=f"Strata Monitoring Brief v{brief['version']}",
            raw=brief["yaml"].encode("utf-8"),
            raw_content_type="application/yaml",
            metadata={"kind": "monitoring_brief", "brief_version_id": brief["id"], "version": brief["version"]},
        )
        ctx = IngestContext(brief_version_id=brief["id"], brief_source_id=f"brief:v{brief['version']}",
                            licence_code=BRIEF_LICENCE, retention_policy="full", enqueue=None)
        result = ingest(conn, doc, ctx)
        source_id = result.source_id
    return BriefDocument(source_id=source_id, text=text, root=yaml.compose(text), brief=brief)


# ---------- spans in the YAML text ----------


def _get(node: yaml.Node, key: str | int) -> yaml.Node | None:
    if isinstance(node, yaml.MappingNode) and isinstance(key, str):
        for k, v in node.value:
            if k.value == key:
                return v
    if isinstance(node, yaml.SequenceNode) and isinstance(key, int) and key < len(node.value):
        return node.value[key]
    return None


def _path(root: yaml.Node, *keys: str | int) -> yaml.Node | None:
    node: yaml.Node | None = root
    for key in keys:
        if node is None:
            return None
        node = _get(node, key)
    return node


def _key_span(entry: yaml.MappingNode, key: str) -> tuple[int, int] | None:
    for k, v in entry.value:
        if k.value == key:
            return k.start_mark.index, v.end_mark.index
    return None


def entry_span(entry: yaml.MappingNode, last_key: str, text: str) -> tuple[int, int]:
    """The span from the start of the entry to the end of the value of last_key, 500 characters at most.

    If that is too long, the span is the key and value of last_key only.
    """
    start = entry.start_mark.index
    kspan = _key_span(entry, last_key)
    end = kspan[1] if kspan else entry.end_mark.index
    while end > start and text[end - 1] in " \n":
        end -= 1
    if end - start <= MAX_QUOTE:
        return start, end
    if kspan and kspan[1] - kspan[0] <= MAX_QUOTE:
        return kspan
    return start, start + MAX_QUOTE


def record_evidence(conn: psycopg.Connection, doc: BriefDocument, span: tuple[int, int]) -> str:
    """Insert a verified evidence row for a span of the brief text. Idempotent by the span."""
    start, end = span
    quote = doc.text[start:end]
    if not quote or len(quote) > MAX_QUOTE:
        raise ValueError(f"invalid evidence span {span}")
    row = conn.execute(
        "SELECT id FROM evidence WHERE source_id = %s AND char_start = %s AND char_end = %s",
        (doc.source_id, start, end),
    ).fetchone()
    if row:
        return row["id"]
    evidence_id = new_id()
    conn.execute(
        "INSERT INTO evidence (id, source_id, char_start, char_end, quote, quote_hash, verified, verified_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, true, clock_timestamp())",
        (evidence_id, doc.source_id, start, end, quote, sha256_hex(quote)),
    )
    return evidence_id


# ---------- entities and relationships ----------


def _entity(conn: psycopg.Connection, entity_type: str, brief_key: str) -> dict | None:
    return conn.execute("SELECT * FROM entity WHERE type = %s AND brief_key = %s", (entity_type, brief_key)).fetchone()


def _has_event(conn: psycopg.Connection, stream_id: str, event_type: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM event WHERE stream_type = 'entity' AND stream_id = %s AND event_type = %s LIMIT 1",
        (stream_id, event_type),
    ).fetchone() is not None


def ensure_site(conn: psycopg.Connection, doc: BriefDocument, site: dict, watch: str, index: int) -> tuple[str, bool]:
    existing = _entity(conn, "site", site["id"])
    geometry = site.get("geometry")
    if existing:
        entity_id = existing["id"]
        if existing["watch"] != watch:
            conn.execute("UPDATE entity SET watch = %s WHERE id = %s", (watch, entity_id))
            conn.execute("UPDATE proj_entity SET watch = %s WHERE id = %s", (watch, entity_id))
    else:
        entity_id = new_id()
        geometry_source = None
        if geometry:
            geometry_source = {"dataset": geometry["dataset"], "dataset_url": geometry.get("dataset_url"),
                               "licence": geometry["licence"], "approximate": bool(geometry["approximate"]),
                               "brief_version_id": doc.brief["id"]}
        conn.execute(
            """INSERT INTO entity (id, type, site_class, watch, brief_key, geometry, geometry_source)
               VALUES (%s, 'site', %s, %s, %s,
                 CASE WHEN %s::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(%s::float8, %s::float8), 4326) END,
                 %s)""",
            (entity_id, site["site_class"], watch, site["id"],
             geometry["lon"] if geometry else None, geometry["lon"] if geometry else None,
             geometry["lat"] if geometry else None, Jsonb(geometry_source) if geometry_source else None),
        )
    if _has_event(conn, entity_id, "EntityIdentified"):
        return entity_id, False
    node = _path(doc.root, "watch", watch, index)
    last_key = "site_class" if _key_span(node, "site_class") else "name"
    evidence_id = record_evidence(conn, doc, entry_span(node, last_key, doc.text))
    append_event(
        conn, stream_type="entity", stream_id=entity_id, event_type="EntityIdentified",
        payload={"entity_type": "site", "name": site["name"], "aliases": list(site.get("aliases") or []),
                 "site_class": site["site_class"], "watch": watch, "district": site.get("district"),
                 "province": site.get("province"), "brief_key": site["id"],
                 "corridor": site.get("corridor"), "status_hint": site.get("status_hint")},
        actor_type="system", actor_id=ACTOR, evidence_ids=[evidence_id], certainty="stated",
        brief_version_id=doc.brief["id"],
    )
    return entity_id, True


def ensure_organisation(conn: psycopg.Connection, doc: BriefDocument, org: dict, index: int) -> tuple[str, bool]:
    existing = _entity(conn, "organisation", org["id"])
    if existing:
        entity_id = existing["id"]
    else:
        entity_id = new_id()
        conn.execute(
            "INSERT INTO entity (id, type, brief_key, external_ids) VALUES (%s, 'organisation', %s, %s)",
            (entity_id, org["id"], Jsonb(org.get("external_ids") or {})),
        )
    if _has_event(conn, entity_id, "EntityIdentified"):
        return entity_id, False
    node = _path(doc.root, "organisations", index)
    last_key = "aliases" if _key_span(node, "aliases") else "name"
    evidence_id = record_evidence(conn, doc, entry_span(node, last_key, doc.text))
    append_event(
        conn, stream_type="entity", stream_id=entity_id, event_type="EntityIdentified",
        payload={"entity_type": "organisation", "name": org["name"], "aliases": list(org.get("aliases") or []),
                 "country": org.get("country"), "external_ids": org.get("external_ids") or {},
                 "brief_key": org["id"], "role": org.get("role")},
        actor_type="system", actor_id=ACTOR, evidence_ids=[evidence_id], certainty="stated",
        brief_version_id=doc.brief["id"],
    )
    return entity_id, True


def ensure_relationship(conn: psycopg.Connection, doc: BriefDocument, subject_id: str, predicate: str,
                        object_id: str, node: yaml.MappingNode, key: str) -> bool:
    exists = conn.execute(
        "SELECT 1 FROM event WHERE event_type = 'RelationshipAsserted' AND payload->>'subject_id' = %s "
        "AND payload->>'predicate' = %s AND payload->>'object_id' = %s LIMIT 1",
        (subject_id, predicate, object_id),
    ).fetchone()
    if exists:
        return False
    evidence_id = record_evidence(conn, doc, entry_span(node, key, doc.text))
    append_event(
        conn, stream_type="entity", stream_id=object_id, event_type="RelationshipAsserted",
        payload={"subject_id": subject_id, "predicate": predicate, "object_id": object_id},
        actor_type="system", actor_id=ACTOR, evidence_ids=[evidence_id], certainty="stated",
        brief_version_id=doc.brief["id"],
    )
    return True


def load_watch_lists(conn: psycopg.Connection, doc: BriefDocument) -> dict:
    content = doc.brief["content"]
    counts = {"organisations": 0, "sites": 0, "relationships": 0}
    org_ids: dict[str, str] = {}
    for index, org in enumerate(content["organisations"]):
        org_ids[org["id"]], created = ensure_organisation(conn, doc, org, index)
        counts["organisations"] += created
    for watch in ("daily", "weekly"):
        for index, site in enumerate(content["watch"][watch]):
            site_id, created = ensure_site(conn, doc, site, watch, index)
            counts["sites"] += created
            node = _path(doc.root, "watch", watch, index)
            links = []
            if site.get("operator"):
                links.append(("operates", site["operator"], "operator"))
            links += [("owns", owner, "owners") for owner in site.get("owners") or []]
            for predicate, org_key, yaml_key in links:
                if org_key not in org_ids:
                    log(logger, logging.WARNING, "unknown organisation in brief", site=site["id"], org=org_key)
                    continue
                counts["relationships"] += ensure_relationship(conn, doc, org_ids[org_key], predicate, site_id,
                                                               node, yaml_key)
    # Sites of an older brief that the active brief does not watch get watch none.
    watched = [s["id"] for level in ("daily", "weekly") for s in content["watch"][level]]
    conn.execute("UPDATE entity SET watch = 'none' WHERE type = 'site' AND brief_key IS NOT NULL "
                 "AND NOT (brief_key = ANY(%s)) AND watch <> 'none'", (watched,))
    return counts


def load_proposed_sources(conn: psycopg.Connection, doc: BriefDocument) -> int:
    created_count = 0
    for index, entry in enumerate(doc.brief["content"]["sources"].get("proposed") or []):
        node = _path(doc.root, "sources", "proposed", index)
        last_key = "reason" if _key_span(node, "reason") else "url"
        evidence_id = record_evidence(conn, doc, entry_span(node, last_key, doc.text))
        _row, created = create_source_proposal(
            conn, entry, created_by_type="system", created_by=f"brief-v{doc.brief['version']}",
            evidence_ids=[evidence_id], source_id=doc.source_id, brief_version_id=doc.brief["id"],
        )
        created_count += created
    return created_count


def bootstrap_brief(conn: psycopg.Connection) -> dict:
    brief = active_brief(conn)
    if brief is None:
        return {"status": "no_active_brief"}
    doc = register_brief_document(conn, brief)
    counts = load_watch_lists(conn, doc)
    counts["proposals"] = load_proposed_sources(conn, doc)
    conn.commit()
    return {"status": "done", "brief_version": brief["version"], "source_id": doc.source_id, **counts}


def bootstrap() -> None:
    from services.common.db import connect

    setup_logging()
    with connect() as conn:
        result = bootstrap_brief(conn)
    log(logger, logging.INFO, "governance bootstrap done", **result)
