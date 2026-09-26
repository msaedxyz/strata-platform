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

## In progress

- Track 1 (M3): enrichment agents subagent.
- Track 2: frontend part of M6 (the 18 modules).

## Next

- Track 1: M4 governance after M3.
- M6 modules, then M7 acceptance tests, backtest and the final report.

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
