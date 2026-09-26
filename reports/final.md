# Strata: final report

Date: 26 September 2026. Branch: `build/strata` (the same commits are on `claude/strata-build-lead-ued2py`).

This report is for Mohamed. It gives the status of each completion criterion, the backtest results, the assumptions, the known gaps and the steps to start the parallel run with Argo. Mohamed signs off (CLAUDE.md, definition of done, condition 3).

## 1. Summary

Strata runs. `docker compose up` starts all services from a clean clone. A user logs in through Keycloak and sees the Strata dashboard in the four workspaces. The agents turn real Zambian items into signals, Tier 0 alerts, demand drivers, projects and opportunities. An approver approves proposals. An analyst adds contacts and logs touchpoints. CI proves the milestone criteria and the 17 acceptance scenarios on a clean clone of the Compose stack.

Strata is NOT complete yet. The build environment blocked four inputs, so four conditions of the lead command stay open:

| Open condition | Cause | What removes it |
|---|---|---|
| 1:1 replica of the Infora design (design rule, docs/07 criteria 1 to 3 against Infora) | The network policy of the build environment denies beta.infora.io. No Infora source was available | Allow beta.infora.io, then run `make audit` and `pnpm --filter @strata/design-system tokens:sync` (README, "Replace the provisional design") |
| Collectors on the real sources in brief v1 (stop condition 3) | The network policy denies news.google.com and the Zambian source sites | Run Strata on a machine or environment that can reach the sources. The collectors, the robots.txt rules and the rate limits are tested on the fixture server |
| Lead time backtest with 20 or more events (stop condition 8) | The session limit of 200 web searches ended after 7 events | Add 13 or more events with evidence to tests/backtest/, or raise the search limit and run the research again |
| Agents on the Anthropic models | ANTHROPIC_API_KEY was not set | Put the key in `.env`. The Anthropic backend is tested with a mocked client only |

I think the product is ready for the parallel run with Argo once the first two inputs exist. The design parity work needs the audit first.

## 2. How the build ran

The lead agent ran the milestones with subagents, as the lead command asked. After M0 and M1, Track 1 did M2, M3 and M4 in sequence, and Track 2 did M5 at the same time. Track 2 then started the frontend part of M6 against a written API contract (docs/api-contract.md). An integration step joined the two tracks. M7 added the end to end suite on the Compose stack. docs/decisions.md records each change to the pack. reports/M0.md to reports/M7-e2e.md are the milestone reports.

## 3. Status of each completion criterion

Status values: Pass (the test passes in CI), Pass, local only (the test passes locally, CI does not run it), Blocked (an input is missing), Fail.

### docs/01 Audit of Infora (M0)

| No. | Criterion | Status | Test or evidence |
|---|---|---|---|
| 1 | Each route in views.md or gaps.md | Blocked. The tool passes on a mock site | tools/audit/tests/audit-e2e.spec.ts (CI job "Infora audit tool tests") |
| 2 | Each computed value maps to a token | Blocked. The tool passes on a mock site | check-tokens, audit-e2e.spec.ts, unit.spec.ts |
| 3 | components.md lists each component with its states | Blocked. The tool passes on a mock site | audit-e2e.spec.ts |
| 4 | layout-system.md with screenshot sequences | Blocked. The tool passes on a mock site | audit-e2e.spec.ts |
| 5 | gitleaks on /audit gives zero findings | Blocked. The tool passes on a mock site | audit-e2e.spec.ts |
| 6 | network.md shows no data change except the login | Blocked. The tool passes on a mock site | guard.spec.ts, audit-e2e.spec.ts |
| 7 | Shortcuts, command input and focus order in behaviour.md | Blocked. The tool passes on a mock site | audit-e2e.spec.ts |
| 8 | The M0 report summarises the audit and gaps.md | Blocked | reports/M0.md describes the tool and the gaps only |

### docs/02 Architecture (M1)

| No. | Criterion | Status | Test or evidence |
|---|---|---|---|
| 1 | `docker compose up` starts all services from a clean clone | Pass | CI job "End to end acceptance tests on the Docker Compose stack": clean checkout, `make setup`, `docker compose up --build --wait`, start-up log check |
| 2 | One command loads the fixture data | Pass | `make fixtures` (scripts/load_fixtures.py), used by the e2e suite |
| 3 | CI runs frontend tests, Python tests, linters and gitleaks | Pass | .github/workflows/ci.yml |
| 4 | README setup in ten steps or fewer | Pass | README.md, "Start Strata (ten steps)" |
| 5 | OpenAPI schema, and CI builds the typed client | Pass | CI job "OpenAPI schema and typed client" |

### docs/03 Data model (M1, M4)

| No. | Criterion | Status | Test |
|---|---|---|---|
| 1 | UPDATE, DELETE, TRUNCATE fail for every role | Pass | test_event_store.py::test_event_table_rejects_change_for_every_role, e2e test_s07 |
| 2 | A fact event without evidence fails | Pass | test_event_store.py::test_fact_without_evidence_is_rejected_by_database |
| 3 | The hash chain check reports zero breaks | Pass | test_event_store.py::test_hash_chain_has_no_breaks |
| 4 | Rebuild gives the same projection hashes | Pass | test_projections.py::test_rebuild_gives_same_projection_hashes, e2e test_s09 |
| 5 | `as_of` gives the stage before and after a change | Pass | test_projections.py::test_as_of_returns_stage_before_and_after_change |
| 6 | A correction supersedes the old fact, which stays in history | Pass | test_projections.py::test_correction_supersedes_old_fact_and_keeps_history |
| 7 | An engagement event with an agent actor fails | Pass | test_event_store.py::test_engagement_event_with_agent_actor_fails |
| 8 | A DemandEstimated event without input evidence fails | Pass | test_event_store.py::test_demand_estimate_without_input_evidence_fails |

### docs/04 Ingestion (M2)

All 14 criteria pass in CI on the fixture server. reports/M2.md gives the test for each criterion (test_collectors_*.py, test_c04_01 to test_c04_14). The collectors did not run on the real sources, because the network policy blocks them (section 1).

### docs/05 Enrichment (M3, M4)

| No. | Criterion | Status | Test |
|---|---|---|---|
| 1 | All seven agents run on the fixture documents | Pass | test_enrichment_fixtures.py::test_c05_01_all_seven_agents_run_on_fixture_documents |
| 2 | Zero canonical facts without verified evidence | Pass | test_c05_02_sql_check_finds_zero_facts_without_verified_evidence, e2e test_s12 |
| 3 | All adversarial tests pass | Pass | test_c05_03_* (4 tests) |
| 4 | The evaluation meets the targets on the gold set | Pass on the gold set, deterministic backend. See section 4 for the held-out sets, which are below target | test_c05_04_evaluation_meets_targets, CI job "Agent evaluation on the gold set" |
| 5 | Each quarantine record shows its reason code in the API | Pass | test_c05_05_quarantine_reason_code_in_api |
| 6 | Lifecycle agent correct for 85 percent or more of the gold projects | Pass (14 of 14) | test_c05_06_lifecycle_agent_accuracy_85_percent |
| 7 | Each forecast shows intervals and evidence, no date below five projects | Pass | test_c05_07_forecast_shows_intervals_and_evidence_and_no_date_below_five_projects |

### docs/06 Governance (M4)

| No. | Criterion | Status | Test |
|---|---|---|---|
| 1 | A Viewer gets 403 on each write endpoint | Pass (all write routes, found from the OpenAPI schema) | test_governance_api.py::test_c06_01_viewer_gets_403_on_each_write_endpoint, e2e test_s05 |
| 2 | A user who approves an own proposal gets 403 | Pass | test_c06_02_a_user_cannot_approve_an_own_proposal, e2e test_s06 |
| 3 | Each default in the approval policy has a test | Pass | test_governance_policy.py::test_c06_03_* |
| 4 | A Tier 0 alert reaches the frontend as Unconfirmed before any approval | Pass | test_governance_alerts.py::test_c06_04_*, browser test "a new Tier 0 alert appears live as Unconfirmed" |
| 5 | The telemetry API returns all values and metrics | Pass | test_c06_05_telemetry_returns_every_value_and_metric_for_fixture_alerts |
| 6 | After erasure no personal fields, and the hash chain check passes | Pass | test_c06_06_after_erasure_the_api_returns_no_personal_fields_and_the_chain_passes, e2e test_s10 |

### docs/07 Frontend (M5, M6)

| No. | Criterion | Status | Test |
|---|---|---|---|
| 1 | The design system contains every token in /audit/tokens.json | Blocked. The provisional token test passes | packages/design-system/test/tokens.test.ts (the audit test skips with "blocked") |
| 2 | Visual test against the audit screenshots, 1 percent or less | Blocked. The test skips with "blocked: no Infora audit" | packages/design-system/visual/visual.spec.ts |
| 3 | Each layout behaviour and shortcut has an e2e test with the Infora result | Pass against the provisional behaviour. Blocked against Infora | apps/web/e2e/panels.spec.ts, shortcuts.spec.ts |
| 4 | The raw value lint rule gives zero findings | Pass | packages/eslint-plugin-strata tests, `pnpm lint` |
| 5 | A new event in its live module in 2 s or less, on the local stack | Pass. Kanban move 0.2 s, Tier 0 alert 0.3 s on the Compose stack | tests/e2e/browser/tests/05-live.spec.ts, tests/python/test_m6_live.py |
| 6 | Interactive in 3 s or less with 10 000 signals and 500 deals | Pass on the Compose stack in the sandbox (2.0 s to 2.5 s). CI result: see section 9 | tests/e2e/browser/tests/perf.spec.ts |
| 7 | No task longer than 200 ms during live updates | Pass on the Compose stack in the sandbox. CI result: see section 9 | tests/e2e/browser/tests/perf.spec.ts |
| 8 | Each module works with fixture data and has an e2e test | Pass | apps/web/e2e/modules.spec.ts (22 module tests) |

### docs/09 Acceptance scenarios (M7)

All 17 scenarios pass in CI on the Compose stack with the fixture server (tests/e2e/python, 24 tests: test_s01 to test_s17, and tests/e2e/browser, 8 tests). reports/M7-e2e.md gives the test names. The lead fixed three product bugs that M7 found: B1 (two enrichment runs at the same time made two entities for one company), B2 (the signal feed rendered an object and blanked the Monitoring workspace) and B5 (brief activation through the API did not create the entities of new watched sites).

### Stop conditions of the lead command

| No. | Condition | Status |
|---|---|---|
| 1 | `docker compose up` from a clean clone with no errors | Pass (CI e2e job, start-up log check) |
| 2 | A user logs in and sees the dashboard in the Infora design | Login and dashboard: pass (real Keycloak login in the browser tests). Infora design: blocked, the tokens are provisional |
| 3 | Collectors on the real sources fill the dashboard with real Zambian items | Partial. The dashboard shows 146 real Zambian items from the research snapshot, enriched by the agents. The collectors could not reach the real sources |
| 4 | Ticker, alerts, drivers, feed, map, pipeline, calendar, priority list, Kanban, relationship panel, timeline and approval queue work with real data | Pass with the snapshot data (reports/final-screenshots/). The pipeline and the calendar are sparse, because titles give few lifecycle stages (section 8) |
| 5 | An approver approves a proposal. An analyst adds a contact and logs a touchpoint | Pass (browser tests 02 and 04, and the approvals on the real data) |
| 6 | Every criterion in docs/01 to docs/07 passes in CI | Fail: docs/01 criteria 1 to 8 and docs/07 criteria 1 and 2 are blocked by the missing audit |
| 7 | Every scenario in docs/09 passes | Pass |
| 8 | The lead time backtest passes | Fail on the count condition (7 of 20 events). The two docs/09 conditions pass (section 5) |
| 9 | The README tells how to start, use and deploy Strata | Pass |

## 4. Agent evaluation

Deterministic backend (rules). The Anthropic backend has no numbers, because the build could not reach the model.

| Set | Extraction precision | Extraction recall | Resolution precision | Classification macro F1 | Lifecycle | Facts with verified evidence |
|---|---|---|---|---|---|---|
| Target | 0.90 | 0.75 | 0.95 | 0.85 | 0.85 | 1.00 |
| Gold set (50 documents) | 0.952 | 0.952 | 0.973 | 0.985 | 14 of 14 | 1.00 |
| Held-out set 1 (12 documents, no longer blind) | 0.900 | 0.750 | 0.971 | 0.938 | 3 of 3 | 1.00 |
| Held-out set 2 (12 documents, one run) | 0.818 | 0.643 | 0.971 | 0.951 | 4 of 4 | 1.00 |

I think the held-out set 2 numbers are the honest measure of the rules. The rules were improved while the gold errors were visible, so the gold numbers are optimistic. Extraction on unseen text is below target. The Anthropic backend is the planned remedy. Run `python -m services.enrichment.eval` with the key set, and compare.

## 5. Lead time backtest

The harness (services/backtest, config/backtest.yaml) replays the traces of each event in date order through the pipeline with the deterministic backend, with no access to later sources. reports/backtest/results.md has the full table.

| Event | Date | Project | First Strata signal | Lead time |
|---|---|---|---|---|
| EV-007 (before the window) | 2023-07-04 | Kansanshi S3 | 2022-05-09, board sign-off of the S3 expansion | 13.8 months |
| EV-001 | 2023-12-12 | Lumwana Super Pit | 2023-07-07, "Great Future Beckons for Lumwana" | 5.2 months |
| EV-002 | 2024-09-30 | Lumwana Super Pit | 2023-07-07 (same) | 14.8 months |
| EV-004 | 2026-04-10 | Mopani fleet | 2023-12-22, ZCCM-IH transaction announcement on Mopani | 27.6 months |
| EV-006 | 2026-04-28 | Zambia Lobito rail | 2025-06-24, AfDB USD 1 bn and Zambia rail pact | 10.1 months |
| EV-003 | 2026-06-22 | Mopani underground | 2023-12-22 (same as EV-004) | 30.0 months |
| EV-005 | 2026-09-17 | KCM tailings leach plant | 2024-07-22, Vedanta regains control of KCM | 25.9 months |

| Condition | Value | Status |
|---|---|---|
| An earlier signal for 70 percent or more of the events | 7 of 7 (100 percent) | Pass |
| Median lead time six months or more | 14.8 months | Pass |
| 20 or more events (docs/09 step 1) | 7 | Fail |

Misses: none among the 7 events. Limits:

- The dataset has 7 events, because the search budget ended. The backtest does not pass.
- Six of the seven hits come from title words or the operator company, not from entity links. With entity links only, Strata finds 3 of 7 (median 13.8 months).
- The research agent found the traces with the outcome known. The lead times are an upper limit.

## 6. Assumptions

docs/assumptions.md has all rows. The most important for Mohamed to review:

| No. | Subject | Default |
|---|---|---|
| 15 | Infora design values | Provisional tokens until the audit runs |
| 16 | Model backend | Anthropic when the key is set, else the deterministic rules |
| 17 | Legal basis for personal data | Legitimate business interest. Retention 24 months after the last touchpoint, then erasure by key deletion |
| 19 | Demand model factors | Planning defaults in config/demand-model.yaml |
| 21 | Real data in the build environment | The research snapshot of 146 items |
| 22 | Collector schedule | Daily at 05:00 and weekly on Monday at 05:00, Africa/Lusaka |
| 140 to 144 | Backtest rules | Replay, signal, match order, median and window |

The stages in config/stages.yaml and config/lifecycle.yaml, the tier rules in config/tiers.yaml and the approval policy in config/approval-policy.yaml are the pack defaults. Mohamed confirms them.

## 7. Changes to the pack

docs/decisions.md records every change with its date and reason. The main changes:

1. The lead command replaces the pack where they differ. Two tracks run after M0 and M1 (CLAUDE.md working order changed).
2. Brief v1 comes from public research, because the Argo snapshot and the Argo host files were not available.
3. The agents have a deterministic backend for use without the key.
4. PostgreSQL runs from timescale/timescaledb-ha:pg16. SeaweedFS replaces MinIO.
5. A DealStageChanged event from a person carries the reason of the person, not source evidence (docs/03 allows this).
6. Tokens are removed from all logs. nginx writes paths without the query string.

## 8. Known gaps

| Gap | Effect | Next step |
|---|---|---|
| No Infora audit | The design is not proven to be a 1:1 replica | Allow beta.infora.io, run `make audit`, `tokens:sync`, the visual tests, and fix each difference |
| No access to the real sources | The collectors ran on the fixture server only. Source health shows each real source as failed in the sandbox | Run with network access. Check each "Derived" URL in v1.yaml on the first run (reports/notes/research-brief.md) |
| No Anthropic key | Extraction on unseen text is below target with the rules | Set the key and run the evaluation |
| Backtest has 7 events | The backtest fails the 20-event minimum | Add events with evidence |
| Titles only in the snapshot | Few lifecycle stages, no dated forecasts on the real data. The project pipeline and the calendar are sparse | Full article text from the real collectors and the Anthropic backend |
| Lifecycle intervals | Only feasibility to procurement (n = 6) and financing to procurement (n = 5) have five or more projects. 17 milestones need a human check ("VERIFY:" notes) | Check config/lifecycle-history.yaml, add projects |
| 36 of 57 watched sites have no coordinates | They do not show on the map | Add OpenStreetMap or Wikidata coordinates with their licence |
| No company ids (PACRA, LEI, ISIN) in the brief | Resolution uses names only | Add ids to v1.yaml as a new brief version |
| Known gaps in the brief (18) | Government Gazette, PACRA, the Mining Cadastre, job postings, paid sources and the DRC side of the corridor are not collected | Manual upload by analysts. The source health panel lists them |
| Password grant in the development realm | The tests use it. A production realm must turn it off | README, "Deploy Strata", step 4 |
| Lead time in the priority list | It counts from the last relevant event, not from today | Decide whether a daily recalculation is needed |

## 9. CI state at the end of the build

The last CI runs pass every job except as stated here. See the Actions page of the repository for the run of the final commit. The e2e job ran the Python scenarios and the browser scenarios with success on a clean clone. The performance step of the e2e job failed once because the test split the compose command wrongly. The fix is in commit "e2e: split the compose command on any whitespace".

## 10. Start the two-week parallel run with Argo

1. Give the Strata environment outbound HTTPS to news.google.com and to the source hosts in config/monitoring-brief/v1.yaml.
2. Set `ANTHROPIC_API_KEY` and `STRATA_CONTACT_EMAIL` in `.env`.
3. Start the stack: `make setup`, then `docker compose up -d --build`.
4. Check the source health panel after the first 05:00 run (Africa/Lusaka). Fix each source that fails, and record the fix in docs/decisions.md.
5. Compare the live Argo files (/home/atlas/agents/argo/monitoring-brief.md and sources.md) with v1.yaml. Add each difference as a new brief version through the brief editor.
6. Each day for 14 days, export the Argo items as JSON Lines or CSV with `title`, `url`, `reported_at` and `source`.
7. Each day, an approver works the approval queue and confirms or dismisses the Tier 0 alerts, so the telemetry has outcomes.
8. After 14 days, run `docker compose exec api python -m scripts.argo_compare --argo /path/argo.jsonl --from <day 1> --to <day 14>`.
9. Read reports/parallel-run/results.md. Strata passes at 95 percent or more. Record the first finder of each shared item and the reason for each miss in this report.
10. Mohamed signs off.
