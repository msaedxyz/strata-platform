"""The analysis of one document by the seven agents, with the guardrails of docs/05.

analyse() has no database writes. It returns the verified output of each agent and the planned
proposals (facts). services/enrichment/persist.py writes the evidence rows, the proposals, the
quarantine rows and the alert. The evaluation (services/enrichment/eval.py) uses analyse() directly.

Guardrails in this module:
- Codes only from config/taxonomy (unknown_taxonomy_code), predicates only from predicates.yaml
  (unknown_predicate), stages only from config/lifecycle.yaml (unknown_stage).
- Each evidence quote must be the exact substring of the normalised text at its offsets (span_mismatch).
- Each extracted value must appear in its quote, and its normal form must match (value_not_in_quote,
  value_unparseable, value_mismatch).
- Only verified spans become evidence. A planned fact always carries verified spans.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from services.common import config as common_config

from . import config, forecaster, rules, scoring
from .entity_index import EntityRecord, MemoryIndex
from .normalisers import normalise_enum, normalise_name, normalise_value
from .runner import AgentRunner
from .spans import Span, SpanError, sentence_at, sentences, verify


@dataclass
class Doc:
    text: str
    title: str | None = None
    url: str | None = None
    publisher: str | None = None
    source_type: str = "manual"
    source_id: str | None = None
    published_at: datetime | None = None
    fetched_at: datetime | None = None
    read_at_source: bool = False
    early_signal: bool = False
    brief: dict = field(default_factory=dict)


@dataclass
class PlannedEvent:
    stream_type: str
    stream_id: str
    event_type: str
    payload: dict
    spans: list[Span]
    certainty: str | None = "stated"
    occurred_at: datetime | None = None


@dataclass
class Fact:
    kind: str
    agent: str
    title: str
    events: list[PlannedEvent]
    key: str
    force_review: bool = False
    new_entities: list[dict] = field(default_factory=list)


@dataclass
class Analysis:
    doc: Doc
    status: str = "pending"
    classification: dict | None = None
    directions: list[str] = field(default_factory=list)
    mentions: list[dict] = field(default_factory=list)
    claims: list[dict] = field(default_factory=list)
    claims_rejected: int = 0
    resolutions: list[dict] = field(default_factory=list)
    merges: list[dict] = field(default_factory=list)
    projects: list[dict] = field(default_factory=list)
    forecasts: list[dict] = field(default_factory=list)
    summary: list[dict] = field(default_factory=list)
    features: dict = field(default_factory=dict)
    breakdown: dict = field(default_factory=dict)
    score: float | None = None
    tier: int | None = None
    tier_rule: str | None = None
    judgement: float | None = None
    certainty: str = "stated"
    facts: list[Fact] = field(default_factory=list)
    signal_spans: list[Span] = field(default_factory=list)
    alert: dict | None = None
    entity_ids: list[str] = field(default_factory=list)
    deals: list[dict] = field(default_factory=list)


AGENT_ORDER = ["classifier", "extractor", "resolver", "lifecycle", "window_forecaster", "summariser", "scorer"]
ATTRIBUTE_PREDICATES = {"capex", "production_target", "tonnes_moved_per_year", "fleet_trucks", "generation_mw",
                        "employees", "expected_start", "licence_number", "ownership_percent"}
RELATIONSHIP_PREDICATES = {"operates", "owns", "buyer_role_owner", "buyer_role_epc_contractor",
                           "buyer_role_mining_contractor", "buyer_role_haulage_contractor", "buyer_role_fuel_supplier"}
DEAL_ATTRIBUTE_PREDICATES = {"tender_deadline", "contract_value"}


def _default_id_factory(kind: str, key: str) -> str:
    from services.common.ids import new_id

    return new_id()


class _Ctx:
    def __init__(self, doc: Doc, index: MemoryIndex, runner: AgentRunner, id_factory):
        self.doc = doc
        self.text = doc.text
        self.index = index
        self.runner = runner
        self.new_id = id_factory
        self.sents = sentences(doc.text)

    def verify_all(self, agent: str, items: list[dict]) -> list[Span]:
        out = []
        for item in items or []:
            try:
                out.append(verify(self.text, item))
            except SpanError as exc:
                self.runner.reject(agent, exc.reason_code, exc.detail, item)
        return out

    def sentence_span(self, start: int) -> Span:
        s = sentence_at(self.sents, start)
        if s is None:
            return Span(start, start + 1, self.text[start:start + 1])
        from .spans import clip

        return clip(self.text, s, s.start, s.end)


def entity_context(index: MemoryIndex) -> list[dict]:
    return [{"entity_id": r.id, "type": r.type, "surfaces": index.surfaces_of(r), "site_class": r.site_class,
             "district": r.district, "province": r.province, "corridor": r.corridor, "watch": r.watch,
             "site_classes": list(r.site_classes)}
            for r in index.all()]


# ---------------------------------------------------------------------------
# 1. Classifier
# ---------------------------------------------------------------------------


def _classify(c: _Ctx, a: Analysis, entities: list[dict]) -> bool:
    doc = c.doc
    themes = {}
    for act in config.activity_types():
        themes.setdefault(act["theme"], {"code": act["theme"], "direction": act["direction"], "keywords": []})
        themes[act["theme"]]["keywords"].append(act["keyword"])
    ctx = {
        "title": doc.title, "publisher": doc.publisher, "source_type": doc.source_type,
        "exclusions": list((doc.brief or {}).get("exclusions") or []),
        "codes": {k: sorted(v) for k, v in config.taxonomy_codes().items() if k != "themes"},
        "themes": list(themes.values()),
        "_entities": entities,
    }
    out = c.runner.run("classifier", c.text, ctx)
    if out is None:
        a.status = "quarantined"
        return False
    codes = config.taxonomy_codes()
    unknown = {f: [x for x in out.get(f, []) if x not in codes[f]] for f in codes}
    unknown = {k: v for k, v in unknown.items() if v}
    if unknown:
        c.runner.reject("classifier", "unknown_taxonomy_code", {"unknown": unknown}, out)
        c.runner.mark("classifier", "quarantined")
        a.status = "quarantined"
        return False
    spans = c.verify_all("classifier", out.get("evidence"))
    a.classification = out
    if not out["in_scope"]:
        a.status = "out_of_scope"
        return False
    if not spans:
        c.runner.reject("classifier", "no_evidence", {"reason": "in scope without verified evidence"}, out)
        c.runner.mark("classifier", "quarantined")
        a.status = "quarantined"
        return False
    a.signal_spans = spans
    directions = config.theme_directions()
    a.directions = sorted({directions[t] for t in out["themes"] if t in directions})
    return True


# ---------------------------------------------------------------------------
# 2. Extractor
# ---------------------------------------------------------------------------


def _value_check(c: _Ctx, claim: dict, quotes: list[str]) -> tuple[str | None, dict | None]:
    """The normal form of the claim value, or a reason code when the value does not match its quote."""
    pred = config.predicates()[claim["predicate"]]
    vtype = pred["value_type"]
    joined = "\n".join(quotes)
    if vtype == "entity":
        obj = claim.get("object")
        if not obj or obj not in joined:
            return None, {"reason": "value_not_in_quote", "object": obj}
        if claim.get("subject") and claim["subject"] not in joined and claim["subject"] not in c.text:
            return None, {"reason": "value_not_in_quote", "subject": claim["subject"]}
        return normalise_name(obj), None
    value_text = claim.get("value_text")
    if not value_text or value_text not in joined:
        return None, {"reason": "value_not_in_quote", "value_text": value_text}
    if vtype == "enum":
        allowed = config.site_statuses() if claim["predicate"] == "site_status" else config.lifecycle_stage_codes()
        value = normalise_enum(claim.get("value") or value_text)
        if value not in allowed:
            return None, {"reason": "value_unparseable", "value": claim.get("value")}
        if claim["predicate"] == "site_status":
            cues = [p for s, p in rules.compiled().status_cues if s == value]
            if not any(p.search(value_text) for p in cues) and value.replace("_", " ") not in value_text.lower():
                return None, {"reason": "value_mismatch", "value": value, "value_text": value_text}
        return value, None
    normal = normalise_value(vtype, value_text)
    if normal is None:
        return None, {"reason": "value_unparseable", "value_text": value_text, "value_type": vtype}
    if claim.get("value") not in (None, ""):
        given = normalise_value(vtype, claim["value"])
        if given != normal:
            return None, {"reason": "value_mismatch", "value": claim["value"], "value_text": value_text,
                          "normal_of_value": given, "normal_of_quote": normal}
    return normal, None


def _extract(c: _Ctx, a: Analysis, entities: list[dict]) -> None:
    ctx = {
        "title": c.doc.title,
        "predicates": [{"code": p["code"], "subject": p.get("subject"), "value_type": p["value_type"], "name": p["name"]}
                       for p in config.predicates().values()],
        "known_entities": [{"name": e["surfaces"][0], "type": e["type"], "aliases": e["surfaces"][1:]} for e in entities],
        "_entities": entities,
    }
    out = c.runner.run("extractor", c.text, ctx)
    if out is None:
        return
    for m in out["mentions"]:
        if c.text[m["start"]:m["end"]] != m["text"]:
            c.runner.reject("extractor", "span_mismatch", {"mention": m})
            continue
        a.mentions.append(m)
    preds = config.predicates()
    for claim in out["claims"]:
        if claim["predicate"] not in preds:
            c.runner.reject("extractor", "unknown_predicate", {"predicate": claim["predicate"]}, claim)
            a.claims_rejected += 1
            continue
        spans = []
        failed = False
        for item in claim["evidence"]:
            try:
                spans.append(verify(c.text, item))
            except SpanError as exc:
                c.runner.reject("extractor", exc.reason_code, exc.detail, claim)
                failed = True
        if failed or not spans:
            if not failed:
                c.runner.reject("extractor", "no_evidence", {"claim": claim["predicate"]}, claim)
            a.claims_rejected += 1
            continue
        normal, problem = _value_check(c, claim, [s.quote for s in spans])
        if problem:
            c.runner.reject("extractor", problem.pop("reason"), problem, claim)
            a.claims_rejected += 1
            continue
        a.claims.append({**claim, "normalised": normal, "spans": spans})


# ---------------------------------------------------------------------------
# 3. Resolver
# ---------------------------------------------------------------------------


def _resolve(c: _Ctx, a: Analysis) -> dict[tuple[str, str], dict]:
    t = config.rules()["resolver"]
    compat = t["type_compatibility"]
    groups: dict[tuple[str, str], dict] = {}
    for m in a.mentions:
        if m["type"] not in compat:
            continue
        key = (m["type"], normalise_name(m["text"]))
        if not key[1]:
            continue
        g = groups.setdefault(key, {"text": m["text"], "type": m["type"], "spans": []})
        g["spans"].append((m["start"], m["end"]))
    result: dict[tuple[str, str], dict] = {}
    pending: list[tuple[tuple[str, str], dict, list]] = []
    for key, g in groups.items():
        types = compat[g["type"]]
        evidence = c.sentence_span(g["spans"][0][0])
        ext = [r for r in c.index.by_external_id(g["text"]) if r.type in types]
        if len(ext) == 1:
            result[key] = {"decision": "match", "entity_id": ext[0].id, "confidence": 1.0, "method": "external_id",
                           "spans": [evidence]}
            continue
        exact = c.index.exact(g["text"], types)
        if len(exact) > 1:
            # Two existing entities of one type with one normalised name are a duplicate pair when their
            # countries do not differ. The resolver never merges them: the pair goes to the approval queue.
            same_type = [r for r in exact if not r.pending and r.type == g["type"]]
            known = {r.country for r in same_type if r.country}
            if len(same_type) > 1 and len(known) <= 1:
                a.merges.append({"entity_ids": sorted(r.id for r in same_type), "name": g["text"], "type": g["type"],
                                 "spans": [evidence]})
            countries = [x for x in (a.classification or {}).get("geographies", []) if len(x) == 2]
            narrowed = [r for r in exact if r.country and r.country in countries]
            if len(narrowed) == 1:
                exact = narrowed
        if len(exact) == 1:
            result[key] = {"decision": "match", "entity_id": exact[0].id, "confidence": float(t["exact_match_confidence"]),
                           "method": "normalised_name", "spans": [evidence]}
            continue
        if len(exact) > 1:
            result[key] = {"decision": "no_decision", "entity_id": None, "confidence": 0.0, "method": "duplicate",
                           "spans": [evidence], "duplicates": sorted(r.id for r in exact)}
            continue
        if g["type"] == "project":
            same_site = _same_site_projects(c, g["text"])
            if len(same_site) == 1:
                result[key] = {"decision": "match", "entity_id": same_site[0].id,
                               "confidence": float(t.get("same_site_project_confidence", 0.85)), "method": "same_site",
                               "spans": [evidence]}
                continue
            if len(same_site) > 1:
                result[key] = {"decision": "no_decision", "entity_id": None, "confidence": 0.0, "method": "same_site",
                               "spans": [evidence], "duplicates": sorted(r.id for r in same_site)}
                continue
        cands = c.index.candidates(g["text"], types, int(t["candidate_limit"]), float(t["candidate_min_similarity"]))
        pending.append((key, g, cands))
    if pending:
        ctx = {
            "mentions": [{"mention": g["text"], "type": g["type"],
                          "candidates": [{"entity_id": r.id, "name": r.name, "type": r.type, "aliases": r.aliases[:5],
                                          "similarity": sim} for r, sim in cands],
                          "_evidence": c.sentence_span(g["spans"][0][0]).as_dict()}
                         for _k, g, cands in pending],
            "_thresholds": t,
        }
        out = c.runner.run("resolver", c.text, ctx)
        decisions = {d["mention"]: d for d in (out or {}).get("decisions", [])}
        for key, g, cands in pending:
            d = decisions.get(g["text"])
            evidence_default = [c.sentence_span(g["spans"][0][0])]
            if d is None:
                result[key] = {"decision": "no_decision", "entity_id": None, "confidence": 0.0, "method": "resolver",
                               "spans": evidence_default}
                continue
            spans = c.verify_all("resolver", d.get("evidence"))
            decision = d["decision"]
            if decision in ("match", "new") and not spans:
                c.runner.reject("resolver", "no_evidence", {"mention": g["text"], "decision": decision}, d)
                decision = "no_decision"
            if decision == "match" and d.get("entity_id") not in {r.id for r, _s in cands}:
                c.runner.reject("resolver", "unknown_entity", {"mention": g["text"], "entity_id": d.get("entity_id")}, d)
                decision = "no_decision"
            if decision == "new" and g["type"] not in set(t.get("creatable_types") or []):
                decision = "no_decision"
            if decision == "new" and g["type"] == "project" and not rules.distinctive_project_name(g["text"]):
                decision = "no_decision"  # "Solar Project" names no project (M4)
            entry = {"decision": decision, "entity_id": d.get("entity_id") if decision == "match" else None,
                     "confidence": float(d.get("confidence") or 0.0), "method": "trigram", "spans": spans or evidence_default,
                     "reason": d.get("reason")}
            if decision == "new":
                new_id = c.new_id(g["type"], key[1])
                entry["entity_id"] = new_id
                entry["new"] = True
                c.index.add(EntityRecord(id=new_id, type=g["type"], name=g["text"], pending=True))
            result[key] = entry
    else:
        c.runner.mark("resolver", "ok", note="rules only: external ids and normalised names")
    for key, entry in result.items():
        a.resolutions.append({"type": key[0], "mention": groups[key]["text"], **{k: v for k, v in entry.items() if k != "spans"},
                              "spans": entry["spans"]})
    return result


_KIND_WORDS = ("project", "expansion", "restart")


def _kind_word(name: str) -> str | None:
    last = normalise_name(name).split()[-1:] or [""]
    return last[0] if last[0] in _KIND_WORDS else None


def _site_tokens(c: _Ctx, text: str) -> tuple[set[str], set[str]]:
    """The sites that a project name names (by a full name or alias, or the first word of one) and those words."""
    norm = f" {normalise_name(text)} "
    sites: set[str] = set()
    tokens: set[str] = set()
    for r in c.index.all(["site"]):
        for surface in c.index.surfaces_of(r):
            s = normalise_name(surface)
            first = s.split()[0] if s else ""
            if s and f" {s} " in norm:
                sites.add(r.id)
                tokens.add(s)
            elif len(first) >= 5 and f" {first} " in norm and first not in (config.get(
                    "mentions.project_generic_words") or []):
                sites.add(r.id)
                tokens.add(first)
    return sites, tokens


def _same_site_projects(c: _Ctx, text: str) -> list[EntityRecord]:
    """Existing projects at the site that the mention names, with the same kind word (M4: no duplicate project).

    "Barrick Lumwana Super Pit Copper Expansion" is the known "Lumwana Expansion". Two known projects of one
    kind at the site give no decision, so that the resolver never creates a third.
    """
    kind = _kind_word(text)
    if kind is None:
        return []
    sites, tokens = _site_tokens(c, text)
    if not sites:
        return []
    out = []
    for r in c.index.all(["project"]):
        if _kind_word(r.name) != kind:
            continue
        name = f" {normalise_name(r.name)} "
        if (r.site_id and r.site_id in sites) or any(f" {tok} " in name for tok in tokens):
            out.append(r)
    return sorted(out, key=lambda r: r.id)


def _merge_claims(c: _Ctx, a: Analysis, res: dict) -> None:
    """Two claims with the same predicate, value, subject entity and object entity are one claim.

    A title and a body often state the same fact. The merged claim keeps the evidence of both.
    """
    merged: list[dict] = []
    keys: dict[tuple, dict] = {}
    for claim in a.claims:
        subject = _entity_for(res, claim["subject"], ("project", "site", "organisation")) or normalise_name(claim["subject"])
        obj = _entity_for(res, claim.get("object") or "", ("site", "project", "organisation")) or \
            normalise_name(claim.get("object") or "")
        key = (claim["predicate"], claim.get("normalised"), subject, obj)
        if key in keys:
            first = keys[key]
            first["spans"] = first["spans"] + [s for s in claim["spans"] if s not in first["spans"]]
            continue
        keys[key] = claim
        merged.append(claim)
    a.claims = merged


def _entity_for(res: dict, text: str, types: tuple[str, ...]) -> str | None:
    norm = normalise_name(text)
    for t in types:
        entry = res.get((t, norm))
        if entry and entry["entity_id"]:
            return entry["entity_id"]
    return None


# ---------------------------------------------------------------------------
# 4. Lifecycle and 5. Window forecaster
# ---------------------------------------------------------------------------


def _link_site(c: _Ctx, a: Analysis, res: dict, project: dict) -> str | None:
    first_span = project["spans"][0]
    for m in a.mentions:
        if m["type"] == "site" and (m["start"], m["end"]) == first_span:
            sid = _entity_for(res, m["text"], ("site",))
            if sid:
                return sid
    first_word = project["name"].split()[0].lower()
    for r in c.index.all(["site"]):
        if any(s.split()[0].lower() == first_word for s in r.surfaces()):
            return r.id
    # M4: a site name word elsewhere in the project name ("Barrick Lumwana Super Pit Copper Expansion").
    named, _tokens = _site_tokens(c, project["name"])
    if len(named) == 1:
        return next(iter(named))
    sent = sentence_at(c.sents, first_span[0])
    if sent:
        for m in a.mentions:
            if m["type"] == "site" and sent.start <= m["start"] < sent.end:
                sid = _entity_for(res, m["text"], ("site",))
                if sid:
                    return sid
    return None


def _lifecycle(c: _Ctx, a: Analysis, res: dict) -> None:
    projects: dict[str, dict] = {}
    for m in a.mentions:
        if m["type"] != "project":
            continue
        entry = res.get(("project", normalise_name(m["text"])))
        if not entry or not entry["entity_id"]:
            continue
        pid = entry["entity_id"]
        p = projects.setdefault(pid, {"id": pid, "name": m["text"], "spans": [], "new": bool(entry.get("new")),
                                      "confidence": entry["confidence"]})
        p["spans"].append((m["start"], m["end"]))
    for p in projects.values():
        rec = c.index.get(p["id"])
        p["record"] = rec
        if rec and not p["new"]:
            p["name"] = rec.name
            p["site_id"] = rec.site_id
        else:
            p["site_id"] = _link_site(c, a, res, p)
            if rec:
                rec.site_id = p["site_id"]
        site = c.index.get(p["site_id"])
        p["watch"] = site.watch if site else "none"
        p["site_spans"] = [(m["start"], m["end"]) for m in a.mentions if m["type"] == "site"
                           and _entity_for(res, m["text"], ("site",)) == p["site_id"] and p["site_id"]]
    a.projects = list(projects.values())
    if not a.projects:
        c.runner.mark("lifecycle", "no_projects")
        c.runner.mark("window_forecaster", "no_projects")
        return
    lc = common_config.lifecycle()
    ctx = {
        "title": c.doc.title,
        "projects": [{"project": p["name"], "spans": [list(s) for s in p["spans"]], "site_spans": [list(s) for s in p["site_spans"]]}
                     for p in a.projects],
        "stages": [{"code": s["code"], "name": s["name"]} for s in lc["stages"]],
        "restart_path": lc.get("restart_path") or [],
    }
    out = c.runner.run("lifecycle", c.text, ctx)
    by_name = {p["name"]: p for p in a.projects}
    codes = config.lifecycle_stage_codes()
    for item in (out or {}).get("projects", []):
        p = by_name.get(item["project"])
        if p is None:
            c.runner.reject("lifecycle", "unknown_entity", {"project": item["project"]}, item)
            continue
        if item["stage"] not in codes:
            c.runner.reject("lifecycle", "unknown_stage", {"stage": item["stage"]}, item)
            continue
        spans = c.verify_all("lifecycle", item["evidence"])
        if not spans:
            c.runner.reject("lifecycle", "no_evidence", {"project": item["project"]}, item)
            continue
        if not any(item["stage_event"] in s.quote for s in spans):
            c.runner.reject("lifecycle", "value_not_in_quote", {"stage_event": item["stage_event"]}, item)
            continue
        p.update(stage=item["stage"], stage_event=item["stage_event"], stage_certainty=item["certainty"], stage_spans=spans)
    # Window forecaster: a calculation from the intervals.
    st = c.runner.status("window_forecaster")
    st.backend, st.model_id, st.prompt_version = "calculation", forecaster.model_id(), forecaster.prompt_version()
    base = c.doc.published_at or c.doc.fetched_at
    for p in a.projects:
        if not p.get("stage"):
            continue
        rec = p.get("record")
        payload = forecaster.calculate(p["stage"], base, rec.forecast_start if rec else None)
        if payload is not None:
            a.forecasts.append({"project_id": p["id"], "payload": payload, "spans": p["stage_spans"],
                                "certainty": p["stage_certainty"]})
    st.status = "ok"
    st.detail["forecasts"] = len(a.forecasts)


# ---------------------------------------------------------------------------
# 6. Summariser
# ---------------------------------------------------------------------------


def _summarise(c: _Ctx, a: Analysis) -> None:
    marks = [[s.start, s.end] for s in a.signal_spans] + [[s.start, s.end] for cl in a.claims for s in cl["spans"]]
    ctx = {"title": c.doc.title, "max_sentences": int(config.get("pipeline.summary_max_sentences", 3)),
           "_evidence_spans": marks}
    out = c.runner.run("summariser", c.text, ctx)
    for sentence in (out or {}).get("sentences", []):
        spans = c.verify_all("summariser", sentence.get("evidence"))
        if not spans:
            c.runner.reject("summariser", "no_evidence", {"sentence": sentence.get("text")}, sentence)
            continue
        a.summary.append({"text": sentence["text"], "spans": spans})


# ---------------------------------------------------------------------------
# Planned facts
# ---------------------------------------------------------------------------


def _first_span_for(c: _Ctx, pattern_fn: Callable[[str], bool]) -> Span | None:
    for s in c.sents:
        if pattern_fn(s.quote):
            return c.sentence_span(s.start)
    return None


def _plan(c: _Ctx, a: Analysis, res: dict) -> None:
    doc = c.doc
    title = doc.title or c.text.split("\n", 1)[0][:200]
    floor = rules.document_floor(c.text, doc.title)
    a.certainty = floor or "stated"

    auto_conf = float(common_config.approval_policy()["policies"]["EntityIdentified"].get("automatic_if", {})
                      .get("min_resolution_confidence", 0.9))
    new_ids = {r["entity_id"] for r in a.resolutions if r.get("new")}
    auto_new: set[str] = set()

    # New organisations.
    for r in a.resolutions:
        if not r.get("new") or r["type"] != "organisation":
            continue
        a.facts.append(Fact(
            kind="EntityIdentified", agent="resolver", title=f"New organisation: {r['mention']}",
            key=f"EntityIdentified:organisation:{normalise_name(r['mention'])}",
            events=[PlannedEvent("entity", r["entity_id"], "EntityIdentified",
                                 {"entity_type": "organisation", "name": r["mention"], "aliases": [],
                                  "resolution_confidence": r["confidence"], "new_entity": True},
                                 r["spans"], "stated")],
            new_entities=[{"id": r["entity_id"], "type": "organisation"}],
        ))
        if r["confidence"] >= auto_conf:
            auto_new.add(r["entity_id"])

    # Projects: new project (with its stage), stage changes, the site link and the forecast.
    for p in a.projects:
        stage = p.get("stage")
        stage_events = []
        if stage:
            rec = p.get("record")
            current = rec.stage if rec and not p["new"] else None
            pending = rec.stage_pending if rec else None
            if stage != current and stage != pending:
                stage_events.append(PlannedEvent(
                    "project", p["id"], "ProjectStageChanged",
                    {"from_stage": current, "to_stage": stage, "name": p["name"], "site_id": p.get("site_id"),
                     "stage_event": p["stage_event"]},
                    p["stage_spans"], p["stage_certainty"], doc.published_at or doc.fetched_at))
        if p["new"]:
            span = c.sentence_span(p["spans"][0][0])
            events = [PlannedEvent("project", p["id"], "EntityIdentified",
                                   {"entity_type": "project", "name": p["name"], "aliases": [], "site_id": p.get("site_id"),
                                    "resolution_confidence": p["confidence"], "new_entity": True},
                                   [span], "stated", doc.published_at or doc.fetched_at)] + stage_events
            a.facts.append(Fact(kind="EntityIdentified", agent="lifecycle" if stage_events else "resolver",
                                title=f"New project: {p['name']}" + (f" at stage {stage}" if stage_events else ""),
                                key=f"EntityIdentified:project:{normalise_name(p['name'])}", events=events,
                                new_entities=[{"id": p["id"], "type": "project"}]))
            if p["confidence"] >= auto_conf:
                auto_new.add(p["id"])
            if p.get("site_id"):
                site = c.index.get(p["site_id"])
                a.facts.append(Fact(
                    kind="RelationshipAsserted", agent="lifecycle",
                    title=f"{p['name']} is at {site.name if site else 'a site'}",
                    key=f"RelationshipAsserted:project_at_site:{normalise_name(p['name'])}",
                    events=[PlannedEvent("project", p["id"], "RelationshipAsserted",
                                         {"subject_id": p["id"], "predicate": "project_at_site", "object_id": p["site_id"]},
                                         [span], "stated")],
                    force_review=True))
        elif stage_events:
            a.facts.append(Fact(kind="ProjectStageChanged", agent="lifecycle", title=f"{p['name']}: stage {stage}",
                                key=f"ProjectStageChanged:{p['id']}:{stage}", events=stage_events,
                                force_review=p["id"] in new_ids and p["id"] not in auto_new))
        p["stage_proposed"] = bool(stage_events)
        p["stage_auto"] = bool(stage_events) and p["stage_certainty"] == "stated" and (not p["new"] or p["id"] in auto_new)

    for f in a.forecasts:
        p = next(x for x in a.projects if x["id"] == f["project_id"])
        if not p.get("stage_auto"):
            continue  # the forecast follows when the stage is approved (services/governance/proposals.py)
        a.facts.append(Fact(
            kind="ProcurementWindowForecast", agent="window_forecaster",
            title=f"Procurement window: {p['name']}", key=f"ProcurementWindowForecast:{p['id']}:{f['payload']['current_stage']}",
            events=[PlannedEvent("project", p["id"], "ProcurementWindowForecast", f["payload"], f["spans"], f["certainty"],
                                 doc.published_at or doc.fetched_at)]))

    # Claims: status changes, attributes, relationships.
    for claim in a.claims:
        pred = claim["predicate"]
        if pred == "site_status":
            site_id = _entity_for(res, claim["subject"], ("site",))
            if site_id is None:
                exact = c.index.exact(claim["subject"], ["site"])
                site_id = exact[0].id if len(exact) == 1 else None
            rec = c.index.get(site_id)
            if not rec or rec.watch == "none":
                continue
            if claim["normalised"] in (rec.status, rec.status_pending):
                continue
            if any(f.kind == "SiteStatusChanged" and f.events[0].stream_id == site_id for f in a.facts):
                continue
            # The status before the change: the recorded status of the site projection, else the status hint of
            # the brief (M4). The payload says which one it is.
            from_status = rec.status or rec.status_hint
            from_source = "recorded" if rec.status else ("brief_status_hint" if rec.status_hint else None)
            a.facts.append(Fact(
                kind="SiteStatusChanged", agent="extractor", title=f"{rec.name}: {claim['normalised'].replace('_', ' ')}",
                key=f"SiteStatusChanged:{site_id}:{claim['normalised']}",
                events=[PlannedEvent("entity", site_id, "SiteStatusChanged",
                                     {"from_status": from_status, "from_status_source": from_source,
                                      "to_status": claim["normalised"], "site_name": rec.name},
                                     claim["spans"], claim["certainty"], doc.published_at or doc.fetched_at)]))
        elif pred in ATTRIBUTE_PREDICATES:
            subject_id = _entity_for(res, claim["subject"], ("project", "site", "organisation"))
            if not subject_id:
                continue
            rec = c.index.get(subject_id)
            stream = "project" if rec and rec.type == "project" else "entity"
            payload = {"predicate": pred, "value": claim["normalised"], "value_text": claim["value_text"]}
            if claim.get("object"):
                payload["object_id"] = _entity_for(res, claim["object"], ("site", "project", "organisation"))
            a.facts.append(Fact(
                kind="EntityAttributeAsserted", agent="extractor",
                title=f"{claim['subject']}: {pred} {claim['normalised']}",
                key=f"EntityAttributeAsserted:{subject_id}:{pred}:{claim['normalised']}",
                events=[PlannedEvent(stream, subject_id, "EntityAttributeAsserted", payload, claim["spans"], claim["certainty"])],
                force_review=subject_id in new_ids and subject_id not in auto_new))
        elif pred in RELATIONSHIP_PREDICATES:
            if pred.startswith("buyer_role"):
                subject_id = _entity_for(res, claim["subject"], ("project",))
                object_id = _entity_for(res, claim["object"] or "", ("organisation",))
                stream = ("project", subject_id)
            else:
                subject_id = _entity_for(res, claim["subject"], ("organisation",))
                object_id = _entity_for(res, claim["object"] or "", ("site",))
                stream = ("entity", object_id)
            if not subject_id or not object_id:
                continue
            a.facts.append(Fact(
                kind="RelationshipAsserted", agent="extractor", title=f"{claim['subject']} {pred} {claim['object']}",
                key=f"RelationshipAsserted:{subject_id}:{pred}:{object_id}",
                events=[PlannedEvent(stream[0], stream[1], "RelationshipAsserted",
                                     {"subject_id": subject_id, "predicate": pred, "object_id": object_id},
                                     claim["spans"], claim["certainty"])]))

    # Market demand drivers.
    driver_themes = set(common_config.tiers().get("demand_driver_themes") or [])
    directions = config.theme_directions()
    for theme in (a.classification or {}).get("themes", []):
        if theme not in driver_themes:
            continue
        span = _first_span_for(c, lambda q, t=theme: rules.theme_matches(t, q) and not rules.is_negated_driver(q))
        if span is None:
            continue
        certainty = rules.claim_certainty(span.quote, floor)[0]
        a.facts.append(Fact(
            kind="DemandDriverObserved", agent="classifier", title=f"{theme.replace('_', ' ')}: {title}",
            key=f"DemandDriverObserved:{theme}",
            events=[PlannedEvent("market", "zm", "DemandDriverObserved",
                                 {"driver_type": theme, "title": title, "direction": directions.get(theme, "demand_up"),
                                  "geography": (a.classification or {}).get("geographies", []),
                                  "observed_at": (doc.published_at or doc.fetched_at).isoformat()
                                  if (doc.published_at or doc.fetched_at) else None,
                                  "source_id": doc.source_id},
                                 [span], certainty, doc.published_at or doc.fetched_at)]))

    # Deals: open notices and planned procurements (always review).
    proc = config.rules()["procurement"]
    first_stage = common_config.stage_codes()[0]
    cls_deals = (a.classification or {}).get("deal_types", [])
    for mode, span in rules.procurement_sentences(c.text):
        cats = rules.procurement_categories(span.quote)
        deal_type = next((proc["category_deal_types"][x] for x in cats if x in proc["category_deal_types"]), None)
        if deal_type is None:
            deal_type = next((d for d in ("prequalification", "eoi", "tender") if d in cls_deals), "tender")
        sent_mentions = [m for m in a.mentions if span.start <= m["start"] < span.end]
        site_id = next((_entity_for(res, m["text"], ("site",)) for m in sent_mentions if m["type"] == "site"
                        and _entity_for(res, m["text"], ("site",))), None)
        project_id = next((_entity_for(res, m["text"], ("project",)) for m in sent_mentions if m["type"] == "project"
                           and _entity_for(res, m["text"], ("project",))), None)
        org_id = next((_entity_for(res, m["text"], ("organisation",)) for m in sent_mentions if m["type"] == "organisation"
                       and _entity_for(res, m["text"], ("organisation",))), None)
        if not (site_id or project_id or org_id):
            main_site = next((_entity_for(res, m["text"], ("site",)) for m in a.mentions if m["type"] == "site"
                              and _entity_for(res, m["text"], ("site",))), None)
            main_project = a.projects[0]["id"] if a.projects else None
            main_org = next((_entity_for(res, m["text"], ("organisation",)) for m in a.mentions
                             if m["type"] == "organisation" and _entity_for(res, m["text"], ("organisation",))), None)
            site_id, project_id, org_id = main_site, main_project, main_org
        anchor = c.index.get(site_id) or c.index.get(project_id) or c.index.get(org_id)
        anchor_name = anchor.name if anchor else title[:80]
        deal_names = {d["code"]: d["name"] for d in common_config.load_yaml("taxonomy", "deal-types.yaml")}
        key = f"DealIdentified:{deal_type}:{anchor.id if anchor else normalise_name(title)}"
        if any(f.key == key for f in a.facts):
            continue
        deal_id = c.new_id("deal", key)
        events = [PlannedEvent("deal", deal_id, "DealIdentified",
                               {"title": f"{deal_names.get(deal_type, deal_type)}: {anchor_name}", "deal_type": deal_type,
                                "stage": first_stage, "site_id": site_id, "project_id": project_id,
                                "organisation_id": org_id, "procurement": mode, "categories": cats},
                               [span], rules.claim_certainty(span.quote, floor)[0], doc.published_at or doc.fetched_at)]
        for claim in a.claims:
            if claim["predicate"] in DEAL_ATTRIBUTE_PREDICATES:
                events.append(PlannedEvent("deal", deal_id, "DealAttributeAsserted",
                                           {"predicate": claim["predicate"], "value": claim["normalised"],
                                            "value_text": claim["value_text"]},
                                           claim["spans"], claim["certainty"]))
        a.deals.append({"id": deal_id, "deal_type": deal_type, "mode": mode, "categories": cats})
        a.facts.append(Fact(kind="DealIdentified", agent="scorer", title=events[0].payload["title"], key=key,
                            events=events, force_review=True))

    # Merges of two existing entities (always review).
    seen_pairs: set[tuple[str, ...]] = set()
    for m in a.merges:
        if tuple(m["entity_ids"]) in seen_pairs:
            continue
        seen_pairs.add(tuple(m["entity_ids"]))
        into, merged = m["entity_ids"][0], m["entity_ids"][1:]
        payload = {"merged_ids": merged, "into_id": into,
                   "reason": f"two existing {m['type']} entities have the normalised name '{normalise_name(m['name'])}'"}
        # One event in the stream of each merged entity, so that its projection records merged_into on approval.
        a.facts.append(Fact(
            kind="EntityMerged", agent="resolver", title=f"Merge {len(m['entity_ids'])} entities named {m['name']}",
            key=f"EntityMerged:{':'.join(m['entity_ids'])}",
            events=[PlannedEvent("entity", merged_id, "EntityMerged", payload, m["spans"], "stated")
                    for merged_id in merged],
            force_review=True))


# ---------------------------------------------------------------------------
# 7. Scorer
# ---------------------------------------------------------------------------


def _features(c: _Ctx, a: Analysis, res: dict) -> dict:
    cls = a.classification or {}
    watched_levels = set()
    entity_ids = []
    for entry in res.values():
        if entry.get("entity_id") and entry["decision"] in ("match", "new"):
            entity_ids.append(entry["entity_id"])
            rec = c.index.get(entry["entity_id"])
            if rec and rec.type == "site":
                watched_levels.add(rec.watch)
    for p in a.projects:
        watched_levels.add(p.get("watch") or "none")
    a.entity_ids = sorted(set(entity_ids))
    lc = common_config.lifecycle()
    status_sites = [c.index.get(f.events[0].stream_id) for f in a.facts if f.kind == "SiteStatusChanged"]
    proc_in_scope = set(common_config.tiers().get("procurement_categories_in_scope") or [])
    open_deals = [d for d in a.deals if d["mode"] == "open"]
    shifts = [f["payload"]["shift_months_nearer"] for f in a.forecasts if f["payload"].get("shift_months_nearer") is not None]
    enters = False
    for p in a.projects:
        if p.get("stage_proposed"):
            rec = p.get("record")
            before = rec.stage if rec and not p["new"] else None
            from services.projections.folds import in_engagement_window

            if in_engagement_window(p["stage"]) and not in_engagement_window(before):
                enters = True
    features = {
        "in_scope": True,
        "watch_daily": "daily" in watched_levels,
        "watch_weekly": "weekly" in watched_levels,
        "watched": bool(watched_levels & {"daily", "weekly"}),
        "directions": list(a.directions),
        "early_signal_source": bool(c.doc.early_signal),
        "certainty": a.certainty,
        "is_project": bool(a.projects),
        "project_first_trace": any(p["new"] and _before_first_trace_limit(p.get("stage")) for p in a.projects),
        "enters_engagement_window": enters,
        "forecast_shift_months_nearer": max(shifts) if shifts else None,
        "open_procurement_notice": bool(open_deals),
        "procurement_category_in_scope": any(set(d["categories"]) & proc_in_scope for d in open_deals),
        "site_status_change": bool(status_sites),
        "status_change_at_daily_site": any(s and s.watch == "daily" for s in status_sites),
        "market_demand_driver": any(f.kind == "DemandDriverObserved" for f in a.facts),
        "lifecycle_stage_change": any(p.get("stage_proposed") for p in a.projects),
        "contractor_award": "contractor_award" in cls.get("themes", []) or rules.has_award(c.text),
        "buyer_change": any(f.kind == "RelationshipAsserted" and f.events[0].payload["predicate"].startswith("buyer_role")
                            for f in a.facts),
        "engagement_window": [lc["engagement_window"]["from"], lc["engagement_window"]["to"]],
    }
    for d in ("demand_up", "procurement", "project_pipeline", "demand_down"):
        features[f"direction_{d}"] = d in a.directions
    return features


def _before_first_trace_limit(stage: str | None) -> bool:
    """True when a new project is an early signal: its stage is unknown or comes before the limit of
    config/tiers.yaml (first_trace_before_stage). A restart stage uses the order of the restart path."""
    if stage is None:
        return True
    limit = common_config.tiers().get("first_trace_before_stage")
    if not limit:
        return True
    lc = common_config.lifecycle()
    main = [s["code"] for s in lc["stages"]]
    restart = [s["code"] for s in lc.get("restart_path") or []]
    if stage in main and limit in main:
        return main.index(stage) < main.index(limit)
    if stage in restart and limit in restart:
        return restart.index(stage) < restart.index(limit)
    return False


def _score(c: _Ctx, a: Analysis, res: dict) -> None:
    a.features = _features(c, a, res)
    ctx = {"title": c.doc.title, "features": {k: v for k, v in a.features.items() if k != "engagement_window"}}
    out = c.runner.run("scorer", c.text, ctx)
    judgement = None
    if out is not None and out.get("judgement") is not None:
        spans = c.verify_all("scorer", out.get("evidence"))
        if spans:
            judgement = max(0.0, min(1.0, float(out["judgement"])))
        else:
            c.runner.reject("scorer", "no_evidence", {"judgement": out.get("judgement")}, out)
    a.judgement = judgement
    a.features["model_judgement"] = judgement
    weights = ((c.doc.brief or {}).get("scoring") or {}).get("weights") or {}
    a.score, a.breakdown = scoring.score(a.features, weights, c.doc.published_at, c.doc.fetched_at, judgement)
    a.tier, a.tier_rule = scoring.assign_tier(a.features)
    a.breakdown["features"] = {k: v for k, v in a.features.items()}
    a.breakdown["tier_rule"] = a.tier_rule
    related = ("source", c.doc.source_id)
    rule = a.tier_rule or ""
    if rule == "t0_daily_site_status_change":
        f = next(f for f in a.facts if f.kind == "SiteStatusChanged")
        related = ("entity", f.events[0].stream_id)
    elif rule == "t0_market_demand_driver":
        related = ("market", "zm")
    elif rule in ("t0_new_project_first_trace", "t0_enters_engagement_window", "t0_forecast_moves_nearer") and a.projects:
        related = ("project", a.projects[0]["id"])
    elif rule == "t0_open_procurement_notice" and a.deals:
        related = ("deal", a.deals[0]["id"])
    title = c.doc.title or c.text.split("\n", 1)[0][:200]
    payload = {
        "source_id": c.doc.source_id, "title": title, "url": c.doc.url or "", "publisher": c.doc.publisher,
        "published_at": c.doc.published_at.isoformat() if c.doc.published_at else None,
        "fetched_at": c.doc.fetched_at.isoformat() if c.doc.fetched_at else None,
        "tier": a.tier if a.tier is not None else 2, "tier_rule": a.tier_rule or "none", "score": a.score,
        "breakdown": a.breakdown, "sectors": (a.classification or {}).get("sectors", []),
        "geographies": (a.classification or {}).get("geographies", []), "themes": (a.classification or {}).get("themes", []),
        "directions": a.directions, "deal_types": (a.classification or {}).get("deal_types", []),
        "entity_ids": a.entity_ids, "read_at_source": bool(c.doc.read_at_source),
        "summary": [{"text": s["text"], "spans": [x.as_dict() for x in s["spans"]]} for s in a.summary],
    }
    spans = list(a.signal_spans)
    for s in a.summary:
        for x in s["spans"]:
            if x not in spans:
                spans.append(x)
    a.facts.append(Fact(kind="SignalScored", agent="scorer", title=title, key="SignalScored",
                        events=[PlannedEvent("source", c.doc.source_id or "eval", "SignalScored", payload, spans,
                                             a.certainty, c.doc.published_at or c.doc.fetched_at)]))
    if a.tier == 0:
        a.alert = {"tier": 0, "tier_rule": a.tier_rule, "title": title, "related_stream_type": related[0],
                   "related_stream_id": related[1], "spans": spans}


def analyse(doc: Doc, index: MemoryIndex, runner: AgentRunner, id_factory: Callable[[str, str], str] | None = None) -> Analysis:
    """Run the seven agents on one document. No database writes."""
    a = Analysis(doc=doc)
    c = _Ctx(doc, index, runner, id_factory or _default_id_factory)
    entities = entity_context(index)
    if not _classify(c, a, entities):
        for agent in AGENT_ORDER[1:]:
            if runner.status(agent).status == "not_run":
                runner.mark(agent, "skipped", reason=a.status)
        return a
    a.status = "in_scope"
    _extract(c, a, entities)
    res = _resolve(c, a)
    _merge_claims(c, a, res)
    _lifecycle(c, a, res)
    _summarise(c, a)
    _plan(c, a, res)
    _score(c, a, res)
    return a


def fact_spans(a: Analysis) -> list[Span]:
    out = []
    for f in a.facts:
        for ev in f.events:
            out.extend(ev.spans)
    return out


def describe(a: Analysis) -> dict[str, Any]:
    """A plain summary of the analysis for logs and tests."""
    return {
        "status": a.status, "tier": a.tier, "tier_rule": a.tier_rule, "score": a.score,
        "themes": (a.classification or {}).get("themes", []), "claims": len(a.claims),
        "facts": [f.kind for f in a.facts], "projects": [(p["name"], p.get("stage")) for p in a.projects],
    }
