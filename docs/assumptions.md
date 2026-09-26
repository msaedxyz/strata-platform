# Assumptions

Claude Code does not wait for answers. It uses each default below and continues. Mohamed reviews this file when he wants to, and changes a default through docs/decisions.md.

| No. | Subject | Default that Claude Code uses |
|---|---|---|
| 1 | Infora source repository | Use INFORA_REPO_PATH if it is set. If not, audit from the browser only |
| 2 | Tier definitions | The defaults in docs/05-enrichment.md |
| 3 | Deal stages and project lifecycle stages | The defaults in docs/03-data-model.md |
| 4 | Focus of brief v1 | Zambia mining and industrials, from the Argo brief |
| 5 | Source licences | link_only for Google News, verify_then_purge for all other sources |
| 6 | Hosting and identity | Containers that run on any cloud. OIDC, with Keycloak locally |
| 7 | Map tiles | MapLibre with a tile source that allows commercial use |
| 8 | Fonts | The Infora fonts |
| 9 | Personal data | Encrypted personal fields with erasure by key deletion. Only business contact data from public sources or entered by the team |
| 10 | Alert channels | In-app and email |
| 11 | Evaluation targets | The targets in docs/05-enrichment.md |
| 12 | Argo | Argo and Strata run together until Mohamed decides |
| 13 | Sources that Argo found | Load as proposals for an admin |
| 14 | DRC side of the corridor and paid sources | Shown as known gaps |
| 15 | Infora design values | Provisional tokens until the audit runs. See docs/decisions.md |
| 16 | Model backend | Anthropic API when ANTHROPIC_API_KEY is set. Otherwise the deterministic backend |
| 17 | Legal basis for personal data | Legitimate interest of the business, for business contact data from public sources or entered by the team. Retention: 24 months after the last touchpoint, then erasure by key deletion |
| 18 | Verification period for verify_then_purge | 30 days, from STRATA_VERIFICATION_PERIOD_DAYS |
| 19 | Demand model factors | Planning defaults in config/demand-model.yaml. Mohamed confirms them |
| 20 | Development users | viewer, analyst, analyst2, approver, approver2 and admin at strata.local, with one password from .env |
| 21 | Real data in the build environment | A snapshot of real items from WebSearch in data/snapshots/. The collectors use the live sources on a machine with normal network access |
| 22 | Time of the daily and weekly runs | Daily at 05:00 and weekly on Monday at 05:00, Africa/Lusaka (config/collectors.yaml) |
| 23 | Near duplicate threshold | Hamming distance 3 or less of a 64 bit simhash over shingles of three words. Only sources fetched in the last 60 days are candidates |
| 24 | robots.txt that does not load | HTTP 404 allows all paths. HTTP 401, 403, 5xx or a network error disallows all paths. The cache keeps a result for 24 hours, or 10 minutes after an error |
| 25 | Retry rule | Three retries after 2, 4 and 8 seconds, for network errors and HTTP 429, 500, 502, 503 and 504. Other 4xx responses are not retried |
| 26 | Sitemap limit | 50 pages in one run. A sitemap inside a sitemap is not followed |
| 27 | Web page sources | One document for each configured page. The collector does not follow the article links of a section page |
| 28 | Licence of a manual upload | verify_then_purge unless the analyst gives a licence code from the brief. A manual URL obeys robots.txt and the google_news_only guard |
| 29 | Object storage keys | sources/<source id>/raw.<ext> and sources/<source id>/text.txt. A link_only source keeps no raw file |
| 30 | Excerpt | The first 280 characters of the text after whitespace is collapsed. The purge keeps the excerpt |
| 31 | Google News item URL | The publisher URL when the Google News link carries it. Else the Google News link. The metadata keeps the Google News link and the publisher site |
| 32 | Section of an approved source | sources.early_signal when the proposal gives a source_type, else sources.news |
| 33 | Version number of a new brief from the API | The next free number. The content hash does not include the version number, so the same content gives the existing version |
| 34 | OCR | A page with fewer than 20 characters goes to OCR at 200 dpi. Tesseract when the binary exists, else RapidOCR |
| 35 | Language | langdetect with a fixed seed. No language for a text with fewer than three words |
| 36 | Watch level of a site that leaves the brief | The start-up step sets watch none for a site that the active brief does not list |
| 37 | Health window | Error rate and documents for each run from the last 20 runs of a source |
| 38 | Snapshot enrichment | Each new snapshot source gets an enrich_source job, like any other source |
| 39 | Deterministic backend | Rules in config/enrichment-rules.yaml, version rules-v1, model id deterministic-v1 |
| 40 | Resolver thresholds | Exact normalised name: confidence 0.97. Trigram match at similarity 0.72 or more with a margin of 0.12. New entity below 0.45, with confidence 0.9 when a name pattern finds it. Only projects and organisations are created. Persons are never created |
| 41 | Vector search | Not used. No embedding model is available without the API. The resolver uses trigram candidates only |
| 42 | Scorer judgement | The deterministic backend gives no judgement. A model judgement adds to the score with weight 1.0 and never sets the tier |
| 43 | Forecast range | Base date: published_at, else fetched_at. Start = base + shortest interval, end = base + longest interval, and the median. Only the direct interval from the current stage to contractor_procurement. No forecast at or after contractor procurement, except care and maintenance (stage only) |
| 44 | Forecast of a reviewed stage | The forecast waits for the approval of the ProjectStageChanged. `approve()` writes it with the policy automatic |
| 45 | New project with its stage | One proposal with EntityIdentified and ProjectStageChanged. The strictest policy of the two applies |
| 46 | Claims about a new entity that waits for review | The claim proposals go to review too |
| 47 | Summary | Extractive, up to three sentences that other agents found evidence in. Each sentence is its own evidence. With no evidence sentence, the title only |
| 48 | Out of scope document | No proposal and no quarantine row. The enrichment_run row records out_of_scope |
| 49 | Rumour document | Two or more rumour cues, or a cue in the title, make each claim at most reported |
| 50 | Idempotency | Key = source id and fact key. A second run returns already_enriched. A forced run gives no new proposal or alert |
| 51 | Alert channels | One alert for each source and tier rule. Email only when STRATA_SMTP_HOST and STRATA_ALERT_EMAIL_TO are set |
| 52 | Site status proposals | Only for watched sites (daily or weekly). No proposal when the status equals the recorded or the pending status |
| 53 | Canonical fact | An event whose type needs evidence (the SQL function event_needs_evidence). The text check runs only where the text is still stored |
| 54 | Evaluation metrics | Macro F1 over in_scope, each sector and each direction. Resolution precision over match and new decisions, with a decision on an unlabelled mention counted as wrong |
| 55 | Targeted sources | Google News and snapshot items need no geography word, because their brief queries name Zambian places and sites |
| 56 | Temperature for Claude Haiku 4.5 | Sent through `extra_body`, because the SDK 1.8 method has no temperature argument |
| 57 | Enrichment sweep | Every 10 minutes, at most 200 sources |
| 58 | The brief document | Not enriched (metadata kind monitoring_brief) |
| 80 | Audit output directory | `<repository>/audit`, ignored by git. AUDIT_OUT_DIR can change it |
| 81 | Sensitive pages | A URL or page text that suggests credentials, API keys, billing, users, team, profile, account or admin. A password field. Three or more e-mail addresses on the page |
| 82 | Personal data in screenshots | Masks on password and e-mail fields, on the user name and on text that looks like an e-mail address |
| 83 | Value-change observation | 30 seconds on the first view |
| 84 | Grid row height | When more than one row height fits the geometry, the guess is the smallest candidate of 20px or more. layout-system.md lists all candidates |
| 85 | Neutral state colour | color.state.neutral uses the secondary text colour. This is a guess until the audit shows a neutral state |
| 90 | Infora audit | Not available on 2026-09-26. Tokens, icons, layout storage and shortcuts are provisional until the audit |
| 91 | Ticker speed | 40 px per second, pause on hover and on keyboard focus |
| 92 | Live reconnect | 1 s, then double each time, 30 s at most (apps/web/src/config/app.config.ts) |
| 93 | Shortcut sequence time | 1200 ms for the second key of "g 1" |
| 94 | Map style | Empty style until VITE_MAP_STYLE_URL gives a style with a licence for commercial use |
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
| 120 | Backtest replay | One source per distinct URL. Type snapshot, licence gn_link_only, read_at_source true. published_at and fetched_at are the trace date at 00:00 UTC |
| 121 | Backtest signal | A SignalScored event with tier 0, 1 or 2, dated strictly before the procurement event |
| 122 | Backtest match order | Project, site, title words, company. Only the site operator counts at company level |
| 123 | Backtest median | Over detected events only, with 30.44 days for each month |
| 124 | Backtest window | 2023-10-01 to 2026-09-26, not strict. EV-007 stays in with a flag |
