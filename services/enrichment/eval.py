"""Evaluation of the agents on the gold set (docs/05-enrichment.md, evaluation).

Run: python -m services.enrichment.eval [--backend deterministic|anthropic] [--update-baseline] [--no-fail]

Each gold document (tests/eval/gold/*.json) goes through analyse() with an entity index built from
brief v1 (no database). The runner calculates the metrics of docs/05:

| Metric | Definition |
|---|---|
| canonical_facts_verified | Planned fact events whose evidence spans all pass the exact substring check, over all planned fact events |
| extraction_precision | Accepted claims that match a gold claim (predicate, normalised value, subject), over accepted claims |
| extraction_recall | Gold claims that an accepted claim matches, over gold claims |
| resolution_precision | Correct match and new decisions, over all match and new decisions. A decision on a mention that the labels do not list is wrong |
| classification_macro_f1 | Mean F1 over the classes in_scope, each sector and each activity direction |
| lifecycle_stage_accuracy | Gold projects whose predicted project has the gold stage, over gold projects with a stage |

The targets are in config/eval-targets.yaml. The run fails when a metric is below its target or falls by
more than max_drop_points against tests/eval/baseline.json for the same backend. The result goes to
tests/eval/results/latest.json (or latest-<backend>.json for a backend other than deterministic).
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

import yaml

from services.common.settings import REPO_ROOT

from . import config
from .analysis import Analysis, Doc, analyse
from .backends import select_backend
from .entity_index import MemoryIndex, brief_records
from .normalisers import normalise_name, normalise_value
from .runner import AgentRunner
from .spans import SpanError, verify

METRICS = ["canonical_facts_verified", "extraction_precision", "extraction_recall", "resolution_precision",
           "classification_macro_f1", "lifecycle_stage_accuracy"]


def _path(value: str) -> Path:
    p = Path(value)
    return p if p.is_absolute() else REPO_ROOT / p


def load_gold(gold_dir: Path | None = None) -> list[dict]:
    directory = gold_dir or _path(config.eval_targets()["gold_dir"])
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(directory.glob("*.json"))]


def load_brief() -> dict:
    return yaml.safe_load((REPO_ROOT / "config" / "monitoring-brief" / "v1.yaml").read_text(encoding="utf-8"))


def _dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def run_document(gold: dict, brief: dict, backend) -> tuple[Analysis, AgentRunner]:
    src = gold["source"]
    doc = Doc(
        text=gold["text"], title=src.get("title"), url=src.get("url"), publisher=src.get("publisher"),
        source_type=src.get("type", "rss"), source_id=f"gold:{gold['id']}", published_at=_dt(src.get("published_at")),
        fetched_at=_dt(src.get("fetched_at")), read_at_source=bool(src.get("read_at_source")),
        early_signal=bool(src.get("early_signal")), brief=brief,
    )
    index = MemoryIndex(brief_records(brief))
    runner = AgentRunner(backend)
    counter = iter(range(10_000))
    analysis = analyse(doc, index, runner, lambda kind, key: f"new:{kind}:{key}:{next(counter)}")
    return analysis, runner


# ---------- metrics ----------


def _contains(a: str, b: str) -> bool:
    a, b = normalise_name(a or ""), normalise_name(b or "")
    return bool(a) and bool(b) and (a == b or a in b or b in a)


def _same_project(a: str, b: str) -> bool:
    """Equal names, or one name contains the other and both start with the same word."""
    na, nb = normalise_name(a), normalise_name(b)
    return na == nb or (_contains(na, nb) and na.split()[0] == nb.split()[0])


def _gold_entity(gold: dict, text: str, boundaries: bool = False) -> list[dict]:
    """The labels of a mention text. With boundaries, a label whose text contains the mention or is contained
    in it also counts (a mention boundary can differ from the label, for example "Mopani Mufulira mine" and
    "Mopani Mufulira"). The resolution check still compares entity ids."""
    norm = normalise_name(text)
    exact = [e for e in gold["labels"]["entities"] if normalise_name(e["text"]) == norm]
    if exact or not boundaries:
        return exact
    return [e for e in gold["labels"]["entities"] if _contains(e["text"], text)]


def _resolved_key(analysis: Analysis, text: str) -> set[str]:
    norm = normalise_name(text)
    return {r["entity_id"] for r in analysis.resolutions if normalise_name(r["mention"]) == norm and r.get("entity_id")}


def _is_new(entity_id: str) -> bool:
    return entity_id.startswith("new:")


def score_resolution(gold: dict, analysis: Analysis) -> tuple[int, int, list[dict]]:
    correct = total = 0
    details = []
    for r in analysis.resolutions:
        if r["decision"] not in ("match", "new"):
            continue
        total += 1
        # A new entity must match its label exactly. A match decision can differ in its mention boundary.
        labels = _gold_entity(gold, r["mention"], boundaries=r["decision"] == "match")
        ok = False
        if labels:
            accepted = {x for e in labels for x in [e["resolution"], *e.get("accept", [])]}
            if r["decision"] == "new":
                ok = any(e["resolution"] == "new" and e["type"] == r["type"] for e in labels)
            else:
                ok = r["entity_id"] in accepted
        correct += ok
        details.append({"mention": r["mention"], "type": r["type"], "decision": r["decision"],
                        "entity_id": r["entity_id"], "correct": ok, "labelled": bool(labels)})
    return correct, total, details


def _claim_matches(pred: dict, gold_claim: dict, gold: dict, analysis: Analysis) -> bool:
    if pred["predicate"] != gold_claim["predicate"]:
        return False
    vtype = config.predicates()[pred["predicate"]]["value_type"]
    if vtype == "entity":
        if not _contains(pred.get("object") or "", gold_claim.get("object") or ""):
            obj_ids = _resolved_key(analysis, pred.get("object") or "")
            gold_ids = {e["resolution"] for e in _gold_entity(gold, gold_claim.get("object") or "")}
            if not (obj_ids & gold_ids):
                return False
    else:
        gold_value = gold_claim.get("value")
        if vtype != "enum":
            # The labels give values in normal form. The normaliser makes the form exact (for example the case of a text).
            gold_value = normalise_value(vtype, gold_value) or gold_value
        if pred.get("normalised") != gold_value:
            return False
    if pred.get("subject_type") == "market" or gold_claim["subject"] == "fuel market":
        return pred.get("subject_type") == "market" and gold_claim["subject"] == "fuel market"
    if _contains(pred["subject"], gold_claim["subject"]):
        return True
    pred_ids = _resolved_key(analysis, pred["subject"])
    gold_ids = {x for e in _gold_entity(gold, gold_claim["subject"]) for x in [e["resolution"], *e.get("accept", [])]}
    return bool(pred_ids & gold_ids)


def score_claims(gold: dict, analysis: Analysis) -> dict:
    excluded = set(config.eval_targets().get("extraction_excluded_predicates") or [])
    preds = [c for c in analysis.claims if c["predicate"] not in excluded]
    golds = [c for c in gold["labels"]["claims"] if c["predicate"] not in excluded]
    used: set[int] = set()
    tp = certainty_ok = 0
    details = []
    for p in preds:
        match = next((i for i, g in enumerate(golds) if i not in used and _claim_matches(p, g, gold, analysis)), None)
        if match is not None:
            used.add(match)
            tp += 1
            certainty_ok += p["certainty"] == golds[match].get("certainty", "stated")
        details.append({"predicate": p["predicate"], "subject": p["subject"], "value": p.get("normalised"),
                        "object": p.get("object"), "certainty": p["certainty"], "matched": match is not None})
    missed = [g for i, g in enumerate(golds) if i not in used]
    return {"tp": tp, "predicted": len(preds), "gold": len(golds), "certainty_ok": certainty_ok, "details": details,
            "missed": missed}


def _classes(labels: dict, prefix_in_scope: bool) -> set[str]:
    out = set()
    if prefix_in_scope:
        out.add("in_scope")
    out |= {f"sector:{s}" for s in labels.get("sectors", [])}
    out |= {f"direction:{d}" for d in labels.get("directions", [])}
    return out


def score_lifecycle(gold: dict, analysis: Analysis) -> tuple[int, int, list[dict]]:
    correct = total = 0
    details = []
    for gp in gold["labels"].get("projects") or []:
        if not gp.get("stage"):
            continue
        total += 1
        pred = next((p for p in analysis.projects if _same_project(p["name"], gp["name"])), None)
        ok = bool(pred) and pred.get("stage") == gp["stage"]
        correct += ok
        details.append({"project": gp["name"], "gold_stage": gp["stage"], "predicted": pred.get("stage") if pred else None,
                        "found": bool(pred), "correct": ok})
    return correct, total, details


def evaluate(backend_name: str | None = None, gold_dir: Path | None = None) -> dict:
    backend = select_backend(backend_name)
    brief = load_brief()
    golds = load_gold(gold_dir)
    per_doc = []
    fact_events = fact_verified = 0
    res_ok = res_total = 0
    tp = n_pred = n_gold = cert_ok = 0
    lc_ok = lc_total = 0
    tier_ok = tier_total = deal_ok = 0
    class_counts: dict[str, list[int]] = {}
    quarantine: dict[str, int] = {}
    for gold in golds:
        analysis, runner = run_document(gold, brief, backend)
        for q in runner.quarantine:
            quarantine[q.reason_code] = quarantine.get(q.reason_code, 0) + 1
        for f in analysis.facts:
            for ev in f.events:
                fact_events += 1
                try:
                    for s in ev.spans:
                        verify(gold["text"], s.as_dict())
                    fact_verified += bool(ev.spans)
                except SpanError:
                    pass
        c, t, res_details = score_resolution(gold, analysis)
        res_ok, res_total = res_ok + c, res_total + t
        cl = score_claims(gold, analysis)
        tp, n_pred, n_gold, cert_ok = tp + cl["tp"], n_pred + cl["predicted"], n_gold + cl["gold"], cert_ok + cl["certainty_ok"]
        lo, lt, lc_details = score_lifecycle(gold, analysis)
        lc_ok, lc_total = lc_ok + lo, lc_total + lt
        labels = gold["labels"]
        predicted_in = analysis.status == "in_scope"
        pred_labels = {"sectors": (analysis.classification or {}).get("sectors", []) if predicted_in else [],
                       "directions": analysis.directions if predicted_in else []}
        gold_classes = _classes(labels, labels["in_scope"])
        pred_classes = _classes(pred_labels, predicted_in)
        for cls in gold_classes | pred_classes:
            counts = class_counts.setdefault(cls, [0, 0, 0])
            if cls in gold_classes and cls in pred_classes:
                counts[0] += 1
            elif cls in pred_classes:
                counts[1] += 1
            else:
                counts[2] += 1
        if labels["in_scope"]:
            tier_total += 1
            tier_ok += analysis.tier == labels.get("expected_tier")
        deal_ok += bool(analysis.deals) == bool(labels.get("deal_expected"))
        per_doc.append({
            "id": gold["id"], "status": analysis.status, "gold_in_scope": labels["in_scope"], "tier": analysis.tier,
            "tier_rule": analysis.tier_rule, "expected_tier": labels.get("expected_tier"),
            "sectors": pred_labels["sectors"], "gold_sectors": labels.get("sectors", []),
            "directions": pred_labels["directions"], "gold_directions": labels.get("directions", []),
            "themes": (analysis.classification or {}).get("themes", []), "gold_themes": labels.get("themes", []),
            "deals": [d["deal_type"] for d in analysis.deals], "deal_expected": labels.get("deal_expected"),
            "claims": cl["details"], "missed_claims": cl["missed"], "resolutions": res_details, "lifecycle": lc_details,
            "quarantine": [{"agent": q.agent, "reason_code": q.reason_code} for q in runner.quarantine],
        })
    f1s = {}
    for cls, (ctp, cfp, cfn) in sorted(class_counts.items()):
        if ctp + cfp + cfn:
            f1s[cls] = round(2 * ctp / (2 * ctp + cfp + cfn), 4)
    metrics = {
        "canonical_facts_verified": round(fact_verified / fact_events, 4) if fact_events else 1.0,
        "extraction_precision": round(tp / n_pred, 4) if n_pred else 0.0,
        "extraction_recall": round(tp / n_gold, 4) if n_gold else 0.0,
        "resolution_precision": round(res_ok / res_total, 4) if res_total else 0.0,
        "classification_macro_f1": round(sum(f1s.values()) / len(f1s), 4) if f1s else 0.0,
        "lifecycle_stage_accuracy": round(lc_ok / lc_total, 4) if lc_total else 0.0,
    }
    extra = {
        "certainty_accuracy_on_matched_claims": round(cert_ok / tp, 4) if tp else None,
        "tier_accuracy": round(tier_ok / tier_total, 4) if tier_total else None,
        "deal_accuracy": round(deal_ok / len(golds), 4) if golds else None,
        "counts": {"documents": len(golds), "fact_events": fact_events, "claims_predicted": n_pred, "claims_gold": n_gold,
                   "claims_matched": tp, "resolution_decisions": res_total, "lifecycle_projects": lc_total},
        "class_f1": f1s,
        "quarantine_reason_codes": quarantine,
    }
    return {"backend": backend.name, "model_id": backend.model_id("classifier"),
            "prompt_version": backend.prompt_version("classifier"), "metrics": metrics, "extra": extra,
            "documents": per_doc}


def check(result: dict, baseline: dict | None) -> list[str]:
    cfg = config.eval_targets()
    failures = []
    for name, target in cfg["targets"].items():
        value = result["metrics"].get(name)
        if value is None or value < float(target) - 1e-9:
            failures.append(f"{name} = {value} is below the target {target}")
    base = (baseline or {}).get(result["backend"])
    if base:
        drop = float(cfg.get("max_drop_points", 2)) / 100
        for name in METRICS:
            old, new = base["metrics"].get(name), result["metrics"].get(name)
            if old is not None and new is not None and new < old - drop - 1e-9:
                failures.append(f"{name} fell from {old} to {new} (more than {cfg.get('max_drop_points', 2)} points)")
    return failures


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate the agents on the gold set")
    parser.add_argument("--backend", default="deterministic")
    parser.add_argument("--update-baseline", action="store_true")
    parser.add_argument("--no-fail", action="store_true")
    parser.add_argument("--gold-dir", default=None, help="another set, for example tests/eval/holdout")
    parser.add_argument("--report-only", action="store_true",
                        help="write the result without the targets and the baseline (for the held-out set)")
    args = parser.parse_args(argv)
    cfg = config.eval_targets()
    gold_dir = _path(args.gold_dir) if args.gold_dir else None
    result = evaluate(args.backend, gold_dir)
    results_path = _path(cfg["results"])
    if gold_dir is not None:
        results_path = results_path.with_name(f"{gold_dir.name}-latest.json")
    if result["backend"] != "deterministic":
        results_path = results_path.with_name(results_path.stem + f"-{result['backend']}.json")
    if args.report_only:
        result["failures"] = []
        results_path.parent.mkdir(parents=True, exist_ok=True)
        results_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(json.dumps({"backend": result["backend"], "set": str(gold_dir or cfg["gold_dir"]),
                          "metrics": result["metrics"], "counts": result["extra"]["counts"]}, indent=2))
        return 0
    results_path.parent.mkdir(parents=True, exist_ok=True)
    baseline_path = _path(cfg["baseline"])
    baseline = json.loads(baseline_path.read_text()) if baseline_path.exists() else {}
    failures = check(result, baseline)
    result["failures"] = failures
    results_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if args.update_baseline:
        baseline[result["backend"]] = {"metrics": result["metrics"], "prompt_version": result["prompt_version"],
                                       "model_id": result["model_id"]}
        baseline_path.write_text(json.dumps(baseline, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"backend": result["backend"], "metrics": result["metrics"],
                      "extra": {k: v for k, v in result["extra"].items() if k != "class_f1"}, "failures": failures},
                     indent=2))
    return 1 if failures and not args.no_fail else 0


if __name__ == "__main__":
    sys.exit(main())
