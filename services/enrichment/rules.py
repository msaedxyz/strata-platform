"""The rules of the deterministic backend (docs/decisions.md: the agents use the deterministic backend
when ANTHROPIC_API_KEY is not set).

Each agent function takes the normalised document text and the context, and returns JSON that matches
the schema of the agent in config/agent-schemas.yaml, like a model would. The rules come from
config/enrichment-rules.yaml, config/taxonomy/ and the brief (themes, keywords and exclusions). The
functions have no randomness: the same input gives the same output.

The module also has helper rules that the pipeline uses for both backends: certainty cues, future cues,
procurement notices and demand driver negations.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

from . import config
from .normalisers import normalise_name, normalise_value, parse_dates, parse_money, parse_percents, parse_quantities
from .spans import Span, clip, sentences

_CERTAINTY_ORDER = {"stated": 0, "reported": 1, "speculative": 2}


def weaker(a: str, b: str | None) -> str:
    if b is None:
        return a
    return a if _CERTAINTY_ORDER[a] >= _CERTAINTY_ORDER[b] else b


def _keyword_pattern(word: str) -> re.Pattern:
    """A brief keyword as a pattern: a space and a hyphen are equal, and a plural ending is allowed."""
    flags = 0 if (word.isupper() and len(word) <= 6) or re.fullmatch(r"[A-Z][A-Z0-9 -]+", word) else re.IGNORECASE
    body = r"[ -]".join(re.escape(part) for part in re.split(r"[ -]", word))
    return re.compile(r"(?<![\w-])" + body + r"(?:s|es)?(?![\w-])", flags)


@dataclass
class Compiled:
    certainty_speculative: list[re.Pattern]
    certainty_reported: list[re.Pattern]
    future: list[re.Pattern]
    summary_labels: list[str]
    keywords: list[tuple[str, str, re.Pattern]]          # theme, activity type, pattern
    synonyms: list[tuple[str, re.Pattern]]                # theme, pattern
    theme_sectors: dict[str, list[str]]
    site_class_sectors: dict[str, str]
    sector_cues: dict[str, list[re.Pattern]]
    geography: list[tuple[str, re.Pattern]]
    geo_parent: dict[str, str]
    deal_type_cues: list[tuple[str, re.Pattern]]
    open_notice: list[re.Pattern]
    planned: list[re.Pattern]
    award: list[re.Pattern]
    categories: dict[str, list[re.Pattern]]
    status_cues: list[tuple[str, re.Pattern]]
    stage_cues: list[tuple[str, re.Pattern]]
    driver_negations: list[re.Pattern]
    project_patterns: list[re.Pattern]
    org_patterns: list[re.Pattern]


@lru_cache
def compiled() -> Compiled:
    r = config.rules()
    cp = config.compile_patterns
    keywords = []
    for act in config.activity_types():
        keywords.append((act["theme"], act["code"], _keyword_pattern(act["keyword"])))
    synonyms = [(theme, config.compile_pattern(p)) for theme, pats in (r.get("theme_synonyms") or {}).items() for p in pats]
    geography = []
    parents = {}
    for g in config.geographies():
        if g.get("parent"):
            parents[g["code"]] = g["parent"]
        name = re.sub(r"\s+(District|Province|corridor)$", "", g["name"])
        if g["level"] in ("province", "district") or g["level"] == "country":
            geography.append((g["code"], re.compile(r"(?<![\w-])" + re.escape(name) + r"(?![\w-])")))
    for code, pats in (r.get("geography_aliases") or {}).items():
        for p in pats:
            geography.append((code, config.compile_pattern(p)))
    proc = r["procurement"]
    return Compiled(
        certainty_speculative=cp(r["certainty"]["speculative"]),
        certainty_reported=cp(r["certainty"]["reported"]),
        future=cp(r.get("future_cues")),
        summary_labels=[s.lower() for s in r.get("summary_line_labels") or []],
        keywords=keywords,
        synonyms=synonyms,
        theme_sectors=r.get("theme_sectors") or {},
        site_class_sectors=r.get("site_class_sectors") or {},
        sector_cues={k: cp(v) for k, v in (r.get("sector_cues") or {}).items()},
        geography=geography,
        geo_parent=parents,
        deal_type_cues=[(code, config.compile_pattern(p)) for code, pats in r["deal_type_cues"].items() for p in pats],
        open_notice=cp(proc["open_notice"]),
        planned=cp(proc["planned"]),
        award=cp(proc["award"]),
        categories={k: cp(v) for k, v in proc["categories"].items()},
        status_cues=[(status, config.compile_pattern(p)) for status, pats in r["site_status_cues"].items() for p in pats],
        stage_cues=[(stage, config.compile_pattern(p)) for stage, pats in r["lifecycle_stage_cues"].items() for p in pats],
        driver_negations=cp(r.get("demand_driver_negations")),
        project_patterns=[re.compile(p) for p in r["mentions"]["project_patterns"]],
        org_patterns=[re.compile(p) for p in r["mentions"]["organisation_patterns"]],
    )


# ---------------------------------------------------------------------------
# Shared helper rules (both backends)
# ---------------------------------------------------------------------------


def sentence_certainty(text: str) -> tuple[str, str | None]:
    c = compiled()
    for p in c.certainty_speculative:
        m = p.search(text)
        if m:
            return "speculative", m.group(0)
    for p in c.certainty_reported:
        m = p.search(text)
        if m:
            return "reported", m.group(0)
    return "stated", None


def document_floor(text: str, title: str | None) -> str | None:
    """The weakest certainty that a rumour document allows for any claim, or None."""
    c = compiled()
    cues = sum(len(p.findall(text)) for p in c.certainty_speculative + c.certainty_reported)
    title_cue = bool(title) and sentence_certainty(title)[0] != "stated"
    if title_cue or cues >= int(config.get("certainty.document_rumour_min_cues", 2)):
        return "reported"
    return None


def claim_certainty(sentence: str, floor: str | None) -> tuple[str, str | None]:
    certainty, cue = sentence_certainty(sentence)
    return weaker(certainty, floor), cue


def is_future(sentence: str, cue_start: int = 0, cue_end: int = 0) -> bool:
    """True when the sentence has a future cue outside the part [cue_start, cue_end)."""
    outside = sentence[:cue_start] + " " + sentence[cue_end:]
    return any(p.search(outside) for p in compiled().future)


def is_summary_line(text: str, offset: int) -> bool:
    line_start = text.rfind("\n", 0, offset) + 1
    line = text[line_start:offset + 40].lower().lstrip()
    return any(line.startswith(label) for label in compiled().summary_labels)


def procurement_sentences(text: str) -> list[tuple[str, Span]]:
    """Each sentence that is an open notice or a planned procurement: ("open" | "planned", span)."""
    c = compiled()
    out = []
    for s in sentences(text):
        if any(p.search(s.quote) for p in c.open_notice):
            out.append(("open", clip(text, s, s.start, s.end)))
        elif any(p.search(s.quote) for p in c.planned) and any(pats and any(p.search(s.quote) for p in pats)
                                                               for pats in c.categories.values()):
            out.append(("planned", clip(text, s, s.start, s.end)))
    return out


def procurement_categories(sentence: str) -> list[str]:
    return [cat for cat, pats in compiled().categories.items() if any(p.search(sentence) for p in pats)]


def has_award(text: str) -> bool:
    return any(p.search(text) for p in compiled().award)


def is_negated_driver(sentence: str) -> bool:
    return any(p.search(sentence) for p in compiled().driver_negations)


def theme_matches(theme: str, sentence: str) -> bool:
    c = compiled()
    return any(t == theme and p.search(sentence) for t, _a, p in c.keywords) or \
        any(t == theme and p.search(sentence) for t, p in c.synonyms)


# ---------------------------------------------------------------------------
# Gazetteer
# ---------------------------------------------------------------------------


def _surface_pattern(surface: str) -> re.Pattern:
    words = len(surface.split())
    flags = re.IGNORECASE if words >= int(config.get("mentions.min_case_insensitive_words", 2)) else 0
    return re.compile(r"(?<![\w-])" + re.escape(surface) + r"(?![\w-])", flags)


def gazetteer_mentions(text: str, entities: list[dict], prefer: bool = True) -> list[dict]:
    """Mentions of known entities: {text, type, start, end, entity_id}. The longest match wins."""
    items: list[tuple[str, dict]] = []
    for e in entities:
        for surface in e["surfaces"]:
            items.append((surface, e))
    found = []
    for surface, e in items:
        for m in _surface_pattern(surface).finditer(text):
            found.append((m.start(), m.end(), e))
    found.sort(key=lambda f: (f[0], -(f[1] - f[0]), f[2]["type"], f[2]["entity_id"]))
    out: list[dict] = []
    taken_until = -1
    current: tuple[int, int] | None = None
    for start, end, e in found:
        if current and (start, end) == current:
            if not any(o["type"] == e["type"] and (o["start"], o["end"]) == current for o in out):
                out.append({"text": text[start:end], "type": e["type"], "start": start, "end": end,
                            "entity_id": e["entity_id"]})
            continue
        if start < taken_until:
            continue
        out.append({"text": text[start:end], "type": e["type"], "start": start, "end": end, "entity_id": e["entity_id"]})
        taken_until = end
        current = (start, end)
    return _prefer_names(out, entities) if prefer else out


def _prefer_names(mentions: list[dict], entities: list[dict]) -> list[dict]:
    """One span can match entities of two types (a site alias that is also an organisation name).

    When the span is the name (not only an alias) of exactly one of them, only that entity keeps the mention.
    """
    by_id = {e["entity_id"]: e for e in entities}
    spans: dict[tuple[int, int], list[dict]] = {}
    for m in mentions:
        spans.setdefault((m["start"], m["end"]), []).append(m)
    out = []
    for group in spans.values():
        if len(group) > 1:
            named = [m for m in group if normalise_name(by_id[m["entity_id"]]["surfaces"][0]) == normalise_name(m["text"])]
            if len(named) == 1:
                group = named
        out.extend(group)
    return sorted(out, key=lambda m: (m["start"], m["type"]))


# ---------------------------------------------------------------------------
# Agent 1: Classifier
# ---------------------------------------------------------------------------


def classify(text: str, ctx: dict) -> dict:
    c = compiled()
    title = ctx.get("title") or text.split("\n", 1)[0]
    exclusions = ctx.get("exclusions") or []
    for term in exclusions:
        if _keyword_pattern(term).search(title):
            return {"in_scope": False, "reason": f"exclusion in title: {term}", "sectors": [], "geographies": [],
                    "themes": [], "activity_types": [], "deal_types": [], "evidence": []}
    sents = sentences(text)
    cfg = config.rules().get("classifier") or {}
    event_themes = set(cfg.get("event_themes") or [])
    themes: dict[str, Span] = {}
    act_themes: dict[str, str] = {}
    for s in sents:
        planned = is_future(s.quote)
        for theme, act, p in c.keywords:
            if p.search(s.quote) and not (planned and theme in event_themes):
                themes.setdefault(theme, s)
                act_themes.setdefault(act, theme)
        for theme, p in c.synonyms:
            if p.search(s.quote) and not (planned and theme in event_themes):
                themes.setdefault(theme, s)
    entities = ctx.get("_entities") or []
    mentions = gazetteer_mentions(text, entities)
    by_id = {e["entity_id"]: e for e in entities}
    site_sectors = {c.site_class_sectors.get((by_id.get(m["entity_id"]) or {}).get("site_class") or "")
                    for m in mentions if m["type"] == "site"}
    for theme, others in (cfg.get("theme_suppressed_by_theme") or {}).items():
        if theme in themes and any(o in themes for o in others):
            del themes[theme]
    site_sectors.discard(None)
    for theme, blocked in (cfg.get("theme_suppressed_by_sector") or {}).items():
        other = site_sectors | {x for t in themes if t != theme for x in c.theme_sectors.get(t, [])}
        if theme in themes and other & set(blocked):
            del themes[theme]
    for theme, needed in (cfg.get("theme_requires_sector") or {}).items():
        other = site_sectors | {x for t in themes if t != theme for x in c.theme_sectors.get(t, [])}
        if theme in themes and site_sectors and not other & set(needed):
            del themes[theme]
    acts = [a for a, t in act_themes.items() if t in themes]
    sectors: list[str] = []
    geos: list[str] = []
    for theme in themes:
        for sector in c.theme_sectors.get(theme, []):
            if sector not in sectors:
                sectors.append(sector)
    for m in mentions:
        e = by_id.get(m["entity_id"]) or {}
        if e.get("type") == "site":
            sector = c.site_class_sectors.get(e.get("site_class") or "")
            if sector and sector not in sectors:
                sectors.append(sector)
            for code in (e.get("district"), e.get("province"), e.get("corridor")):
                if code and code not in geos:
                    geos.append(code)
        elif e.get("type") == "organisation":
            # An organisation gives the sectors of the sites that it operates.
            for site_class in e.get("site_classes") or []:
                sector = c.site_class_sectors.get(site_class or "")
                if sector and sector not in sectors:
                    sectors.append(sector)
    short = len(text) <= int(cfg.get("short_text_chars", 0))
    min_hits = 1 if short else int(config.get("sector_cue_min_hits", 2))
    for sector, pats in c.sector_cues.items():
        hits = sum(len(p.findall(text)) for p in pats)
        if hits >= min_hits and sector not in sectors:
            sectors.append(sector)
    for code, p in c.geography:
        if p.search(text) and code not in geos:
            geos.append(code)
    # Parents of districts and provinces.
    for code in list(geos):
        parent = c.geo_parent.get(code)
        while parent:
            if parent not in geos:
                geos.append(parent)
            parent = c.geo_parent.get(parent)
    deal_types = []
    for code, p in c.deal_type_cues:
        if p.search(text) and code not in deal_types:
            deal_types.append(code)
    watched = [m for m in mentions if m["type"] in ("site", "organisation")]
    targeted = ctx.get("source_type") in (cfg.get("targeted_source_types") or [])
    in_scope = bool(sectors or themes) and bool(watched or geos or targeted)
    evidence: list[Span] = []
    for s in themes.values():
        if s not in evidence:
            evidence.append(s)
    if not evidence and watched:
        s = next((x for x in sents if x.start <= watched[0]["start"] < x.end), None)
        if s:
            evidence.append(s)
    if not evidence:
        # The first sentence with a sector cue supports a scope decision from the sector alone.
        cue_pats = [p for sector in sectors for p in c.sector_cues.get(sector, [])]
        s = next((x for x in sents if any(p.search(x.quote) for p in cue_pats)), None)
        if s:
            evidence.append(s)
    evidence = [clip(text, s, s.start, s.end) for s in evidence[:6]]
    reason = (f"themes {sorted(themes)}; entities {[m['text'] for m in watched][:5]}; geographies {geos[:5]}"
              if in_scope else "no theme or no link to a watched entity or geography")
    return {
        "in_scope": in_scope,
        "reason": reason,
        "sectors": sorted(sectors) if in_scope else [],
        "geographies": geos if in_scope else [],
        "themes": sorted(themes) if in_scope else [],
        "activity_types": sorted(acts) if in_scope else [],
        "deal_types": sorted(deal_types) if in_scope else [],
        "evidence": [s.as_dict() for s in evidence] if in_scope else [],
    }


# ---------------------------------------------------------------------------
# Agent 2: Extractor
# ---------------------------------------------------------------------------


def _pattern_mentions(text: str, patterns: list[re.Pattern], stopwords: set[str], kind: str,
                      taken: list[tuple[int, int]], reject: list[str] | None = None,
                      followers: list[str] | None = None) -> list[dict]:
    out = []
    for p in patterns:
        for m in p.finditer(text):
            start, end = m.start(1), m.end(1)
            phrase = text[start:end]
            words = phrase.split(" ")
            while words and words[0] in stopwords:
                start += len(words[0]) + 1
                words = words[1:]
            phrase = " ".join(words)
            if not phrase:
                continue
            name_words = [w for w in words[:-1] if (w[:1].isupper() or re.fullmatch(r"S\d", w)) and w not in stopwords]
            if kind == "project" and not name_words:
                continue
            if kind == "organisation" and (len(words) < 2 or not name_words):
                continue
            if reject and any(phrase.endswith(r) for r in reject):
                continue
            if followers and text[start + len(phrase):].lstrip(" ").split(" ", 1)[0].rstrip(".,;:") in followers:
                continue
            if "\n" in phrase:
                continue
            if any(s <= start < e or s < end <= e for s, e in taken if kind == "organisation"):
                continue
            out.append({"text": phrase, "type": kind, "start": start, "end": start + len(phrase)})
    # One mention per place.
    uniq: dict[tuple[int, int], dict] = {}
    for m in out:
        uniq.setdefault((m["start"], m["end"]), m)
    return sorted(uniq.values(), key=lambda m: m["start"])


def extract_mentions(text: str, ctx: dict) -> list[dict]:
    c = compiled()
    r = config.rules()["mentions"]
    known = gazetteer_mentions(text, ctx.get("_entities") or [])
    taken = [(m["start"], m["end"]) for m in known]
    projects = _pattern_mentions(text, c.project_patterns, set(r["project_stopwords"]), "project", taken)
    orgs = _pattern_mentions(text, c.org_patterns, set(r["organisation_stopwords"]), "organisation", taken,
                             r.get("organisation_reject_heads"), r.get("organisation_reject_followers"))
    known_projects = [m for m in known if m["type"] == "project"]
    out = [{k: m[k] for k in ("text", "type", "start", "end")} for m in known]
    for m in projects:
        if not any(k["start"] <= m["start"] < k["end"] and k["type"] == "project" for k in known_projects):
            out.append(m)
    out.extend(orgs)
    out.sort(key=lambda m: (m["start"], m["type"]))
    return out


def _nearest(mentions: list[dict], types: tuple[str, ...], sent: Span, before: int) -> dict | None:
    """The first mention of the first type in the sentence, else the last earlier mention of the first type."""
    for t in types:
        inside = [m for m in mentions if m["type"] == t and sent.start <= m["start"] < sent.end]
        if inside:
            return inside[0]
    for t in types:
        prior = [m for m in mentions if m["type"] == t and m["start"] < before]
        if prior:
            return prior[-1]
    return None


def _claim(subject: dict | None, subject_type: str, predicate: str, value_text: str | None, value: str | None,
           certainty: tuple[str, str | None], span: Span, obj: dict | None = None) -> dict | None:
    if subject is None:
        return None
    return {
        "subject": subject["text"], "subject_type": subject_type, "predicate": predicate,
        "object": obj["text"] if obj else None, "value_text": value_text, "value": value,
        "certainty": certainty[0], "certainty_cue": certainty[1], "evidence": [span.as_dict()],
    }


def extract_claims(text: str, mentions: list[dict], ctx: dict, alt_sites: list[dict] | None = None) -> list[dict]:
    r = config.rules()["claims"]
    c = compiled()
    floor = document_floor(text, ctx.get("title"))
    main = next((m for m in mentions if m["type"] == "project"), None) or \
        next((m for m in mentions if m["type"] == "site"), None)
    money_cues = {k: config.compile_patterns(v) for k, v in r["money_cues"].items()}
    claims: list[dict] = []
    for sent in sentences(text):
        q = sent.quote
        cert = claim_certainty(q, floor)
        span = clip(text, sent, sent.start, sent.end)

        def subj(types: tuple[str, ...], s: Span = sent) -> dict | None:
            return _nearest(mentions, types, s, s.start) or (main if main and main["type"] in types else None)

        def by_noun(types: tuple[str, ...], q: str = q) -> tuple[str, ...]:
            """The sentence noun ("the mine", "the project") puts its entity type first."""
            for kind, pats in (r.get("subject_nouns") or {}).items():
                if kind in types and any(re.search(p, q, re.IGNORECASE) for p in pats):
                    return (kind, *[t for t in types if t != kind])
            return types

        in_sentence = [m for m in mentions if sent.start <= m["start"] < sent.end]
        site_spans = {(m["start"], m["end"]) for m in in_sentence if m["type"] == "site"}
        other_project = any(m["type"] == "project" and (m["start"], m["end"]) not in site_spans for m in in_sentence)
        # Site status.
        for status, p in c.status_cues:
            m = p.search(q)
            if m and not is_future(q, m.start(), m.end()):
                if status in (config.get("site_status_project_statuses") or []) and other_project:
                    break
                # A site that shares its name with its operator ("Ndola Lime") is still the subject of a status.
                site = _nearest(mentions, ("site",), sent, sent.start) or \
                    _nearest(alt_sites or [], ("site",), sent, sent.start)
                claims.append(_claim(site, "site", "site_status", m.group(0), status, cert, span))
                break
        # Money.
        for s, e, normal in parse_money(q):
            predicate = None
            for pred in ("fuel_price", "contract_value", "capex"):
                if any(p.search(q) for p in money_cues.get(pred, [])):
                    predicate = pred
                    break
            if predicate == "fuel_price":
                claims.append(_claim({"text": "fuel market"}, "market", predicate, q[s:e], normal, cert, span))
            elif predicate == "contract_value":
                claims.append(_claim(subj(("site", "project", "organisation")), "opportunity", predicate, q[s:e],
                                     normal, cert, span))
            elif predicate == "capex":
                claims.append(_claim(subj(("project", "site", "organisation")), "project", predicate, q[s:e],
                                     normal, cert, span))
        # Numbers.
        for predicate, pattern in r["number_cues"].items():
            if predicate == "employees" and any(re.search(p, q, re.IGNORECASE) for p in r.get("employees_exclude") or []):
                continue
            for m in re.finditer(pattern, q, re.IGNORECASE):
                value_text = m.group("value")
                normal = normalise_value("number", value_text)
                if normal is None:
                    continue
                subject_types = ("project", "site", "organisation") if predicate != "employees" \
                    else ("site", "project", "organisation")
                claims.append(_claim(subj(by_noun(subject_types)), "site", predicate, value_text, normal, cert, span))
        # Quantities.
        if any(re.search(p, q, re.IGNORECASE) for p in r.get("production_cues") or []):
            for predicate, pattern in r["quantity_cues"].items():
                for m in re.finditer(pattern, q, re.IGNORECASE):
                    value_text = m.group(0)
                    found = parse_quantities(value_text)
                    if len(found) != 1:
                        continue
                    claims.append(_claim(subj(by_noun(("project", "site"))), "site", predicate, value_text,
                                         found[0][2], cert, span))
        # Dates.
        dates = parse_dates(q)
        if dates:
            for predicate, pats in r["date_cues"].items():
                cue = next((mm for mm in (re.search(p, q, re.IGNORECASE) for p in pats) if mm), None)
                if cue is None:
                    continue
                if predicate == "tender_deadline":
                    if not any(re.search(p, q, re.IGNORECASE) for p in r.get("tender_deadline_context") or []):
                        continue
                    s, e, normal = dates[-1]
                    subject = subj(("project",)) or subj(("site", "organisation"))
                    claims.append(_claim(subject, "opportunity", predicate, q[s:e], normal, cert, span))
                else:
                    after = [d for d in dates if d[0] >= cue.start()]
                    s, e, normal = (after or dates)[0]
                    claims.append(_claim(subj(("project", "site")), "project", predicate, q[s:e], normal, cert, span))
        # Ownership shares: each percentage belongs to the organisation before it. The asset follows the first one.
        percents = parse_percents(q)
        if percents and any(re.search(p, q, re.IGNORECASE) for p in r["percent_cues"]["ownership_percent"]):
            first_end = sent.start + percents[0][1]
            asset = next((m for m in in_sentence if m["start"] >= first_end and m["type"] in ("site", "organisation",
                                                                                                "project")), None)
            previous_end = sent.start
            for s, e, normal in percents:
                owners = [m for m in in_sentence if m["type"] == "organisation" and previous_end <= m["start"] < sent.start + s
                          and (asset is None or m["start"] != asset["start"])]
                owner = owners[-1] if owners else None
                if owner is not None:
                    claims.append(_claim(owner, "organisation", "ownership_percent", q[s:e], normal, cert, span, asset))
                previous_end = sent.start + e
        # Licence number.
        m = re.search(r["licence_number"], q)
        if m:
            claims.append(_claim(subj(("site", "project")), "site", "licence_number", m.group("value"),
                                 m.group("value"), cert, span))
        # Operator.
        if any(re.search(p, q, re.IGNORECASE) for p in r["operates"]):
            org = next((m for m in mentions if m["type"] == "organisation" and sent.start <= m["start"] < sent.end), None)
            site = next((m for m in mentions if m["type"] == "site" and sent.start <= m["start"] < sent.end
                         and (org is None or m["start"] != org["start"])), None)
            if org and site:
                claims.append(_claim(org, "organisation", "operates", None, None, cert, span, site))
        # Buyer roles.
        for predicate, pats in r["buyer_roles"].items():
            for p in pats:
                m = re.search(p, q, re.IGNORECASE)
                if not m:
                    continue
                cue_start, cue_end = sent.start + m.start(), sent.start + m.end()
                orgs = [x for x in mentions if x["type"] == "organisation" and sent.start <= x["start"] < sent.end]
                if not orgs:
                    continue
                if predicate == "buyer_role_owner":
                    gap = int(config.get("claims.owner_max_gap_chars", 12))
                    near = [x for x in orgs if 0 <= cue_start - x["end"] <= gap or 0 <= x["start"] - cue_end <= gap]
                    org = near[0] if near else None
                else:
                    inside = [x for x in orgs if cue_start <= x["start"] < cue_end]
                    after = [x for x in orgs if x["start"] >= cue_end]
                    org = (inside or after or [None])[0]
                project = subj(("project",))
                if org and project:
                    claims.append(_claim(project, "project", predicate, None, None, cert, span, org))
                break
    return _resolve_conflicts(text, [x for x in claims if x])


def _resolve_conflicts(text: str, claims: list[dict]) -> list[dict]:
    """Drop duplicates. A body claim wins over a conflicting claim from a summary line."""
    out: list[dict] = []
    for claim in claims:
        key = (claim["predicate"], normalise_name(claim["subject"]), claim["value"], claim["object"])
        if any((x["predicate"], normalise_name(x["subject"]), x["value"], x["object"]) == key for x in out):
            continue
        out.append(claim)
    result = []
    for claim in out:
        start = claim["evidence"][0]["start"]
        if is_summary_line(text, start):
            rivals = [x for x in out if x is not claim and x["predicate"] == claim["predicate"]
                      and normalise_name(x["subject"]) == normalise_name(claim["subject"])
                      and x["value"] != claim["value"] and not is_summary_line(text, x["evidence"][0]["start"])]
            if rivals:
                continue
        result.append(claim)
    return result


def extract(text: str, ctx: dict) -> dict:
    mentions = extract_mentions(text, ctx)
    alt_sites = [m for m in gazetteer_mentions(text, ctx.get("_entities") or [], prefer=False) if m["type"] == "site"]
    claims = extract_claims(text, mentions, ctx, alt_sites)
    return {"mentions": mentions, "claims": claims}


# ---------------------------------------------------------------------------
# Agent 3: Resolver (choice between candidates)
# ---------------------------------------------------------------------------


def resolve(text: str, ctx: dict) -> dict:
    t = ctx.get("_thresholds") or config.rules()["resolver"]
    creatable = set(t.get("creatable_types") or [])
    decisions = []
    for item in ctx.get("mentions") or []:
        cands = item.get("candidates") or []
        span = item.get("_evidence")
        evidence = [span] if span else []
        best = cands[0] if cands else None
        second = cands[1]["similarity"] if len(cands) > 1 else 0.0
        if best and best["similarity"] >= t["match_similarity"] and best["similarity"] - second >= t["match_margin"]:
            decisions.append({"mention": item["mention"], "decision": "match", "entity_id": best["entity_id"],
                              "confidence": round(float(best["similarity"]), 4),
                              "reason": f"trigram similarity {best['similarity']} to {best['name']}", "evidence": evidence})
        elif (not best or best["similarity"] < t["new_similarity"]) and item.get("type") in creatable:
            decisions.append({"mention": item["mention"], "decision": "new", "entity_id": None,
                              "confidence": float(t["new_entity_confidence"]),
                              "reason": "no candidate is close; the name pattern gives a new entity", "evidence": evidence})
        else:
            decisions.append({"mention": item["mention"], "decision": "no_decision", "entity_id": None,
                              "confidence": round(float(best["similarity"]), 4) if best else 0.0,
                              "reason": "candidates are close but not sufficient", "evidence": evidence})
    return {"decisions": decisions}


# ---------------------------------------------------------------------------
# Agent 4: Lifecycle
# ---------------------------------------------------------------------------


def _stage_rank(code: str) -> tuple[int, int]:
    lc = config.lifecycle_stage_codes()
    return (0, lc.index(code)) if code in lc else (0, -1)


def lifecycle(text: str, ctx: dict) -> dict:
    c = compiled()
    projects = ctx.get("projects") or []
    if not projects:
        return {"projects": []}
    floor = document_floor(text, ctx.get("title"))
    restart_codes = set(config.get("restart_stage_codes", []))
    found: dict[str, list[tuple[str, str, Span, tuple[str, str | None]]]] = {p["project"]: [] for p in projects}
    for sent in sentences(text):
        q = sent.quote
        for stage, p in c.stage_cues:
            m = p.search(q)
            if not m or is_future(q, m.start(), m.end()):
                continue
            owner = None
            for proj in projects:
                if any(sent.start <= s < sent.end for s, _e in proj.get("spans") or []):
                    owner = proj["project"]
                    break
            if owner is None:
                for proj in projects:
                    if any(sent.start <= s < sent.end for s, _e in proj.get("site_spans") or []):
                        owner = proj["project"]
                        break
            if owner is None:
                owner = projects[0]["project"]
            found[owner].append((stage, m.group(0), clip(text, sent, sent.start + m.start(), sent.start + m.end()),
                                 claim_certainty(q, floor)))
    out = []
    order = config.lifecycle_stage_codes()
    restart_order = [s["code"] for s in (ctx.get("restart_path") or [])]
    for name, hits in found.items():
        if not hits:
            continue
        restart_hits = [h for h in hits if h[0] in restart_codes]
        if restart_hits:
            pool = [h for h in hits if h[0] in restart_order]
            best = max(pool, key=lambda h: restart_order.index(h[0]))
        else:
            best = max(hits, key=lambda h: order.index(h[0]) if h[0] in order else -1)
        stage, event, span, cert = best
        out.append({"project": name, "stage": stage, "stage_event": event, "certainty": cert[0],
                    "evidence": [span.as_dict()]})
    return {"projects": out}


# ---------------------------------------------------------------------------
# Agent 5: Scorer judgement (the deterministic backend gives none)
# ---------------------------------------------------------------------------


def judge(text: str, ctx: dict) -> dict:
    return {"judgement": None, "rationale": "The deterministic backend gives no model judgement.", "evidence": []}


# ---------------------------------------------------------------------------
# Agent 7: Summariser (extractive)
# ---------------------------------------------------------------------------


def summarise(text: str, ctx: dict) -> dict:
    limit = int(ctx.get("max_sentences") or config.get("pipeline.summary_max_sentences", 3))
    marks = [tuple(x) for x in ctx.get("_evidence_spans") or []]
    sents = sentences(text)
    chosen: list[Span] = []
    for s in sents:
        if any(s.start < e and b < s.end for b, e in marks) and s.quote not in [c.quote for c in chosen]:
            chosen.append(s)
        if len(chosen) >= limit:
            break
    if not chosen and sents:
        # No evidence sentence: the first sentence (the title) is the summary. The summary never takes other
        # sentences, so that text without evidence (for example an injected instruction) does not reach it.
        chosen.append(sents[0])
    chosen.sort(key=lambda s: s.start)
    out = []
    for s in chosen[:limit]:
        span = clip(text, s, s.start, s.end)
        out.append({"text": span.quote, "evidence": [span.as_dict()]})
    return {"sentences": out}


AGENTS = {
    "classifier": classify,
    "extractor": extract,
    "resolver": resolve,
    "scorer": judge,
    "lifecycle": lifecycle,
    "summariser": summarise,
}
