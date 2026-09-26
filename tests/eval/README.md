# Gold set for the enrichment agents (draft labels)

This directory holds the evaluation data of docs/05-enrichment.md. The labels are a draft. Mohamed reviews them and changes them through docs/decisions.md.

## Content

| Path | Content |
|---|---|
| gold/g01.json to gold/g50.json | 50 synthetic documents with labels. The CI gate uses this set |
| holdout/h01.json to holdout/h12.json | 12 synthetic documents that were written after the rule changes. The runner reports them. They do not gate CI |
| baseline.json | The metrics of the last accepted run for each backend |
| results/latest.json | The result of the last run on the gold set (deterministic backend) |
| results/holdout-latest.json | The result of the last run on the held-out set |

All documents are synthetic. They describe the watched sites and organisations of config/monitoring-brief/v1.yaml, but the events, numbers and names of new companies are invented. Each file has `"synthetic": true`.

## How the labels were made

1. The documents and the labels were written together, from the text only, before the first evaluation run (commit "gold set of 50 synthetic documents with draft labels").
2. The first run gave these results (deterministic backend, final scorer): facts with verified evidence 1.00, extraction precision 0.772, extraction recall 0.698, resolution precision 0.962, classification macro F1 0.892, lifecycle stage accuracy 0.714.
3. The rules in config/enrichment-rules.yaml then changed in general terms. The labels did not change. The only change to a gold file after the first commit is the fetched_at date of g29 (30 September plus one day was an invalid date).
4. Because the rules changed while the gold errors were visible, the gold numbers are optimistic. The held-out set measures the rules on text that they did not see. See reports/M3.md.

## Format of a document

```json
{
  "id": "g05",
  "synthetic": true,
  "note": "...",
  "source": {"type": "rss", "title": "...", "publisher": "...", "url": "...", "published_at": "...",
             "fetched_at": "...", "retention_policy": "verify_then_purge", "read_at_source": false,
             "early_signal": false},
  "text": "Title\n\nBody ...",
  "labels": {
    "in_scope": true,
    "sectors": ["mining"],
    "geographies": ["prov_north_western", "zm"],
    "themes": ["contractor_award", "contract_mining", "mine_expansion"],
    "directions": ["procurement", "project_pipeline"],
    "deal_types": ["contract_mining"],
    "entities": [{"text": "Barrick", "type": "organisation", "resolution": "org:barrick"},
                 {"text": "Lumwana Super Pit Project", "type": "project", "resolution": "new"}],
    "claims": [{"predicate": "fleet_trucks", "subject": "Lumwana Super Pit Project", "value": "45", "certainty": "stated"}],
    "projects": [{"name": "Lumwana Super Pit Project", "stage": "contractor_procurement"}],
    "deal_expected": false,
    "expected_tier": 0
  }
}
```

Rules for the labels:

1. `entities` lists each mention of an organisation, a site or a project. `resolution` is `site:<brief id>`, `org:<brief id>` or `new`. `accept` lists other correct entities when the brief gives the same alias to two entities (for example "Kansanshi Mining Plc" is an organisation and an alias of the Kansanshi mine).
2. `claims` uses the predicates of config/taxonomy/predicates.yaml. `value` is the normal form of services/enrichment/normalisers.py: money "45000000 USD", percent "80%", number "60", quantity "300000 t/y", date "2026-10-15", "2027-Q1" or "2028", status codes of config/taxonomy/site-classes.yaml. A relationship claim gives `object` in place of `value`.
3. `certainty` follows docs/05: words such as "reportedly", "sources say" and "in talks" give reported or speculative. In a rumour article, each claim is reported or speculative.
4. `projects` gives the lifecycle stage code of config/lifecycle.yaml for each named project where the text names the stage or an event of it.
5. `expected_tier` follows the rules of config/tiers.yaml. `deal_expected` is true for an open tender, an EOI, a prequalification notice or a planned contract opportunity.

## Metrics

`python -m services.enrichment.eval` calculates the metrics of docs/05. The definitions are in the docstring of services/enrichment/eval.py. The targets are in config/eval-targets.yaml. The run fails when a metric is below its target, or falls by more than two points against baseline.json.

```
uv run python -m services.enrichment.eval                              # gold set, deterministic backend
uv run python -m services.enrichment.eval --update-baseline            # accept the current numbers
uv run python -m services.enrichment.eval --gold-dir tests/eval/holdout --report-only
STRATA_AGENT_BACKEND=anthropic uv run python -m services.enrichment.eval --backend anthropic
```

## Points for review by Mohamed

1. Tier labels: a new project at any stage is Tier 0 (rule t0_new_project_first_trace), also at steady operation (g11). Confirm this reading of docs/05.
2. g29: an ERB notice with prices unchanged is labelled Tier 2, not a market demand driver.
3. g47: a rumour of a future tender is labelled "no deal".
4. g36, g17: the brief gives "Nakambala" and "NFCA" to two entities. The labels accept only one of them for g36 and do not list "NFCA" for g17. The runner counts these decisions as wrong.
5. Some subject labels are a choice between the site and the organisation (g39, g40). The runner counts the other choice as wrong.
