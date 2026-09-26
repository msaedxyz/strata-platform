# Progress

Last update: 2026-09-26. The lead agent keeps this file current after each task. A new session starts here.

## Done

- The pack files moved into docs/. The build branch is build/strata.
- M1 foundation: schema, event store triggers, hash chain, projector, API with OIDC checks, security log, live stream, Docker Compose, CI, Makefile, `make setup`.
- M1 tests pass locally: 21 Python tests (event store, roles, auth, security log).
- Research: 146 real items in data/snapshots/2026-09-26, 7 backtest events with 19 traces, lifecycle history of 27 projects with the interval script.
- Brief v1 from public research: 20 daily and 37 weekly sites, 71 organisations, 36 themes, 69 Google News queries, 13 news sources, 30 early signal sources, 18 known gaps.
- Projection tests pass: rebuild hash, `as_of`, correction.
- M2 done: brief loader, entity registry from the brief, collectors, pipeline, queue, worker, source API, fixture server. 104 Python tests pass locally. Report: reports/M2.md.

- M0 tooling done (tools/audit, 59 tests on a mock site). The live audit waits for access. Report: reports/M0.md.
- M5 done: design system (33 components, 168 stories), panel framework, shell with OIDC login. 311 unit tests and 39 e2e tests pass. Criteria 1 and 2 are blocked by the missing audit. Report: reports/M5.md.
- Read API for the modules and docs/api-contract.md.
- The Compose stack starts in the sandbox. A login through Keycloak works and the API answers through nginx. The sandbox uses a local override because Docker Hub rate limits the SeaweedFS image.
- M3 done: seven agents, deterministic and Anthropic backends, guardrails, quarantine, proposals, Tier 0 alerts, gold set of 50 documents and a held-out set of 12, eval job in CI. 205 Python tests pass. Held-out extraction precision 0.727 and recall 0.667 are below target. Report: reports/M3.md.
- M6 frontend done: the 18 modules on the design system, 351 unit tests and 77 e2e tests, criteria 5 to 7 pass against mocks. Report: reports/M6-frontend.md.
- The stack enriches the 146 real snapshot items: 128 signals, 27 Tier 0 alerts, 17 demand drivers, 10 projects.
- M4 done: write API, roles, own-proposal 403, Tier 0 alerts on the live stream before approval, telemetry, personal data encryption and erasure. 310 Python tests pass, 1 expected failure (backtest has 7 of 20 events). Held-out 2: precision 0.818, recall 0.643 (below target). Report: reports/M4.md.
- Backtest harness: 7 of 7 events found, median 14.8 months. Fails the 20-event minimum. Report: reports/backtest/results.md.
- M6 done: priority calculator, opportunities from projects, demand estimates, fresh forecasts, evidence ids on every fact, frontend on the real API shapes. Live stream delay 0.004 s on the real API. 335 Python tests, 351 unit tests, 79 e2e tests. Report: reports/M6.md.
- Tokens are removed from all logs (Python log filter and nginx log format).
- M7 e2e suite: 24 Python scenario tests and 8 browser tests on the Compose stack, make e2e targets, CI job e2e, clean clone check, DB restart hardening. The lead fixed bugs B1 (parallel enrichment), B2 (signal feed summary) and B5 (brief activation without entities). Report: reports/M7-e2e.md.
- Tool for the parallel run with Argo: scripts/argo_compare.py.
- The e2e suite passes on the sandbox stack: 24 Python scenario tests, 8 browser tests, 5 performance tests. In CI the clean clone, the log check, the Python scenarios and the browser scenarios pass.
- Final report: reports/final.md.

## In progress

- Nothing. CI run 27 passes every job. The open items need Mohamed (see Next).

## Next

- Mohamed: allow beta.infora.io, news.google.com and the source hosts, set ANTHROPIC_API_KEY, then run the audit and the parallel run with Argo (reports/final.md, sections 8 and 10).
- Add 13 or more backtest events with evidence.

## Problems and workarounds

| Problem | Workaround |
|---|---|
| The network policy denies beta.infora.io | Audit tooling is ready to run. Provisional tokens until the audit runs |
| The network policy denies Google News and the Zambian sources | The collectors are tested on the fixture server. A snapshot of real items from WebSearch fills the dashboard |
| ANTHROPIC_API_KEY is not set | Deterministic backend for the agents |
| The session web search budget (200 calls) is spent | The backtest has 7 events, not 20. Mohamed can raise the budget or add events |
| The MinIO image is not on Docker Hub | SeaweedFS S3 |
| Docker Hub rate limit (429) for some pulls | Pull again later. The sandbox uses the filesystem storage backend in place of SeaweedFS |
| TLS interception in the sandbox | Optional build secret `extra_ca` in the Dockerfiles |
