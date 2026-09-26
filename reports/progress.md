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

## In progress

- M0: audit tooling subagent (tools/audit). The live audit is blocked.
- Track 1 (M3): enrichment agents subagent.
- Track 2 (M5): design system, panel framework and shell subagent.

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
| Docker Hub rate limit (429) for some pulls | Pull again later |
| TLS interception in the sandbox | Optional build secret `extra_ca` in the Dockerfiles |
