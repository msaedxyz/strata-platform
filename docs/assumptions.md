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
