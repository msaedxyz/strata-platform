"""Demand estimator (M6). Source: docs/03-data-model.md (demand estimate) and config/demand-model.yaml.

Strata estimates the diesel demand of a project (or of a site) with a formula of config/demand-model.yaml.
Each input comes from a fact in the record (EntityAttributeAsserted in proj_fact) with evidence: first a fact of
the project, else a fact of its site. When an input has no fact with evidence, the formula gives no estimate.
The first formula whose inputs all have evidence gives the estimate. The DemandEstimated proposal has the label
"estimate", the formula, the inputs each with its fact event id and evidence ids, the factors and the value.
It goes to review (config/approval-policy.yaml). A model does not produce the estimate.
"""

from __future__ import annotations

import ast
import logging
import operator
import re
from decimal import Decimal

import psycopg

from services.common import config as common_config
from services.common.logging import log

logger = logging.getLogger("strata.enrichment.demand")
AGENT = "demand_estimator"
_NUMBER = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*(.*?)\s*$")
_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}


class FormulaError(ValueError):
    pass


def model_id() -> str:
    return str(common_config.models()["agents"].get(AGENT, {}).get("model") or "none")


def prompt_version() -> str:
    return f"demand-model:{common_config.demand_model().get('version', 'v1')}"


def input_predicates() -> set[str]:
    return {spec["predicate"] for f in common_config.demand_model()["formulas"] for spec in f["inputs"].values()
            if spec.get("predicate")}


def evaluate(expression: str, names: dict[str, float]) -> float:
    """Evaluate a formula of config/demand-model.yaml: names, numbers, + - * / and brackets only."""

    def ev(node: ast.AST) -> float:
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
            return _OPS[type(node.op)](ev(node.left), ev(node.right))
        if isinstance(node, ast.Constant) and isinstance(node.value, int | float):
            return float(node.value)
        if isinstance(node, ast.Name):
            if node.id not in names:
                raise FormulaError(f"the formula uses an unknown name {node.id}")
            return float(names[node.id])
        raise FormulaError(f"the formula has an element that is not allowed: {type(node).__name__}")

    return ev(ast.parse(expression, mode="eval"))


def parse_value(value, units: list[str]) -> float | None:
    """The number of a normalised fact value ("110", "2500000 t/y") when its unit is in the accepted units."""
    if isinstance(value, int | float):
        return float(value) if "" in units else None
    m = _NUMBER.match(str(value))
    if not m or m.group(2) not in units:
        return None
    return float(Decimal(m.group(1)))


def _latest_fact(conn: psycopg.Connection, stream_type: str, stream_id: str, predicate: str) -> dict | None:
    return conn.execute(
        "SELECT * FROM proj_fact WHERE stream_type = %s AND stream_id = %s AND predicate = %s AND superseded_by IS NULL "
        "AND NOT retracted AND cardinality(evidence_ids) > 0 ORDER BY recorded_at DESC, event_id DESC LIMIT 1",
        (stream_type, stream_id, predicate),
    ).fetchone()


def estimate(conn: psycopg.Connection, subjects: list[tuple[str, str]]) -> dict | None:
    """The DemandEstimated payload from the facts of the subjects, in order (the project first, then its site).

    Returns None when no formula has evidence for each input.
    """
    model = common_config.demand_model()
    for formula in model["formulas"]:
        inputs: dict[str, dict] = {}
        for name, spec in formula["inputs"].items():
            found = None
            for stream_type, stream_id in subjects:
                fact = _latest_fact(conn, stream_type, stream_id, spec["predicate"])
                number = parse_value(fact["value"], list(spec.get("units") or [""])) if fact else None
                if fact is not None and number is not None:
                    found = {"value": number, "value_text": str(fact["value"]), "predicate": spec["predicate"],
                             "fact_event_id": fact["event_id"], "evidence_ids": sorted(fact["evidence_ids"]),
                             "certainty": fact["certainty"], "subject_type": stream_type, "subject_id": stream_id}
                    break
            if found is None:
                break  # an input without evidence gives no estimate (docs/03)
            inputs[name] = found
        if len(inputs) != len(formula["inputs"]):
            continue
        if not _evidence_mentions(conn, inputs, formula.get("evidence_must_mention")):
            continue
        factors = dict(formula.get("factors") or {})
        value = evaluate(formula["expression"], {**{k: v["value"] for k, v in inputs.items()}, **factors})
        return {"formula_id": formula["id"], "formula_name": formula.get("name"), "expression": formula["expression"],
                "inputs": inputs, "factors": factors, "value": round(value, 1), "unit": model["unit"], "label": "estimate"}
    return None


def _evidence_mentions(conn: psycopg.Connection, inputs: dict, words: list[str] | None) -> bool:
    """True when the evidence of each input names one of the words (config), or when no words are set.

    The check reads the evidence quote and the title and excerpt of its source. A quote is often the value only
    ("20 MW"), and the words that name the fuel stand next to it. If none of these texts names the fuel, Strata
    gives no estimate. No estimate is better than a wrong one.
    """
    if not words:
        return True
    lowered = [w.lower() for w in words]
    for spec in inputs.values():
        rows = conn.execute(
            "SELECT v.quote, s.title, s.excerpt FROM evidence v JOIN source s ON s.id = v.source_id WHERE v.id = ANY(%s)",
            (spec["evidence_ids"],),
        ).fetchall()
        texts = [" ".join(filter(None, (r["quote"], r["title"], r["excerpt"]))).lower() for r in rows]
        if not any(any(w in t for w in lowered) for t in texts):
            return False
    return True


def _certainty(inputs: dict) -> str:
    order = ["stated", "reported", "speculative"]
    found = [v.get("certainty") or "stated" for v in inputs.values()]
    return max(found, key=lambda c: order.index(c) if c in order else 0) if found else "stated"


def propose(conn: psycopg.Connection, stream_type: str, stream_id: str, *, brief_version_id: str | None = None) -> dict | None:
    """Propose a DemandEstimated event for a project (stream project) or a site (stream entity). Returns the proposal
    row when the estimate is new, else None. The caller commits."""
    from services.governance.proposals import create_proposal, find_by_key

    if stream_type == "project":
        project = conn.execute("SELECT id, name, site_id, demand_estimate FROM proj_project WHERE id = %s",
                               (stream_id,)).fetchone()
        if project is None:
            return None
        subjects = [("project", stream_id)] + ([("entity", project["site_id"])] if project["site_id"] else [])
        name, current = project["name"], project["demand_estimate"]
    else:
        site = conn.execute("SELECT id, name, type, demand_estimate FROM proj_entity WHERE id = %s", (stream_id,)).fetchone()
        if site is None or site["type"] != "site":
            return None
        subjects = [("entity", stream_id)]
        name, current = site["name"], site["demand_estimate"]
    payload = estimate(conn, subjects)
    if payload is None:
        return None
    facts = sorted(v["fact_event_id"] for v in payload["inputs"].values())
    if current and current.get("formula_id") == payload["formula_id"] and \
            sorted(v.get("fact_event_id") for v in (current.get("inputs") or {}).values()) == facts:
        return None
    key = f"demand:{stream_type}:{stream_id}:{payload['formula_id']}:{','.join(facts)}"
    if find_by_key(conn, key):
        return None
    evidence_ids = sorted({i for v in payload["inputs"].values() for i in v["evidence_ids"]})
    source = conn.execute("SELECT source_id FROM evidence WHERE id = %s", (evidence_ids[0],)).fetchone()
    row, created = create_proposal(
        conn, kind="DemandEstimated",
        title=f"{name}: diesel demand estimate {payload['value']:,.0f} {payload['unit'].replace('_', ' ')}",
        events=[{"stream_type": stream_type, "stream_id": stream_id, "event_type": "DemandEstimated", "payload": payload,
                 "evidence_ids": evidence_ids, "certainty": _certainty(payload["inputs"])}],
        created_by_type="agent", created_by=f"enrichment.{AGENT}", model_id=model_id(), prompt_version=prompt_version(),
        source_id=source["source_id"] if source else None, brief_version_id=brief_version_id, idempotency_key=key,
    )
    if created:
        log(logger, logging.INFO, "demand estimate proposed", stream_type=stream_type, stream_id=stream_id,
            formula=payload["formula_id"], value=payload["value"])
    return row
