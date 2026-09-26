"""Configuration for the enrichment agents. All values come from files in config/ (rule 11)."""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any

from services.common import config as common_config
from services.common.config import load_yaml


@lru_cache
def rules() -> dict:
    return load_yaml("enrichment-rules.yaml")


@lru_cache
def agent_schemas() -> dict:
    return load_yaml("agent-schemas.yaml")


@lru_cache
def eval_targets() -> dict:
    return load_yaml("eval-targets.yaml")


@lru_cache
def lifecycle_intervals() -> dict:
    lc = common_config.lifecycle()
    name = lc.get("intervals_file")
    if not name:
        return {"intervals": lc.get("intervals") or [], "min_projects": lc.get("min_projects_per_interval", 5)}
    return load_yaml(name)


@lru_cache
def activity_types() -> list[dict]:
    return load_yaml("taxonomy", "activity-types.yaml")


@lru_cache
def taxonomy_codes() -> dict[str, set[str]]:
    """The valid codes of each classifier field."""
    sectors = {s["code"] for s in common_config.taxonomy("sectors")["sectors"]}
    geographies = {g["code"] for g in load_yaml("taxonomy", "geographies.yaml")}
    acts = activity_types()
    themes = {a["theme"] for a in acts}
    deal_types = {d["code"] for d in load_yaml("taxonomy", "deal-types.yaml")}
    return {
        "sectors": sectors,
        "geographies": geographies,
        "themes": themes,
        "activity_types": {a["code"] for a in acts},
        "deal_types": deal_types,
    }


@lru_cache
def theme_directions() -> dict[str, str]:
    return {a["theme"]: a["direction"] for a in activity_types()}


@lru_cache
def geographies() -> list[dict]:
    return load_yaml("taxonomy", "geographies.yaml")


@lru_cache
def predicates() -> dict[str, dict]:
    return {p["code"]: p for p in common_config.taxonomy("predicates")["predicates"]}


@lru_cache
def site_statuses() -> list[str]:
    return list(common_config.taxonomy("site-classes")["site_statuses"])


def lifecycle_stage_codes() -> list[str]:
    return common_config.lifecycle_codes()


def reason_codes() -> set[str]:
    return {r["code"] for r in agent_schemas()["quarantine_reason_codes"]}


def model_for(agent: str) -> dict:
    m = common_config.models()
    entry = dict(m["agents"].get(agent) or {})
    entry.setdefault("model", m["defaults"]["model"])
    return entry


def compile_pattern(pattern: str) -> re.Pattern:
    return re.compile(pattern, re.IGNORECASE)


def compile_patterns(patterns: list[str] | None) -> list[re.Pattern]:
    return [compile_pattern(p) for p in patterns or []]


def clear_caches() -> None:
    for fn in (rules, agent_schemas, eval_targets, lifecycle_intervals, activity_types, taxonomy_codes,
               theme_directions, geographies, predicates, site_statuses):
        fn.cache_clear()
    common_config.clear_caches()


def get(path: str, default: Any = None) -> Any:
    """A value of config/enrichment-rules.yaml by a dotted path."""
    node: Any = rules()
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return default
        node = node[part]
    return node
