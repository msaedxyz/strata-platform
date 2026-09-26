"""Scorer rules: the score from the brief weights and the tier from config/tiers.yaml.

docs/05, scorer rule 4: the tier comes from the rules in config/tiers.yaml. The rules use the features
only. A model never assigns a tier. The small rule engine below reads the rules:

- all: {feature: value, ...}  every feature has the value
- any: [{...}, {...}] or {feature: value, ...}  at least one condition holds
- not: {...}  the condition does not hold

Rules are checked in order. The first rule that matches gives the tier.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from services.common import config as common_config

from . import config


def _holds(cond: Any, features: dict) -> bool:
    if isinstance(cond, dict):
        if set(cond) <= {"all", "any", "not"}:
            return all(_rule_part(k, v, features) for k, v in cond.items())
        return all(features.get(k) == v for k, v in cond.items())
    if isinstance(cond, list):
        return all(_holds(c, features) for c in cond)
    return bool(cond)


def _rule_part(kind: str, cond: Any, features: dict) -> bool:
    if kind == "all":
        return _holds(cond, features)
    if kind == "any":
        if isinstance(cond, list):
            return any(_holds(c, features) for c in cond)
        return any(features.get(k) == v for k, v in cond.items())
    if kind == "not":
        return not _holds(cond, features)
    raise ValueError(f"unknown rule part {kind}")


def rule_matches(rule: dict, features: dict) -> bool:
    parts = {k: v for k, v in rule.items() if k in ("all", "any", "not")}
    if not parts:
        return False
    return all(_rule_part(k, v, features) for k, v in parts.items())


def derive_threshold_features(features: dict) -> dict:
    for name, spec in (common_config.tiers().get("feature_thresholds") or {}).items():
        value = features.get(spec["feature"])
        features[name] = value is not None and value >= spec["min"]
    return features


def assign_tier(features: dict) -> tuple[int | None, str | None]:
    derive_threshold_features(features)
    for tier in common_config.tiers()["tiers"]:
        for rule in tier["rules"]:
            if rule_matches(rule, features):
                return int(tier["tier"]), rule["id"]
    return None, None


def score(features: dict, weights: dict, published_at: datetime | None, fetched_at: datetime | None,
          judgement: float | None) -> tuple[float, dict]:
    """The score and its full breakdown (docs/05, scorer rule 3)."""
    contributions: dict[str, float] = {}
    watch = 0.0
    if features.get("watch_daily"):
        watch = float(weights.get("watch_daily", 0))
    elif features.get("watch_weekly"):
        watch = float(weights.get("watch_weekly", 0))
    if watch:
        contributions["watch"] = watch
    for direction in features.get("directions") or []:
        w = float(weights.get(f"theme_direction_{direction}", 0))
        if w:
            contributions[f"theme_direction_{direction}"] = w
    if features.get("early_signal_source"):
        contributions["early_signal_source"] = float(weights.get("early_signal_source", 0))
    certainty = features.get("certainty") or "stated"
    contributions[f"certainty_{certainty}"] = float(weights.get(f"certainty_{certainty}", 0))
    if judgement is not None:
        contributions["model_judgement"] = round(float(judgement) * float(config.get("scoring.judgement_weight", 1.0)), 4)
    base = sum(contributions.values())
    half_life = float(weights.get("recency_days_half_life") or 0)
    age_days = None
    recency = 1.0
    if half_life and published_at and fetched_at:
        age_days = max(0.0, (fetched_at - published_at).total_seconds() / 86400)
        recency = 0.5 ** (age_days / half_life)
    total = round(base * recency, 4)
    return total, {
        "contributions": contributions, "base": round(base, 4), "recency_factor": round(recency, 4),
        "age_days": round(age_days, 2) if age_days is not None else None, "weights": weights,
    }
