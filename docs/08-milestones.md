# 08. Milestones

Do the milestones in this sequence. A milestone ends when all its completion criteria pass in CI.

| Milestone | Scope | Exit |
|---|---|---|
| M0 | Audit of Infora | docs/01-audit.md criteria |
| M1 | Repository, Docker Compose, CI, database schema, event store constraints, OIDC login | docs/02-architecture.md criteria and docs/03-data-model.md criteria 1 to 3 |
| M2 | Monitoring Brief and collectors | docs/04-ingestion.md criteria |
| M3 | Agents, validators, quarantine, gold set draft | docs/05-enrichment.md criteria 1 to 3 |
| M4 | Evaluation targets, governance, roles, alerts, telemetry, personal data | docs/05-enrichment.md criteria 4 to 7, docs/06-governance.md criteria, docs/03-data-model.md criteria 4 to 6 |
| M5 | Design system, panel framework, shell | docs/07-frontend.md criteria 1 to 4 |
| M6 | Strata modules, lifecycle agent, window forecaster, relationship features | docs/07-frontend.md criteria 5 to 8 |
| M7 | End to end tests and hardening | docs/09-acceptance.md, including the lead time backtest. Final report |

## Progress report at the end of each milestone

Write the report to reports/<milestone>.md and continue with the next milestone. The report has these sections:

1. What you built.
2. A table of each completion criterion with the status pass or fail and the test name.
3. New items in docs/assumptions.md.
4. Each change to this pack, from docs/decisions.md.
5. The known risks for the next milestone.
