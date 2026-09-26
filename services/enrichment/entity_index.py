"""The entities that the extractor and the resolver know.

Two implementations give the same interface:

- MemoryIndex: a list of entity records. The evaluation builds it from brief v1 (no database).
- DbIndex: loads the projections (proj_entity, proj_project) and the pending new entities of open
  proposals. Its trigram candidates come from pg_trgm on proj_entity and proj_project.

The trigram similarity of MemoryIndex follows the pg_trgm method: lower case, words of letters and
digits, each word padded with two spaces in front and one space behind, similarity = shared / all.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .normalisers import normalise_name

_WORD = re.compile(r"[a-z0-9]+")


def trigrams(text: str) -> set[str]:
    grams: set[str] = set()
    for word in _WORD.findall(text.lower()):
        padded = f"  {word} "
        for i in range(len(padded) - 2):
            grams.add(padded[i:i + 3])
    return grams


def similarity(a: str, b: str) -> float:
    ta, tb = trigrams(a), trigrams(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


@dataclass
class EntityRecord:
    id: str
    type: str                      # organisation, site, project
    name: str
    aliases: list[str] = field(default_factory=list)
    key: str | None = None         # the brief key, when the brief gives the entity
    watch: str = "none"
    site_class: str | None = None
    status: str | None = None
    status_pending: str | None = None
    district: str | None = None
    province: str | None = None
    corridor: str | None = None
    country: str | None = None
    external_ids: dict = field(default_factory=dict)
    site_id: str | None = None     # projects: the site
    stage: str | None = None       # projects: the recorded stage
    stage_pending: str | None = None
    forecast_start: str | None = None
    pending: bool = False          # a new entity of an open proposal
    site_classes: list[str] = field(default_factory=list)  # organisations: classes of the sites they operate

    def surfaces(self) -> list[str]:
        return [s for s in dict.fromkeys([self.name, *self.aliases]) if s]

    def as_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


def short_names(records: list[EntityRecord]) -> dict[str, str]:
    """First words of site names that point to one site only ("Kansanshi" for "Kansanshi mine").

    config/enrichment-rules.yaml sets the rule: not a geography name, not in the stop list, one site only.
    """
    from . import config

    if not config.get("mentions.derive_site_short_names", False):
        return {}
    stop = set(config.get("mentions.short_name_stoplist", []))
    min_chars = int(config.get("mentions.short_name_min_chars", 5))
    geo_names = {re.sub(r"\s+(District|Province|corridor)$", "", g["name"]) for g in config.geographies()}
    seen: dict[str, set[str]] = {}
    for r in records:
        if r.type != "site":
            continue
        for surface in r.surfaces():
            first = surface.split()[0]
            if len(first) >= min_chars and first[0].isupper() and first.isalpha() and first not in stop \
                    and first not in geo_names:
                seen.setdefault(first, set()).add(r.id)
    all_surfaces = {s for r in records for s in r.surfaces()}
    return {w: next(iter(ids)) for w, ids in seen.items() if len(ids) == 1 and w not in all_surfaces}


class MemoryIndex:
    def __init__(self, records: list[EntityRecord]):
        self.records = {r.id: r for r in records}
        self.short_names = short_names(records)
        self._by_norm: dict[str, list[EntityRecord]] = {}
        for r in records:
            for surface in self.surfaces_of(r):
                self._by_norm.setdefault(normalise_name(surface), [])
                if r not in self._by_norm[normalise_name(surface)]:
                    self._by_norm[normalise_name(surface)].append(r)

    def surfaces_of(self, record: EntityRecord) -> list[str]:
        """Name, aliases and the derived short name of an entity."""
        extra = [w for w, eid in self.short_names.items() if eid == record.id]
        return record.surfaces() + extra

    # ----- lookups -----

    def get(self, entity_id: str | None) -> EntityRecord | None:
        return self.records.get(entity_id) if entity_id else None

    def all(self, types: list[str] | None = None) -> list[EntityRecord]:
        return [r for r in self.records.values() if types is None or r.type in types]

    def gazetteer(self) -> list[dict]:
        """Each surface (name or alias) with its entity."""
        out = []
        for r in self.records.values():
            for surface in r.surfaces():
                out.append({"surface": surface, "entity_id": r.id, "type": r.type, "name": r.name})
        return out

    def exact(self, text: str, types: list[str]) -> list[EntityRecord]:
        return [r for r in self._by_norm.get(normalise_name(text), []) if r.type in types]

    def by_external_id(self, text: str) -> list[EntityRecord]:
        out = []
        for r in self.records.values():
            for value in (r.external_ids or {}).values():
                if value and str(value) in text:
                    out.append(r)
        return out

    def candidates(self, text: str, types: list[str], limit: int, min_similarity: float) -> list[tuple[EntityRecord, float]]:
        scored = []
        norm = normalise_name(text)
        for r in self.records.values():
            if r.type not in types:
                continue
            best = max(similarity(norm, normalise_name(s)) for s in r.surfaces())
            if best >= min_similarity:
                scored.append((r, round(best, 4)))
        scored.sort(key=lambda x: (-x[1], x[0].id))
        return scored[:limit]

    def add(self, record: EntityRecord) -> None:
        """Add a new entity of this run, so that a second mention resolves to it."""
        self.records[record.id] = record
        for surface in record.surfaces():
            self._by_norm.setdefault(normalise_name(surface), []).append(record)


class DbIndex(MemoryIndex):
    """The projections of the canonical record and the pending new entities of open proposals."""

    def __init__(self, conn):
        self.conn = conn
        records: dict[str, EntityRecord] = {}
        rows = conn.execute(
            """SELECT p.id, p.type, p.name, p.aliases, p.watch, p.site_class, p.status, p.status_pending, p.district,
                      p.province, p.country, e.brief_key, e.external_ids,
                      (SELECT ev.payload->>'corridor' FROM event ev WHERE ev.stream_type = 'entity' AND ev.stream_id = p.id
                         AND ev.event_type = 'EntityIdentified' ORDER BY ev.sequence LIMIT 1) AS corridor
               FROM proj_entity p LEFT JOIN entity e ON e.id = p.id
               WHERE p.merged_into IS NULL AND p.type IN ('organisation', 'site', 'project')"""
        ).fetchall()
        for r in rows:
            records[r["id"]] = EntityRecord(
                id=r["id"], type=r["type"], name=r["name"], aliases=list(r["aliases"] or []), key=r["brief_key"],
                watch=r["watch"] or "none", site_class=r["site_class"], status=r["status"],
                status_pending=r["status_pending"], district=r["district"], province=r["province"],
                corridor=r["corridor"], country=r["country"], external_ids=r["external_ids"] or {},
            )
        for r in conn.execute(
            """SELECT r.subject_id, array_agg(DISTINCT s.site_class) AS classes FROM proj_relationship r
               JOIN proj_entity s ON s.id = r.object_id AND s.type = 'site'
               WHERE r.predicate = 'operates' AND r.superseded_by IS NULL GROUP BY r.subject_id"""
        ).fetchall():
            if r["subject_id"] in records:
                records[r["subject_id"]].site_classes = sorted(c for c in r["classes"] if c)
        for r in conn.execute(
            "SELECT id, name, site_id, stage, forecast_start FROM proj_project"
        ).fetchall():
            watch = records[r["site_id"]].watch if r["site_id"] in records else "none"
            records[r["id"]] = EntityRecord(
                id=r["id"], type="project", name=r["name"], site_id=r["site_id"], stage=r["stage"], watch=watch,
                forecast_start=r["forecast_start"].isoformat() if r["forecast_start"] else None,
            )
        # New entities and stage changes that wait for approval.
        for p in conn.execute(
            "SELECT id, events FROM proposal WHERE status = 'pending' AND kind IN ('EntityIdentified', 'ProjectStageChanged')"
        ).fetchall():
            for ev in p["events"]:
                if ev["event_type"] == "EntityIdentified" and ev["stream_id"] not in records:
                    pl = ev["payload"]
                    records[ev["stream_id"]] = EntityRecord(
                        id=ev["stream_id"], type=pl["entity_type"], name=pl["name"], aliases=list(pl.get("aliases") or []),
                        site_id=pl.get("site_id"), pending=True,
                    )
                elif ev["event_type"] == "ProjectStageChanged" and ev["stream_id"] in records:
                    records[ev["stream_id"]].stage_pending = ev["payload"]["to_stage"]
        super().__init__(list(records.values()))

    def candidates(self, text: str, types: list[str], limit: int, min_similarity: float) -> list[tuple[EntityRecord, float]]:
        norm = normalise_name(text)
        rows = self.conn.execute(
            """SELECT id, max(sim) AS sim FROM (
                 SELECT p.id, greatest(similarity(p.normalised_name, %(q)s),
                          coalesce((SELECT max(similarity(lower(a), %(q)s)) FROM unnest(p.aliases) a), 0)) AS sim
                 FROM proj_entity p WHERE p.type = ANY(%(types)s) AND p.merged_into IS NULL
                 UNION ALL
                 SELECT j.id, similarity(lower(j.name), %(q)s) FROM proj_project j WHERE 'project' = ANY(%(types)s)
               ) c WHERE sim >= %(min)s GROUP BY id ORDER BY sim DESC, id LIMIT %(limit)s""",
            {"q": norm, "types": types, "min": min_similarity, "limit": limit},
        ).fetchall()
        out = [(self.records[r["id"]], round(float(r["sim"]), 4)) for r in rows if r["id"] in self.records]
        # Pending new entities are not in the projections yet.
        for rec in self.records.values():
            if rec.pending and rec.type in types:
                sim = max(similarity(norm, normalise_name(s)) for s in rec.surfaces())
                if sim >= min_similarity:
                    out.append((rec, round(sim, 4)))
        out.sort(key=lambda x: (-x[1], x[0].id))
        return out[:limit]


def brief_records(brief: dict) -> list[EntityRecord]:
    """Entity records for the watch lists and organisations of a brief. Ids are "site:<key>" and "org:<key>"."""
    records = []
    operated: dict[str, list[str]] = {}
    for level in ("daily", "weekly"):
        for site in (brief.get("watch") or {}).get(level) or []:
            if site.get("operator"):
                operated.setdefault(site["operator"], []).append(site.get("site_class"))
    for org in brief.get("organisations") or []:
        records.append(EntityRecord(
            id=f"org:{org['id']}", type="organisation", name=org["name"], aliases=list(org.get("aliases") or []),
            key=org["id"], country=org.get("country"), external_ids=org.get("external_ids") or {},
            site_classes=sorted(set(operated.get(org["id"], []))),
        ))
    for level in ("daily", "weekly"):
        for site in (brief.get("watch") or {}).get(level) or []:
            records.append(EntityRecord(
                id=f"site:{site['id']}", type="site", name=site["name"], aliases=list(site.get("aliases") or []),
                key=site["id"], watch=level, site_class=site.get("site_class"), district=site.get("district"),
                province=site.get("province"), corridor=site.get("corridor"), country="zm",
            ))
    return records
