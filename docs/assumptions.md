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
| 140 | Backtest replay | One source per distinct URL. Type snapshot, licence gn_link_only, read_at_source true. published_at and fetched_at are the trace date at 00:00 UTC |
| 141 | Backtest signal | A SignalScored event with tier 0, 1 or 2, dated strictly before the procurement event |
| 142 | Backtest match order | Project, site, title words, company. Only the site operator counts at company level |
| 143 | Backtest median | Over detected events only, with 30.44 days for each month |
| 144 | Backtest window | 2023-10-01 to 2026-09-26, not strict. EV-007 stays in with a flag |
| 150 | Master key | STRATA_MASTER_KEY gives 32 bytes in base64 (standard or URL safe) or in 64 hex characters. Without a valid key the contact endpoint gives HTTP 503 |
| 151 | Encryption of personal fields | AES-256-GCM with a random 256-bit data key for each person. The master key wraps the data key with AES-256-GCM. The entity id is the associated data. The fields are in config/personal-data.yaml |
| 152 | Same person | A blind index: HMAC-SHA256 of the business email, else of the name and the organisation. The index is in the key row and goes with the erasure |
| 153 | Person entity | EntityIdentified of a person from a user needs no source evidence. The name in the record is "[personal data]". The real fields are encrypted only |
| 154 | Output after erasure | name "[erased]", email and phone null, erased true. The reason of the erasure goes to security_log only, not to the event store |
| 155 | Stage move without a reason | The reason is "Moved from <stage> to <stage> by an analyst". One pending stage change for each deal (409 for a second one) |
| 156 | Alert decisions | Confirm takes an optional reason. Dismiss needs a reason (422). A second acknowledgement writes nothing. A decision on a decided alert gives 409 |
| 157 | Frontend delivery | "broadcast" when the alert is raised. "delivered" when the live stream sends it to the first connected client. Telemetry shows both |
| 158 | Telemetry metrics | Median and p90 with linear interpolation between the closest ranks. Latency = raised_at minus source fetched_at. Time to acknowledgement = acknowledged_at minus raised_at. False positive rate = false positives over decided alerts of the tier rule |
| 159 | Admin review | An admin_review proposal needs an admin to approve or reject. A SourceProposed proposal goes through approve-source only |
| 160 | Session routes | POST /api/session/login and logout write the security log only. They are not data writes, so a viewer can call them |
| 161 | Audit events | A manual upload writes SourceAdded (stream source). A new brief version writes BriefVersionCreated (stream brief, main) |
| 162 | Scenario 1 "sale process" | The fixture article describes a sale process in which KCM invites expressions of interest for diesel supply to Nchanga. The Tier 0 rule is t0_open_procurement_notice, because docs/05 has no Tier 0 rule for a change of owner |
| 163 | Scenario 4 "previous day" | The test uses a time between the deal creation and the approval, because the database sets recorded_at |
| 164 | Scenario 17 | The API part only. The rank change for "no contact found" needs the priority list calculator of M6 |
| 165 | First trace stage limit | config/tiers.yaml first_trace_before_stage: contractor_procurement. A restart stage uses the order of the restart path |
| 166 | from_status | The projection status, else the brief status_hint with from_status_source "brief_status_hint" |
| 167 | Project names | Title boundary words, generic words and title separators in config/enrichment-rules.yaml (mentions) |
| 168 | Same project at one site | Confidence 0.85. Two or more known projects of the same kind at the site give no decision |
| 169 | Smallest project amount | 1000 in any currency (claims.min_project_money_amount) |
| 170 | Sole word of a site name | A word names a watched site when it is the only distinctive word of the name of exactly one watched site. Stop list in config |
| 171 | Watched through the operator | An organisation that operates a daily or weekly site makes the item watched for the Tier 1 rules. The watch weights of the score stay site based |
| 172 | Entering the engagement window | A first stage inside the window counts as entering the window (Tier 0), also when the stage before is unknown |
| 180 | Priority weights | Lead time 0.35, demand 0.25, confidence 0.2, buyer fit 0.2 (config/priority.yaml) |
| 181 | Lead time score | Linear points [-365, 0.05], [0, 0.3], [90, 0.8], [180, 1.0], [540, 1.0], [1095, 0.4], [1825, 0.2]. No forecast date gives 0. A date more than 3650 days away counts as unknown |
| 182 | "As of" of the priority | The recorded time of the event that caused the calculation. A rebuild gives the same values |
| 183 | Demand score | Linear points [0, 0], [20000, 0.3], [100000, 0.6], [500000, 0.9], [2000000, 1.0] litres a month. No estimate gives 0 |
| 184 | Confidence | From the certainty of the DealIdentified event: stated 1.0, reported 0.6, speculative 0.3, unknown 0.5 |
| 185 | Buyer fit | Mining and haulage contractor 1.0, EPC contractor 0.9, owner 0.5, fuel supplier of record 0.2. An owner that buys directly 0.9: the organisation of the deal, or the operator of the site when the project names no contractor. An organisation without a role 0.4. Unknown 0.3 |
| 186 | Priority groups | Signal to approach, relationship to prequalification, tender and negotiation, closed. The list shows the groups in this order |
| 187 | Contact found | A ContactAdded event, a touchpoint that names a contact, or a deal stage at or after "Contact found". The rule adds 1.0 to the score, and the list sorts these deals first in the group |
| 188 | Opportunity of a project | When the record gets the project or a new stage (not at the proposal). An unknown stage or a stage up to contractor procurement. Once for each project. None when the project has an open or pending fuel supply deal. The owner buyer role is the organisation. The evidence is the stage evidence, else the identity evidence |
| 189 | Demand estimate inputs | Project facts first, then site facts. The first formula in config/demand-model.yaml with evidence for each input. A site with input facts gets its own estimate. A new proposal only when the input facts change |
| 190 | Forecast without a window | A stage at or after contractor procurement, or with no interval, gets a forecast with no dates (stage_only, procurement_reached). The stage change clears the old forecast of the projection |
| 191 | Forecast shift alert | The forecaster raises t0_forecast_moves_nearer after the write, for the source of the stage evidence, one alert for each source and rule |
| 192 | Site identity evidence | The evidence of the first EntityIdentified event of the site (for a brief site, the span of the brief) |
| 193 | Provenance of a stage move by the team | The reason of the move. The timeline shows "Reason: ...". The deal drawer shows the stage reason |
| 194 | Response models | Extra fields stay in the response. The OpenAPI schema lists the known fields only |
| 195 | Live delay test | Five touchpoints, from just before the commit to the SSE message in the reader. The maximum must be 2 s or less |
| 196 | Priority list live events | Deal, engagement and project events (config apps/web/src/config/modules.ts) |
| 197 | New agents in config/models.yaml | demand_estimator and opportunity_proposer, model none. The prompt version is the config version (demand-model, priority-config) |
