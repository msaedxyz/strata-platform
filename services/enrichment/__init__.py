"""Enrichment: the seven agents of docs/05-enrichment.md, their guardrails and the evaluation.

Pipeline for one source (services/enrichment/pipeline.py):

1. Classifier: in scope or out of scope, with taxonomy codes.
2. Extractor: mentions and claims with evidence spans.
3. Resolver: each mention to an existing entity, a new entity or no decision.
4. Lifecycle agent: the lifecycle stage of each project.
5. Window forecaster: the procurement window from the lifecycle intervals (no model).
6. Summariser: a short neutral summary with evidence for each sentence.
7. Scorer: the features, the score and the tier from config/tiers.yaml.

The agents write proposals only (services/governance/proposals.py). Only the governance service writes events.
"""
