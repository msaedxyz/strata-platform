# M6 progress report: the Strata modules in the Infora panels (Track 2, frontend)

Date: 2026-09-26. Branch: worktree-agent-a90a5271c7f4414ec (based on build/strata at 39dfa9a, "Add the read API for the modules and the API contract for M4 and M6").

## 1. What we built

1. The 18 Strata modules of docs/07 replace the M5 placeholder panels (apps/web/src/modules/). Each module has a loading state, an empty state and an error state with Retry.
2. An API layer (apps/web/src/api/):
   - reads.ts: the read endpoints of docs/api-contract.md. The compiler checks the path and the query of each call against the generated OpenAPI schema (packages/api-client).
   - types.ts: the response shapes of services/api/routers/read.py and sources.py. The generated schema types these responses as plain objects.
   - writes.ts: the M4 write endpoints, GET /api/proposals, GET /api/telemetry/alerts and GET /api/quarantine, typed by hand from docs/api-contract.md. The lead can move them to the generated client after M4.
   - http.ts: one JSON client with the bearer token and one error shape (the FastAPI detail).
3. A shared read cache (apps/web/src/data/resource.tsx). Two modules that read one endpoint share one request and one copy of the data. A live event reloads the data in the background. The old data stays on screen until the new data comes. A newer load wins over an older load.
4. Live updates: `useLiveEvents` (apps/web/src/live/LiveProvider.tsx) uses the same connection and subscription method as the M5 `useLive` hook. It collects the events of a batch window (200 ms) and gives them in one call, so a burst of events gives one reload. The signal feed patches its list: it reads the newest signals and adds the new ones at the top with the change highlight.
5. Module configuration in apps/web/src/config/modules.ts: the live event types of each module, the batch window, page sizes, limits, the refresh interval of source health, the map view and the world-atlas countries.
6. Cross-module parts (apps/web/src/modules/common/): the selection of an opportunity, a project or a site (the relationship panel and the timeline show it), one detail drawer for sites, opportunities, projects and signals, the action names table and the toast messages, the evidence loader for the provenance control, and the text formats.
7. Five changes to the design system (section 5). All need audit confirmation.
8. The fixture dataset and a mocked API for the end to end tests:
   - apps/web/e2e/fixtures/dataset.ts builds the dataset. Sites, organisations, sources and known gaps come from config/monitoring-brief/v1.yaml. Stages and taxonomies come from config/. Articles, quotes, projects and opportunities are fictional. Their publishers are fictional and their links go to fixtures.strata.test.
   - apps/web/e2e/fixtures/small-dataset.json is the realistic fixture (57 sites, 60 signals, 10 alerts, 8 demand drivers, 16 projects, 24 opportunities, 5 proposals, 43 sources, 6 quarantine items). `pnpm --filter @strata/web fixtures` writes it again.
   - The large dataset (10 000 signals, 500 opportunities) is built in memory for docs/07 criteria 6 and 7.
   - apps/web/e2e/mock-api.ts answers like read.py (filters, order, shapes) and like the M4 contract (roles, 403 for the creator of a proposal, the required reject reason). A write changes the dataset and sends the live events that the database trigger would send.
9. End to end tests, unit tests and screenshots (sections 2 and 6). Screenshots of each workspace with the fixture data are in reports/M6-screenshots/ (1920x1080 and 1440x900, and three overlays at 1920x1080).

## 2. Completion criteria (docs/07 criteria 5 to 8)

The status is from local runs. CI has not run this branch yet, because the branch is not pushed. A criterion counts as met only when its test passes in CI (CLAUDE.md rule 8).

| No. | Criterion | Status | Tests |
|---|---|---|---|
| 5 | A new event appears in its live module 2 s or less after the database commit, on the local stack | Pass against the mocked API only. The test on the real local stack is for M7 | apps/web/e2e/live.spec.ts: "a new signal appears in the signal feed and the ticker, a new Tier 0 alert appears as Unconfirmed, and a new demand driver appears", "a stage move by another analyst shows Pending approval on the Kanban card, and a site status proposal shows the pending status", "an approved proposal leaves the approval queue and the telemetry counts a new acknowledgement", "the timeline is not live: an event does not reload it". Unit: apps/web/test/modules.test.tsx "live batching" (2 tests) |
| 6 | With 10 000 signals and 500 deals, the dashboard is interactive in 3 s or less at 1920x1080 | Pass against the mocked API only, on a production build. Measured cold load: Monitoring 363 ms, Origination 656 ms, Relationships 322 ms, Review 255 ms | apps/web/e2e/perf.spec.ts: "criterion 6: the <workspace> workspace is interactive in 3 s or less with 10 000 signals and 500 deals" (4 tests, one for each workspace), "the feed renders only the items in view: 10 000 signals give a small number of items in the document". The measurements are in apps/web/test-results/perf/*.json |
| 7 | During live feed updates, the browser records no task longer than 200 ms | Pass against the mocked API only, on a production build. Longest task during 50 live updates: no long task (50 ms or more) was recorded | apps/web/e2e/perf.spec.ts: "criterion 7: during 50 live updates of the feed, no task is longer than 200 ms" |
| 8 | Each module in the table works with fixture data and has an end to end test | Pass (mocked API with fixture data) | apps/web/e2e/modules.spec.ts (22 tests: one or more for each module, the empty states, the error state with Retry, the role-aware controls), apps/web/e2e/flows.spec.ts (6 tests: Kanban drag, as of timeline, relationship panel, provenance). Unit: "module registry" has a real component for each module |

### How the tests measure

1. Criterion 5: the test adds a row to the mocked API and sends the live event, as the trigger event_notify does after the commit. The time is from the event to the visible item. It includes the batch window (200 ms) and the reload.
2. Criterion 6: time to interactive is the later of (a) the moment when every module of the workspace has its data (the performance mark `strata:module-ready:<id>` from the first render with data) and (b) the end of the last long task before a quiet window of 1 s. The time starts at the navigation start. The visit is cold (new browser context). The perf project of playwright.config.ts builds the app with the test-only auth into dist-e2e/ and serves it with `vite preview`. The release build (dist/) never has the test-only auth. The perf project runs after the other tests, one test at a time.
3. Criterion 7: a PerformanceObserver records the long tasks from the first script. The test sends 50 SignalScored events (and 5 AlertRaised events), 60 ms apart, then waits for a quiet window.

### Other tests that the task asked for

| Test | Where |
|---|---|
| Kanban drag (docs/09 scenario 4, UI part): the card shows "Pending approval". After an approver approves, the card moves. The timeline shows the event with evidence. As of the previous day shows the old stage | flows.spec.ts "scenario 4 (UI part): a Kanban drag shows Pending approval, after approval the card moves, ..." |
| As of timeline: the control re-queries with as_of (end of the day, UTC) | flows.spec.ts "the as of control re-queries the timeline with as_of and shows the state at the end of that day" |
| Relationship panel (docs/09 scenario 17, UI part): the touchpoint and the next action appear in the relationship panel and in the next actions | flows.spec.ts "scenario 17 (UI part): an analyst logs a touchpoint and sets a next action, and the relationship panel and the next actions show both", "scenario 17 (UI part): the priority list shows No contact found, and Add contact changes it" |
| Provenance: a fact opens its evidence with the span highlighted and the source link | flows.spec.ts "provenance (docs/07 rule 1): ...", "provenance: a source without licence full shows the quote only, with no text around it" |
| Action names (docs/07 rule 5) | Unit: modules.test.tsx "action names". Each e2e write test checks the toast text |
| Unconfirmed, reported and pending items in one style (docs/07 rule 4) | modules.spec.ts "site watch list: ... the pending status in the unverified style ...", and the design system test "StatusBadge (docs/07 rule 4)" |
| Role-aware controls (docs/06) | modules.spec.ts "a viewer sees no write controls ...", the approver tests, "approval queue: proposals with evidence, and the analyst sees no decision buttons", "approve, reject with a required reason, edit and approve, and no Approve on an own proposal" |

## 3. Test results (local)

| Suite | Result |
|---|---|
| `pnpm lint` | 8 of 8 turbo tasks pass. Zero findings (ESLint with strata/no-raw-values, stylelint) |
| `pnpm typecheck` | 9 of 9 turbo tasks pass. The Fact type test passes |
| `pnpm test` | 351 passed, 1 skipped: design system 273 passed and 1 skipped (criterion 1 with the audit), panel framework 19, web 37, lint plugin 22 |
| `pnpm build` | Passes. The check for the test-only auth passes. MapLibre, its worker and the world-atlas data are separate chunks that load only with the map |
| `pnpm --filter @strata/web test:e2e` | 77 passed, 3 skipped (the screenshot script, which runs only with SCREENSHOTS=1): M5 suites 39 (a11y 8, panels 13, shortcuts 11, shell 7), modules 22, flows 6, live 4, perf 6 |
| Axe (quality floor 3) | Zero violations on the four workspaces with the modules loaded, the command input, the shortcut help and the panel picker |

To run the end to end tests on other ports: `E2E_PORT=5274 E2E_PERF_PORT=5275 pnpm --filter @strata/web test:e2e`.

## 4. Modules and their design system components

Each module uses only design system components and token variables. The app CSS (apps/web/src/styles.css) only places components: a toolbar that repeats the DataTable toolbar, a heading that repeats the shortcut help heading, and flex and gap rules with tokens.

| Module | Endpoints | Live | Design system components |
|---|---|---|---|
| Ticker strip (also in the shell ticker slot) | GET /api/ticker | Yes | PanelFrame, TickerStrip, Badge, Drawer, FeedItem, EvidenceQuote |
| Tier 0 alerts | GET /api/alerts?tier=0, POST acknowledge, confirm, dismiss | Yes | PanelFrame, FeedItem, StatusBadge, Badge, Button, Modal, TextArea, Checkbox, Toast, ProvenanceControl, EmptyState, LoadingState, ErrorState |
| Demand drivers | GET /api/demand-drivers | Yes | PanelFrame, FeedItem, Badge, StatusBadge, Sparkline, ProvenanceControl |
| Site watch list | GET /api/sites?watch=all, GET /api/entities/{id} | Yes | PanelFrame, Tabs, DataTable (virtualize above 100 rows), Badge, Fact, Drawer |
| Signal feed | GET /api/signals, GET /api/config/taxonomy | Yes (patch) | PanelFrame, Select, SearchInput, VirtualList, FeedItem, Badge, StatusBadge, ProvenanceControl, Drawer, EvidenceQuote |
| Geographic deal map | GET /api/map, world-atlas countries-50m | Yes | PanelFrame, Select, MapView (boundaries), Drawer, DataTable |
| Kanban stage board | GET /api/config/stages, GET /api/deals, POST /api/deals/{id}/stage | Yes | PanelFrame, KanbanBoard, StatusBadge (Pending approval), Badge, Toast |
| Priority list | GET /api/priority | Yes | PanelFrame, DataTable (virtualize), Badge, StatusBadge, Fact, Drawer, BarChart, Button |
| Project pipeline | GET /api/projects, GET /api/config/stages | Yes | PanelFrame, Badge, BarChart, DataTable, Fact, StatusBadge, Drawer |
| Procurement calendar | GET /api/calendar?months=24 | Yes | PanelFrame, TimelineAxis, DataTable, Badge, Drawer, Fact |
| Relationship panel | GET /api/deals/{id}/relationship, POST contacts, touchpoints, next-action, prequalification | Yes | PanelFrame, Select, Tabs, DataTable, StatusBadge, Fact, Button, Modal, TextInput, TextArea, DatePicker, Toast, EmptyState |
| Next actions | GET /api/deals (next_action) | Yes | PanelFrame, DatePicker, DataTable, Badge, StatusBadge |
| Timeline | GET /api/timeline?as_of=, GET /api/deals | No | PanelFrame, Select, DatePicker, Button, FeedItem, StatusBadge, ProvenanceControl, EmptyState |
| Approval queue | GET /api/proposals?status=pending, GET /api/evidence, POST approve, reject, edit-approve | Yes | PanelFrame, FeedItem, StatusBadge, DataTable, EvidenceQuote, Badge, Button, Modal, TextArea, Toast |
| Quarantine | GET /api/quarantine, GET /api/quarantine/{id} | No | PanelFrame, Select, DataTable, Badge, Drawer, TextArea (read only) |
| Source health | GET /api/sources/health, GET /api/sources/known-gaps | Yes, and every 60 s | PanelFrame, Tabs, DataTable, Badge |
| Brief editor (admin) | GET /api/briefs, /api/briefs/{v}, /api/briefs/diff, POST /api/briefs, POST /api/briefs/{v}/activate | No | PanelFrame, Tabs, DataTable, Select, TextInput, Checkbox, TextArea (code), Button, Badge, Toast |
| Alert telemetry | GET /api/telemetry/alerts | Yes | PanelFrame, Tabs, DataTable, BarChart, StatusBadge |

## 5. Design system changes (needs audit confirmation)

| Change | Why | Stories and tests |
|---|---|---|
| New component VirtualList | docs/07 criteria 6 and 7 need a long feed that renders only the items in view. No component did this. It has no visual style: each item is a FeedItem | Stories: Default (10 000 items), LoadingMore, Loading, Empty, Error. Unit tests: renders a part of 10 000 items, onEndReached, empty and error |
| New component TextArea | The reject reason, the touchpoint note, the edited events (JSON) and the brief (YAML) need text with more than one line. TextInput has one line. It uses the TextInput styles | Stories: Default, Filled, Code, Hover, Focus, Disabled, Loading, Error |
| DataTable option `virtualize` (@tanstack/react-virtual) | 500 opportunities in the priority list and the next actions | Story: Virtualized (500 rows). Unit tests: renders a part of 500 rows with the full aria-rowcount |
| StatusBadge status `false_positive` | docs/06 gives the alert outcome false positive. One label in every module (docs/07 rule 5) | Story: FalsePositive, and AllStatuses |
| MapView options `boundaries`, `highlightId`, `bounds` | The map needs a base layer with no network tiles. MapLibre needs resolved colours, so the layer takes them from `tokenValues` (border.strong, bg.surface-3) | Story: WithBoundaries |

Two fixes in the design system. (1) A click or Enter on a control in a DataTable cell (for example a provenance control) no longer also selects the row. A unit test checks it. (2) The MapView canvas keeps `position: absolute` after the MapLibre stylesheet loads (the stylesheet set `position: relative` and the map had zero height). One accessibility fix: the column resize separator of DataTable now always has aria-valuenow (axe aria-required-attr).

## 6. Decision rows for docs/decisions.md

| Date | Decision | Reason | Document |
|---|---|---|---|
| 2026-09-26 | The modules read through one shared cache. A live event reloads the data in the background and keeps the old data on screen | Two modules share one request. No empty flash on each update | 07 |
| 2026-09-26 | Live modules collect events for 200 ms, then reload once (LIVE_BATCH_MS in apps/web/src/config/modules.ts) | A burst of events gives one reload. It keeps each task short (criterion 7) and the delay far below 2 s (criterion 5) | 07 |
| 2026-09-26 | `useLiveEvents` subscribes to several event types through the same connection as `useLive` | A module listens to several event types. One hook call keeps the hook order fixed | 07 |
| 2026-09-26 | The signal feed loads pages of 200 and patches live: it reads the 50 newest signals and adds the new ones at the top | The API gives 1000 items at most in one call. A full reload of a long list is slow | 07 |
| 2026-09-26 | The design system gets VirtualList, TextArea, DataTable virtualize, the false positive status and MapView boundaries. Each needs audit confirmation | No existing component or variant covered them | 07 |
| 2026-09-26 | The map base layer is world-atlas countries-50m (Natural Earth, public domain, ISC package), converted with topojson-client. It loads only with the map | No network tiles. The build network allows no tile server | 07 |
| 2026-09-26 | The map shows no corridor lines | GET /api/map gives no corridor geometry, and the geography taxonomy has none | 07 |
| 2026-09-26 | The breakdown of the priority score shows in a drawer when the user clicks a row | DataTable has no row expansion. The Drawer is an existing Infora pattern | 07 |
| 2026-09-26 | The project pipeline marks the engagement window with the accent tone in a bar chart of the lifecycle stages and with a badge in the table | BarChart and Badge have tones. No new pattern | 07 |
| 2026-09-26 | Projects without a forecast date show in a table under the calendar with their stage only | TimelineAxis rows show ranges only | 05, 07 |
| 2026-09-26 | The approval queue hides Approve and Edit and approve on a proposal that the user created. Reject stays | docs/06: a user never approves an own proposal. The API enforces it | 06 |
| 2026-09-26 | The panels of feeds, tables, tabs, the map and the ticker have no body padding (flush) | FeedItem and DataTable have their own spacing | 07 |
| 2026-09-26 | The perf tests run on a production build with the test-only auth (dist-e2e/) and `vite preview`, after the other tests | The dev server and the React development build are slower than the product. Other tests must not compete for the CPU | 07 |
| 2026-09-26 | The e2e fixture uses the brief sites and organisations with fictional articles, fictional publishers and the domain fixtures.strata.test | Realistic data with no text attributed to a real outlet | 09 |
| 2026-09-26 | The M4 endpoints are typed by hand in apps/web/src/api/writes.ts | The generated client has no M4 endpoints yet. The lead regenerates it after M4 | 07 |

## 7. New items for docs/assumptions.md

| No. | Subject | Default |
|---|---|---|
| 100 | Shape of GET /api/proposals (M4) | `{"items": [proposal row of db/migrations/0001_core.sql with "events": [{event_type, stream_type, stream_id, payload, evidence_ids, certainty}], and "evidence" optional]}`. Without "evidence", the queue calls GET /api/evidence for all ids |
| 101 | Shape of GET /api/telemetry/alerts (M4) | `{"alerts": [{id, tier, tier_rule, title, status, published_at, fetched_at, raised_at, deliveries: [{channel, delivered_at}], acknowledged_at, acknowledged_by, decided_at, outcome}], "metrics": {latency_fetch_to_alert_seconds: {n, median, p90}, time_to_ack_seconds: {n, median, p90}, false_positive_rate_by_rule: [{tier_rule, alerts, false_positives, rate}]}}` |
| 102 | Shape of GET /api/quarantine (M3) | `{"items": [quarantine row]}`, and GET /api/quarantine/{id} gives one row |
| 103 | Result of POST /api/deals/{id}/stage | `{"proposal_id", "status": "pending"}`. The card shows "Pending approval" from stage_pending of GET /api/deals. Until the reload, the card uses the move that the user sent |
| 104 | Shape of priority_breakdown | An object of parts. A part is a number or an object with contribution, score or value. The key "total" is not a part. Known keys: lead_time, demand, confidence, buyer_fit, no_contact_boost |
| 105 | Certainty as a status | reported gives the status Reported, speculative gives Unconfirmed, stated gives no badge. Both use the one unverified style (docs/07 rule 4) |
| 106 | Pending site status | status_pending shows as "<status>, pending" in the unverified style next to the current status |
| 107 | "As of" date | The end of the chosen day in UTC (YYYY-MM-DDT23:59:59Z) |
| 108 | Time zone and formats | Africa/Lusaka (the brief time zone), locale en-GB. VITE_TIME_ZONE can change the time zone |
| 109 | Ticker counts | The counts show the Tier 0, Tier 1 and Tier 2 signals of the last 24 hours |
| 110 | Live event batch window | 200 ms for each module |
| 111 | Signal feed pages | 200 signals for each page, 50 for each live patch, 300 ms wait for the text filter |
| 112 | Tables that render only the rows in view | More than 100 rows |
| 113 | Source health refresh | Every 60 s, because collector runs are not events. The module also listens to BriefVersionActivated and to "collector_run" live messages |
| 114 | Engagement rows | Contacts, touchpoints, next actions and prequalification rows show the actor and the date, and no provenance control. The team is the source (docs/03) |
| 115 | Owner of a next action | The form gives the user id of the current user. The user can change it |
| 116 | Selection | A click on an opportunity in the Kanban board, the priority list or the next actions selects it for the relationship panel and the timeline. A click on a project or a site selects it for the timeline. The selection is not stored |
| 117 | Map start view | Zambia and its neighbours (21.5 W to 34 E, 18.5 S to 8 S). Zambia is filled. The countries are Zambia, DR Congo, Angola, Tanzania, Zimbabwe, Botswana, Malawi, Namibia and Mozambique |

## 8. Known risks and open items for the lead

1. Every visual value is still provisional (no Infora audit). The five design system changes in section 5 need audit confirmation. If Infora has no such components, they need a design decision.
2. The M4 shapes (proposals, telemetry, stage move result) and the M3 quarantine shape are assumptions (items 100 to 104). The modules read them in a tolerant way, but the lead must check them against M4 and M3 and change apps/web/src/api/writes.ts and the mock (apps/web/e2e/mock-api.ts) if they differ.
3. Criteria 5, 6 and 7 pass against the mocked API only. The real stack adds the API time. Criterion 5 on the local stack is an M7 test. The projector writes the projections in the insert transaction, so a reload after the NOTIFY sees the new row.
4. Rule 1 gaps from the API, not the frontend: GET /api/sites gives no evidence ids for the status and the last signal, GET /api/deals gives none for the stage, and GET /api/map gives none. The drawers show the facts with their evidence where the detail endpoints give it. A small change to read.py (for example status_evidence_ids) would close the gap. Derived numbers (priority score, lead time, telemetry) and source health are not facts from sources.
5. The SSE event name is the event type (services/api/main.py). The approval queue listens to ProposalCreated, ProposalApproved, ProposalRejected and ProposalEditedApproved. If M4 writes no event on a proposal change, the queue updates only after the next write by the user.
6. The Kanban board renders all cards (500 cards in the large dataset). The measured time to interactive of the Relationships workspace is 322 ms, so it is not virtualised.
7. apps/web/e2e/fixtures/small-dataset.json is 0.85 MB, most of it the two brief versions for the brief editor tests.
8. The perf project depends on the e2e project. If an e2e test fails, Playwright skips the perf tests.
9. The M5 test "each placeholder panel shows the empty state with the module name" is now "each panel shows its Strata module". Two M5 tests now look for command options inside the command input only, because the modules add native select elements.
