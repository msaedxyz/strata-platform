# Decisions

Record each decision that changes this pack or that chooses between options.

| Date | Decision | Reason | Document |
|---|---|---|---|
| 2026-09-26 | The first focus is Zambia mining and industrials. Brief v1 comes from the Argo brief | Mohamed gave the Argo brief | 04, v1.yaml |
| 2026-09-26 | A deal is a commercial opportunity. Stages changed to match | The Argo brief tracks diesel demand at sites, not company transactions | 03 |
| 2026-09-26 | Agents propose new sources. Only an admin approves them | Argo edits its own source list. Strata keeps brief changes under governance | 04, 06 |
| 2026-09-26 | Sites in google_news_only are never fetched directly | These sites block direct access | 04 |
| 2026-09-26 | The goal is lead time. Strata tracks projects from their first public trace and forecasts procurement | Mohamed wants opportunities many months before competitors | CLAUDE.md, 03, 04, 05 |
| 2026-09-26 | Claude Code does not wait for answers. Open questions became assumptions | Mohamed asked for no blocking questions | CLAUDE.md, assumptions.md |
| 2026-09-26 | Progress reports replace the stops at checkpoints | Same reason | 08 |
| 2026-09-26 | Strata adds no visual pattern that Infora does not have | Strata must be an exact replica of Infora | CLAUDE.md, 07 |
| 2026-09-26 | Relationship and prequalification tracking added | Tenders for prequalified suppliers only are a known gap. The team must be on the list before the tender | 03, 07 |
| 2026-09-26 | The lead command from Mohamed replaces the pack where they differ. The command asks for a 1:1 design replica, subagents, two parallel tracks after M0 and M1, work on branch build/strata, and a final report | Mohamed gave the command. The command says that it wins over the pack | CLAUDE.md, 08 |
| 2026-09-26 | Working order: after M0 and M1, Track 1 does M2, M3 and M4 in sequence. Track 2 does M5 at the same time. M6 starts when both tracks meet their criteria | The lead command asks for two parallel tracks | CLAUDE.md, 08 |
| 2026-09-26 | The pack files moved from the repository root into docs/ and docs/reference/ | CLAUDE.md gives these paths | CLAUDE.md |
| 2026-09-26 | Work goes to branch build/strata. The same commits also go to the session branch claude/strata-build-lead-ued2py | The lead command names build/strata. The build session needs its own branch | CLAUDE.md |
| 2026-09-26 | M0 continues as tooling only. The live audit waits for network access to beta.infora.io | The network policy of the build environment denies beta.infora.io. INFORA_REPO_PATH is not set | 01, 07 |
| 2026-09-26 | The design system uses provisional tokens until the audit runs. `pnpm tokens:sync` replaces them with audit/tokens.json | The build cannot take visual values from Infora. All components use tokens only, so the swap needs no code change | 07 |
| 2026-09-26 | config/monitoring-brief/v1.yaml is built from public research. The Argo snapshot and the Argo host files are not available | The pack refers to v1.yaml but the repository does not contain it | 04, v1.yaml |
| 2026-09-26 | The agents use the Anthropic API when ANTHROPIC_API_KEY is set. Without the key they use a deterministic backend that uses the taxonomy and rules | The key is not set in the build environment. The pipeline must run end to end | 05, config/models.yaml |
| 2026-09-26 | PostgreSQL runs from the image timescale/timescaledb-ha:pg16 | This image has PostGIS, pgvector and pg_trgm. The build network cannot install extensions | 02 |
| 2026-09-26 | Object storage uses SeaweedFS with its S3 API in place of MinIO | The MinIO image is not on Docker Hub. SeaweedFS is S3 compatible | 02 |
| 2026-09-26 | The migration runner creates two roles. strata_owner owns the schema. strata_app has INSERT and SELECT only on the event table. A trigger rejects UPDATE, DELETE and TRUNCATE for every role | 03 constraints 1 and 2 | 03 |
| 2026-09-26 | The database calculates the sequence and the hash chain in a trigger. The function check_hash_chain() gives each break | One place for the hash rule. The check uses the same function | 03 |
| 2026-09-26 | The insert trigger rejects an event that cites evidence that does not exist or is not verified | Rule 1 and 05 criterion 2 | 03, 05 |
| 2026-09-26 | Projections are pure folds of the event streams. The API uses the same folds for `as_of` reads | One rule for current state and past state. A rebuild gives the same hash | 03 |
| 2026-09-26 | The pending state of a deal stage or a site status comes from the ProposalCreated event in the proposal stream | The Kanban card and the watch list must show Pending approval, and a rebuild must keep it | 03, 07 |
| 2026-09-26 | Event payload schemas are in config/event-schemas.yaml | Rule 11 keeps schemas out of code | 03 |
| 2026-09-26 | Keycloak runs from the image keycloak/keycloak on Docker Hub. The realm file takes the development password from an environment variable | Rules 4 and 5 keep secrets out of files | 02, 06 |
| 2026-09-26 | Deal stages and lifecycle stages use snake_case codes in configuration with the pack names as labels | Codes are stable keys. Labels can change | 03 |
| 2026-09-26 | Stop the search for more real items when the session web search budget of 200 calls ends. Do not start new sessions to get more searches | The budget is a limit that the environment sets. Mohamed can raise it | 04, 09 |
| 2026-09-26 | The backtest dataset is partial, with 7 events and 19 traces. Add events before the backtest runs as a pass or fail test | The session web search budget ran out. The minimum in 09 is 20 events | 09, tests/backtest |
| 2026-09-26 | Add the event type equipment_order to the backtest data | Orders for mine fleets and plant equipment show diesel demand. The type list had no type for them | 09, tests/backtest/events.yaml |
| 2026-09-26 | The text of a backtest trace is its title only, unless a source shows the exact words | A search summary is not a quote. Rule 1 needs a real text span | 09, tests/backtest/traces.yaml |
| 2026-09-26 | Keep EV-007 (Kansanshi S3, July 2023) with a flag. Exclude it from a strict window | The event is about three months before the window. Its data is verified | 09, tests/backtest/events.yaml |
| 2026-09-26 | Record the basis of each date in the note field. Most dates come from the URL path or the article id | Search results do not always show a date. The basis lets a reviewer check the date | 09, tests/backtest |
| 2026-09-26 | A company level trace counts as a trace of the project, with a note | New owners and new capital at a mine come before its contracts. The note shows that the trace does not name the work | 09, tests/backtest/traces.yaml |
| 2026-09-26 | Keep the historical milestones in config/lifecycle-history.yaml. Make the intervals with scripts/compute_lifecycle_intervals.py into config/lifecycle-intervals.generated.yaml | Rule 11 keeps intervals in configuration. A script makes the intervals repeatable and shows the projects that support them | 05 |
| 2026-09-26 | config/lifecycle.yaml takes its intervals from config/lifecycle-intervals.generated.yaml | 05 says to store the intervals in config/lifecycle.yaml. One generated source prevents two different copies | 05 |
| 2026-09-26 | Use the earliest date of each stage for each project | The forecaster needs the first time that a project reaches a stage | 05 |
| 2026-09-26 | Convert a month date to day 15, a quarter date to day 15 of the middle month, and a year date to 1 July | Many sources give only a month, a quarter or a year | 05 |
| 2026-09-26 | Set a negative interval to 0 if it is inside the date uncertainty. Remove a larger negative interval from the statistics and list it as out of order | Owners often award contracts before or with the financing. The output must show these cases but must not give a negative median | 05 |
| 2026-09-26 | Forecast procurement dates only from feasibility (n = 6) and financing_fid (n = 5). Show the stage only for stages 5, 6 and 7 and for the restart path | Fewer than five historical projects support the other intervals | 05 |
| 2026-09-26 | An owner-funded board approval is financing_fid. A concession agreement is licence_granted | The lifecycle has no separate stage for these events | 03 |
| 2026-09-26 | The lifecycle agent accepts a stage 9 or stage 10 event before stage 4 | Kamoa-Kakula awarded contractor work before its PFS and DFS | 03, 05 |
| 2026-09-26 | A milestone with a note that starts with "VERIFY:" needs a human check before the forecaster uses it in production | The search summary gave the date but not the exact page | 05, 06 |
| 2026-09-26 | Use a research snapshot of real items, collected with WebSearch, to fill the dashboard until the collectors can reach the sources | Direct fetch to news sites and Google News is blocked in the build environment | 04, data/snapshots/2026-09-26/README.md |
| 2026-09-26 | Snapshot items have title, URL, publisher, date and search query only. They use the licence link_only | This matches the Google News item. No article text was read | 04 |
| 2026-09-26 | Keep published_at null when no date shows in the URL or the result. Allow "YYYY-MM" when only the month is known | Do not guess a date. Lead time calculations need true dates | 04, 05 |
| 2026-09-26 | The snapshot has 146 items, not 250 | The session web search budget ended after 35 searches. No item was invented | data/snapshots/2026-09-26/README.md |
| 2026-09-26 | Agriculture and industry is a known gap in the snapshot | The search budget ended before these searches | 04, data/snapshots/2026-09-26/README.md |
| 2026-09-26 | The topic field is a label from the search query group, not a fact from the source | Rule 1 needs facts to link to a source span. The topic is not a canonical fact | 03, data/snapshots/2026-09-26/README.md |
| 2026-09-26 | Brief v1 was built from public research with WebSearch | The Argo files and config/monitoring-brief/v1.yaml were not in the repository or on the host | 04, v1.yaml |
| 2026-09-26 | Items that the research could not find are known gaps or null fields. No value was guessed | The session web search budget ended after about 55 searches | v1.yaml |
| 2026-09-26 | All sources other than Google News use licence code verify_then_purge. The collector confirms reachability and terms on its first run | The build environment blocks direct fetches, so no page or terms of use were read | 04, v1.yaml |
| 2026-09-26 | Where no feed URL was found, a source uses the root or a section of a domain from a result. The verification text marks it as derived | Search results gave article URLs but not feed URLs | v1.yaml |
| 2026-09-26 | Site coordinates come only from Wikipedia or Wikidata values in search results. Mindat is not used. 36 of 57 sites have geometry null | docs/03 forbids invented coordinates. The search budget ended before the district centre lookups | 03, v1.yaml |
| 2026-09-26 | status_hint "producing" means "in operation" for power, industrial, transport, border and fuel_supply sites | The status list comes from mines | v1.yaml |
| 2026-09-26 | Site entries can have two optional fields: corridor and note | Corridors link border and transport sites to geography codes. Notes show what the research did not confirm | v1.yaml |
| 2026-09-26 | Early signal sources can have an extra source type market_regulator (ERB, Ministry of Energy) | ERB price decisions are Tier 0 market demand drivers but are not one of the nine early signal types | 04, v1.yaml |
| 2026-09-26 | The google_news_only list is a conservative default of e-paper, subscription and paywalled domains | Direct access was not tested | 04, v1.yaml |
| 2026-09-26 | Activity type codes use the format theme__keyword_slug. A spelling variant gets a numeric suffix | Each keyword needs a unique code | 05, activity-types.yaml |
| 2026-09-26 | fuel_shortage and pipeline_outage have direction demand_up. border_delay and erb_price_change have direction demand_down | A shortage or outage makes customers need another supply. Delays and price rises reduce consumption. Tier rules treat all four as market demand drivers | 05, v1.yaml |
| 2026-09-26 | Geography codes include zw, bw, mw, na, corr_chirundu_beitbridge and corr_trans_caprivi | The watched border posts connect to these countries and corridors | 05, geographies.yaml |
| 2026-09-26 | The province parents of Chirundu and Shibuyunji districts need confirmation | Research did not confirm them | geographies.yaml |
| 2026-09-26 | external_ids are empty for all organisations | Research found no PACRA, LEI, ISIN or SEDAR numbers | v1.yaml |
| 2026-09-26 | The two proposed sources are Copperbelt Katanga Mining and the Logistics Cluster Zambia fuel assessment | They cover the DRC side of the corridor and fuel supply infrastructure | 04, v1.yaml |
| 2026-09-26 | Claude Sonnet 5 runs with no temperature parameter and with thinking disabled. Claude Haiku 4.5 runs with temperature 0 | Sonnet 5 rejects the temperature parameter. 05 guardrail 7 asks for the lowest randomness that the model allows | 05, config/models.yaml |
| 2026-09-26 | The brief key of an entity is unique for each entity type, not over all entities (migration 0100) | Brief v1 uses the id tazara for a site and for an organisation | 03, v1.yaml |
| 2026-09-26 | Normalisation keeps the indentation of each line. It removes trailing spaces, fixes line endings and applies NFC | The evidence spans in the brief YAML text must keep their meaning. docs/04 asks only for NFC and line endings | 04 |
| 2026-09-26 | The HTTP client does the retries and the runner writes the dead_letter row. Procrastinate does not retry collect jobs | One place for the retry rule, and tests can use a fake clock | 04 |
| 2026-09-26 | Code outside the worker defers jobs through a synchronous Procrastinate connector. The worker replaces the connector of the app at start | The collectors and the API are synchronous. The settings are read at run time, not at import | 02, 04 |
| 2026-09-26 | The OCR fallback uses opencv-python-headless. A uv override removes opencv-python | The GUI build of OpenCV needs libxcb, which the slim image does not have. The apt mirror is blocked in the build environment, so Tesseract is not in the local image | 02, 04 |
| 2026-09-26 | Each collector test module uses a fresh database. conftest.py imports the collector fixtures | A collector run changes shared state. Criteria 1 and 4 need a clean start | 04 |
| 2026-09-26 | Brief sources can have the types rss, atom, web, sitemap and pdf, and an optional credentials_env | docs/04 lists pages and sitemaps. Web rule 4 needs a way to name credentials. No brief gives credentials, so the collectors never log in | 04 |
| 2026-09-26 | The fixture documents are synthetic articles about the watched sites | docs/05 allows synthetic documents. The build cannot fetch the real sources | 04 |
| 2026-09-26 | Fixed the ruff rule B905 in scripts/compute_lifecycle_intervals.py | CI runs `ruff check services tests scripts`. The check failed before M2 | 02 |
| 2026-09-26 | Test role passwords come from a hash of the test admin URL | Roles are cluster wide. Random passwords let two test sessions break each other | tests/python/conftest.py |
| 2026-09-26 | M0 delivers the audit tool in tools/audit and tests it on a local mock site. The live audit runs when access exists | The egress policy blocks beta.infora.io and INFORA_REPO_PATH is not set | 01, 08 |
| 2026-09-26 | The browser blocks each non-GET request. Only the login request and the final log out request can pass | Read actions only. This also proves criterion 6 | 01 |
| 2026-09-26 | The final log out request counts as a session request, not as a change of data | Access rule 8 asks for a log out at the end | 01 |
| 2026-09-26 | The crawler clicks only controls on a safe-click allow list. A deny list always wins. The lists are in tools/audit/config/audit.config.json | Access rules 4 and 5. CLAUDE.md rule 11 | 01 |
| 2026-09-26 | The audit records a panel interaction only when it sends no non-GET request. An interaction that tries to persist to the server goes to gaps.md without screenshots | The audit must not change data | 01 |
| 2026-09-26 | tokens.json uses the DTCG 2025.10 format. font.numeric is a group with an extension, because DTCG has no token type for font-variant-numeric | The format must be valid DTCG | 01, 07 |
| 2026-09-26 | A colour, font size or spacing value with no named role becomes an extra token named x-<value> | Criterion 2 needs a token for each value | 01, 07 |
| 2026-09-26 | The token collector skips colours of elements in a running colour transition, and spacing values above 200px | These values are between two states or come from layout (margin: auto). They are not tokens | 01 |
| 2026-09-26 | The sensitive-page check reads the page content without the navigation, the header and the menus | Navigation labels such as "API keys" are on every page | 01 |
| 2026-09-26 | gitleaks runs from the zricethezav/gitleaks Docker image when no gitleaks binary is present | Criterion 5 must run in any environment with Docker | 01 |
| 2026-09-26 | The design tokens are provisional: a dense dark palette with system fonts. `pnpm tokens:sync` replaces them after the audit | The build network blocked beta.infora.io. No audit exists | 07, 01 |
| 2026-09-26 | Tokens use the DTCG 2025.10 format. A generator makes CSS variables and a typed TS object. Components use only the variables | The audit can change the whole look with no code change | 07 |
| 2026-09-26 | A second token file (strata.component.tokens.json) holds structural sizes. Each size refers to a base token where one fits | The base token groups have no sizes for controls, rails and borders | 07 |
| 2026-09-26 | The icon set is lucide-react, provisional | The Infora icon set is unknown | 07, 01 |
| 2026-09-26 | Layouts stay in localStorage under versioned keys for each user and workspace, behind a LayoutStore interface | The Infora method is unknown. A server store can replace it | 07 |
| 2026-09-26 | The keyboard shortcuts are provisional (apps/web/SHORTCUTS.md) | The Infora shortcuts are unknown | 07 |
| 2026-09-26 | The raw value rule also applies to the design system components. Only the token files hold raw values | Stricter than docs/07 rule 6. It keeps each component token-only | 07 |
| 2026-09-26 | The visual parity test skips with "blocked: no Infora audit (beta.infora.io unreachable)" when the audit is missing | A pass without the audit would be false | 07 |
| 2026-09-26 | Axe must find zero violations until audit/a11y.md gives the Infora baseline | No baseline exists | 07 |
| 2026-09-26 | The text.tertiary token is #808a96 | Contrast of 4.5:1 on each surface (axe color-contrast) | 07 |
| 2026-09-26 | Each module can be in a workspace once. The panel id is the module id | Simple and testable. The audit can change it | 07 |
| 2026-09-26 | The maximised panel is a view state. It is not stored | Esc or restore goes back. The stored layout stays the same | 07 |
| 2026-09-26 | A test-only auth driver exists only when VITE_E2E_AUTH=mock. The production build fails if it contains the driver | End to end tests run with no Keycloak. Production never has a bypass | 07, 06 |
| 2026-09-26 | OIDC tokens stay in sessionStorage | Less exposure than localStorage | 06 |
| 2026-09-26 | The brief editor panel shows only for the admin role | docs/06: the admin manages brief versions. The API enforces | 06 |
| 2026-09-26 | The map uses an empty style when VITE_MAP_STYLE_URL is not set | Tests need no tiles. The tile source follows assumption 7 | 07 |
| 2026-09-26 | @playwright/test is pinned to 1.56.1 | It matches the Chromium build in the build environment. CI installs the same browser | 02 |
| 2026-09-26 | TypeScript stays at 5.9 | typescript-eslint supports TypeScript below 6.1 | 02 |
| 2026-09-26 | A CI job runs the Playwright end to end and visual tests | A criterion counts only when its test passes in CI | 08 |
| 2026-09-26 | The Strata modules use the Infora components in the table in section 6 | docs/07 asks for this record | 07 |

## Infora components for each Strata module

docs/07 asks to record the Infora components that each module uses. The list uses the provisional component inventory from M5. The audit must confirm it.

| Module id | Infora components |
|---|---|
| ticker | PanelFrame, TickerStrip, Badge |
| tier0-alerts | PanelFrame, FeedItem, StatusBadge, Button, Toast, ProvenanceControl, EmptyState, LoadingState, ErrorState |
| demand-drivers | PanelFrame, FeedItem, Badge, Fact, Sparkline |
| site-watch-list | PanelFrame, DataTable, StatusBadge, Fact, Drawer |
| signal-feed | PanelFrame, FeedItem, Badge, StatusBadge, Select, Checkbox, SearchInput, ProvenanceControl |
| deal-map | PanelFrame, MapView, Select, Checkbox, Drawer, Badge |
| kanban | PanelFrame, KanbanBoard, StatusBadge (pending approval), Toast, Drawer |
| priority-list | PanelFrame, DataTable, BarChart (score breakdown), Fact, Drawer |
| project-pipeline | PanelFrame, DataTable, Badge, TimelineAxis (engagement window), Fact |
| procurement-calendar | PanelFrame, TimelineAxis, Fact, Drawer |
| relationship-panel | PanelFrame, Tabs, DataTable, TextInput, Select, DatePicker, Button, Modal, Toast, Badge |
| timeline | PanelFrame, FeedItem, DatePicker (as of), ProvenanceControl |
| approval-queue | PanelFrame, FeedItem, ProvenanceControl, Button (Approve, Reject, Edit and approve), Modal (reason), Toast, StatusBadge |
| quarantine | PanelFrame, DataTable, Badge, Drawer |
| source-health | PanelFrame, DataTable, Badge, Sparkline |
| brief-editor | PanelFrame, Tabs, TextInput, Select, Checkbox, DataTable (differences), Button, Modal, Toast |
| alert-telemetry | PanelFrame, BarChart, Sparkline, DataTable |
| next-actions | PanelFrame, DataTable, DatePicker, Badge, Button |

| 2026-09-26 | Track 2 starts the frontend part of M6 after M5. It builds the modules against docs/api-contract.md with mocked API routes in its tests. Track 1 continues with M3 and M4. The M6 backend parts follow M4 | M5 is done and M6 frontend work does not depend on the M3 and M4 code. The contract keeps the two tracks consistent | CLAUDE.md, 08 |
| 2026-09-26 | The map uses the Natural Earth country boundaries from the npm package world-atlas as its base layer, with no tile server | Natural Earth is in the public domain. The build network cannot reach a tile server. A tile style can come later through VITE_MAP_STYLE_URL | 07 |
| 2026-09-26 | The tier rule t0_daily_site_status_change uses the feature status_change_at_daily_site. tiers.yaml gets a feature_thresholds section for "forecast moves six months nearer" | The old feature watch_daily was true for any daily site in the document, not only for the site with the status change. The threshold of six months stays in configuration | 05, config/tiers.yaml |
| 2026-09-26 | config/lifecycle.yaml names the generated intervals with intervals_file | The decision that lifecycle.yaml takes its intervals from the generated file needs one key that code can read | 05, config/lifecycle.yaml |
| 2026-09-26 | Cue words, patterns and thresholds of the deterministic backend and the resolver are in config/enrichment-rules.yaml | Rule 11 | 05 |
| 2026-09-26 | A claim carries value_text (the exact words) and an optional value. The system calculates the normal form from value_text | Guardrail 3 needs the value inside its quote. The model cannot bring a value that is not in the text | 05 |
| 2026-09-26 | The scorer is the last step, after the lifecycle agent and the forecaster | The tier rules use lifecycle and forecast features | 05 |
| 2026-09-26 | DealIdentified comes from open notice and planned procurement rules for both backends, and always goes to review | docs/05 lists no agent for deals. Rules in configuration keep the decision stable | 05, 06 |
| 2026-09-26 | An EntityMerged proposal has one event in the stream of each merged entity | The entity fold sets merged_into from an event in its own stream | 03 |
| 2026-09-26 | The gold labels were committed before the first run. A held-out set of 12 documents measures the tuned rules. It is reported, not gated | The rules changed while the gold errors were visible. An honest number needs unseen text | 05, tests/eval |
| 2026-09-26 | The quarantine routes need the viewer role | 05 criterion 5 asks for the reason code in the API. Reading needs no more than viewer | 05, 06 |
| 2026-09-26 | Migration 0200 adds a unique index on AlertRaised for (source_id, tier_rule) | One alert for each source and rule, also for two workers at the same time | 06 |
| 2026-09-26 | Prompt versions are "<agent>/v1" from prompts/<agent>/v1.md | Each call log row names the prompt file | 05 |
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
| 2026-09-26 | The 20-event minimum of the backtest is a third reported condition. The backtest passes only when all three conditions pass | 09 needs at least 20 events. The dataset has 7 because the search budget ended | 09 |
| 2026-09-26 | The backtest report shows the sensitivity to the matching rules | Most hits come from title words or the operator company, not from entity links | 09 |
| 2026-09-26 | Migration 0300 adds event_evidence_exempt(): a person entity that a user adds passes the evidence constraint without source evidence. fact_evidence_problems() uses the same rule | docs/03 says that the team is the source of its work. Personal fields must never go into a source document | 03, 06 |
| 2026-09-26 | New event types PersonErased, BriefVersionCreated and SourceAdded | docs/06 audit log rule 1: each user action that changes data is an event with actor type human | 03, 06 |
| 2026-09-26 | The ContactAdded schema refuses clear name, email and phone | docs/06 personal data rule 1 | 06, config/event-schemas.yaml |
| 2026-09-26 | Alert decisions go directly through the governance alert service, not through proposals | The decision of the approver is itself the approval. A proposal would need a second approver | 06 |
| 2026-09-26 | The first trace Tier 0 rule applies only when the stage is unknown or before contractor procurement (config/tiers.yaml) | Review of the snapshot run: a first trace at commissioning is not an early signal | 05, config/tiers.yaml |
| 2026-09-26 | The watched feature includes the operator of a watched site | Review of the backtest: an order from the operator of a watched mine is a watched item | 05 |
| 2026-09-26 | A study that is due or under way names its lifecycle stage | Review of the backtest. docs/05 lifecycle rule 2: the evidence names the stage | 05 |
| 2026-09-26 | Brief v1 gets no new alias for the Lobito rail line | "Lobito Corridor" is the geography corr_lobito. v1 loads by content hash | 04, v1.yaml |
| 2026-09-26 | Held-out set 2 ran once before the backtest fixes. No third set | A second run after the fixes gave the same numbers | 05, tests/eval |
| 2026-09-26 | The gold labels stay. Four tier labels follow the old reading of the first trace rule | A label changes only through a review by Mohamed | 05, tests/eval |
| 2026-09-26 | The live stream adds the alert status to each alert message, and /api/ticker and /api/signals items carry alert_status | docs/06: the alert shows its status in every place where it appears | 06, api-contract |
| 2026-09-26 | A project that enters the engagement window raises Tier 0 also when its previous stage is unknown | docs/05 lists "a project that enters the engagement window" as Tier 0. The first trace in the window is the entry for Strata | 05 |
| 2026-09-26 | The window forecaster, the opportunity of a project and the demand estimator run after each write of the governance service, also for an automatic proposal. The analysis no longer plans the forecast as a fact | One path gives each stage change a fresh forecast. An opportunity or an estimate never refers to a project that is not in the record | 05 |
| 2026-09-26 | The opportunity of a project comes from a follow-up step, not from the document agents | Adversarial test 2 stays true: an article with no deal gives no DealIdentified from the agents | 05 |
| 2026-09-26 | A stage change clears the forecast of the projection. A stage without a window gets a forecast that shows the stage only | The calendar must never show the window of an old stage | 05, 07 |
| 2026-09-26 | The priority calculator is a projector hook. Lead time counts from the recorded time of the event that caused the calculation | docs/03 criterion 4: a rebuild must give the same hashes | 03, 05 |
| 2026-09-26 | GET /api/priority orders by group, then rule 6, then the score, and gives rank and group_rank | docs/05 rule 6 names the highest rank "in its group" | 05, 07 |
| 2026-09-26 | Migration 0400 adds provenance columns to the projections (site status and identity, deal stage, project stage event) | docs/07 rule 1: each fact on the screen shows a provenance control | 03, 07 |
| 2026-09-26 | The governance, engagement and priority endpoints get response models. writes.ts uses the generated types | The frontend and its mocks must follow the real shapes, not assumptions 100 to 104 | 07 |
| 2026-09-26 | Assumptions 100 to 104 are replaced by the real shapes: proposals (total, created_by_me, evidence items, no top-level evidence_ids), telemetry (items, delivered, time_to_acknowledgement_seconds, false_positive_rate_by_tier_rule), quarantine (total, reason_codes, reason, output in the detail only), stage move result (deal_id, stage, stage_pending) and the priority breakdown | M4 built the endpoints with these shapes | 07 |
| 2026-09-26 | The timeline shows the reason of a change by the team as its provenance | docs/03: DealStageChanged needs evidence or a reason from a human | 03, 07 |
| 2026-09-26 | config/demand-model.yaml names the predicate and the units of each input. config/models.yaml lists the demand estimator and the opportunity proposer with model none | Rule 11: the mapping is configuration | 03, 05 |
| 2026-09-26 | The fixture gives each site an identity event and each known status a SiteStatusChanged event. A deal stage move in the fixture is a human event with a reason and no evidence. The quarantine codes come from config/agent-schemas.yaml | The mocks must match the real record | 09 |
| 2026-09-26 | Log filters remove tokens from every log line. nginx writes the path without the query string | The live stream sends the token as a query parameter. CLAUDE.md rule 5 forbids a secret in a log | CLAUDE.md, 06 |
| 2026-09-26 | The parallel run with Argo uses scripts/argo_compare.py. It matches Argo items to Strata signals by canonical URL, then by title similarity within seven days. Settings are in config/parallel-run.yaml | docs/09 asks for a match of each Argo item and the first finder. Argo items have no shared ids with Strata | 09 |
