"""Loaders for the configuration files in config/. Code never holds these values."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from .settings import get_settings


def config_path(*parts: str) -> Path:
    return get_settings().config_dir.joinpath(*parts)


def load_yaml(*parts: str) -> Any:
    with open(config_path(*parts), encoding="utf-8") as fh:
        return yaml.safe_load(fh)


@lru_cache
def stages() -> list[dict]:
    return load_yaml("stages.yaml")["stages"]


@lru_cache
def lifecycle() -> dict:
    return load_yaml("lifecycle.yaml")


@lru_cache
def tiers() -> dict:
    return load_yaml("tiers.yaml")


@lru_cache
def approval_policy() -> dict:
    return load_yaml("approval-policy.yaml")


@lru_cache
def models() -> dict:
    return load_yaml("models.yaml")


@lru_cache
def demand_model() -> dict:
    return load_yaml("demand-model.yaml")


@lru_cache
def taxonomy(name: str) -> Any:
    return load_yaml("taxonomy", f"{name}.yaml")


def stage_codes() -> list[str]:
    return [s["code"] for s in stages()]


def lifecycle_codes() -> list[str]:
    lc = lifecycle()
    codes = [s["code"] for s in lc["stages"]]
    for s in lc.get("restart_path", []):
        if s["code"] not in codes:
            codes.append(s["code"])
    return codes


def clear_caches() -> None:
    for fn in (stages, lifecycle, tiers, approval_policy, models, demand_model, taxonomy):
        fn.cache_clear()
