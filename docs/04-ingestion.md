# 04. Ingestion

## Monitoring Brief

The Monitoring Brief controls what Strata collects and how it scores items. Keep each version as a YAML file in config/monitoring-brief/ and as a row in monitoring_brief_version.

The brief contains these sections:

- Sectors, geographies and deal types, as codes from config/taxonomy/.
- Watched entities, with external ids where known.
- Themes and keywords, with exclusions.
- Sources. Each source has a type, a URL, a cron schedule and a licence code.
- Scoring weights.
- A reference to the tier rules in config/tiers.yaml.

Each collector run reads the active brief version at the start. The run stamps that version on each source that it creates.

## Brief version 1

1. Look for the live Argo files at /home/atlas/agents/argo/monitoring-brief.md and /home/atlas/agents/argo/sources.md.
2. If the files exist, compare them with config/monitoring-brief/v1.yaml.
3. Add each difference to v1.yaml and record it in docs/decisions.md.
4. Take each source URL from sources.md. Replace each value "from_argo" with that URL.
5. If a URL is not in sources.md, find the official URL and make sure that it works. Record it in docs/decisions.md. Do not guess a URL.
6. Do not change the Argo files.

## Collectors

| Type | Method |
|---|---|
| Google News | Make one RSS search feed for each query in the brief, with the edition for Zambia in English. Use the item title and description as the source text |
| RSS and Atom | Parse the feed. Use conditional GET with ETag and Last-Modified |
| Web | Fetch the configured pages and sitemaps. Extract the main text with trafilatura |
| PDF | Extract text with pdfplumber. Use Tesseract OCR when a page has no text layer, and flag the source as OCR |
| Manual | An analyst uploads a file or a URL in the frontend |

### Rules for web collection

1. Obey robots.txt for each domain.
2. Limit requests to one for each domain every five seconds, unless the brief sets a different limit.
3. Send a User-Agent that names Strata and gives a contact address from configuration.
4. Do not log in to a site unless the brief gives credentials for it in environment variables.
5. Never fetch a site in the list google_news_only directly. These sites block direct access. Use only the Google News item text for them.
6. Mark each item from these sites with the flag read_at_source, so that an analyst can read the full article.

## Early signal sources

News finds a project late. Add these source types to brief v1, because they show a project months before its procurement starts.

| Source type | Early signal |
|---|---|
| Zambia Environmental Management Agency (ZEMA) notices and assessment reports | Environmental assessments filed and approved |
| Zambia Mining Cadastre | Applications, grants, transfers and renewals of mining and exploration licences |
| Stock exchange filings of the watched operators, such as SEDAR+, LSE RNS, JSE SENS and the Lusaka Securities Exchange | Resource updates, study results, capital expenditure guidance, project timelines and contractor awards |
| Investor presentations and annual reports of the watched operators | Project schedules and fleet plans |
| Project pages of development finance institutions, such as IFC, AfDB and DFC | Financing of mines, power, roads and the Lobito corridor |
| Zambia Development Agency and the economic zones | Investment licences and new tenants |
| ZPPA and procuring entities | Annual procurement plans, expressions of interest and prequalification notices |
| National budget and parliament statements | Public projects and their funding |
| Job postings for the watched sites and contractors | Hiring for construction, mining or fleet roles |

For each source type:

1. Find the official source.
2. Make sure that the source is reachable and that its terms let Strata collect it.
3. Add it to v1.yaml under sources.early_signal with its URL, schedule and licence code.
4. If you cannot find or reach it, add it to known_gaps with the reason.
5. Record each result in docs/decisions.md.

## Sources that an agent finds

Argo edits its own source list. Strata does not let an agent do this.

1. When an agent finds a new useful source, it writes a SourceProposed proposal with the evidence.
2. An admin approves or rejects the proposal.
3. An approval makes a new brief version.
4. Load the two entries in sources.proposed in v1.yaml as proposals.

## Known gaps

The brief lists sources that Strata cannot collect, such as the Government Gazette and the PACRA register. Analysts add these through manual upload. Show the list of gaps in the source health view, so that users know what Strata does not cover.

## Pipeline for each document

1. Fetch the document.
2. Store the raw file in object storage.
3. Extract the text. For PDF files, record the start offset of each page in page_map.
4. Normalise the text to Unicode NFC and fix the line endings. All offsets refer to this normalised text.
5. Calculate content_hash and simhash.
6. If content_hash matches an existing source, record only the new URL against that source.
7. If simhash is near an existing source, set duplicate_of and continue.
8. Detect the language.
9. Create the source row.
10. Put an enrichment job on the queue.

## Licence and retention

Each source in the brief has a licence code. The licence code sets the retention policy.

| Policy | Behaviour |
|---|---|
| full | Keep the text |
| verify_then_purge | Keep the text for the verification period in configuration, then delete it. Keep the hash and the evidence quotes |
| link_only | Keep the metadata, the evidence quotes and the link |

Google News items use link_only. The frontend shows a short excerpt and the link to the original. It never shows the full text of a source that has a licence other than full. Until Mohamed sets the licence of a source, use verify_then_purge.

## Scheduling and health

1. Run each source on its cron schedule, with random jitter of up to one minute.
2. Retry a failed fetch three times with exponential backoff.
3. Send a job that fails after the retries to a dead letter queue.
4. Record for each source the last success, the error rate and the number of documents in each run.
5. Show this data through the API.

## Completion criteria

Use a local fixture server with three RSS feeds, two Google News search feeds, two web pages and two PDF files. One PDF file must have no text layer. Base the fixture content on the watched sites in v1.yaml.

1. A full run collects every fixture document and stamps the active brief version on each source.
2. One article in two feeds gives one source and two URLs.
3. A near duplicate article gets duplicate_of set to the first source.
4. A second run with no changed fixtures creates zero new sources.
5. A path that robots.txt disallows is never fetched.
6. A failure of one source does not stop the other sources.
7. A new brief version takes effect on the next run.
8. The scanned PDF gives text, a page map and the OCR flag.
9. A verify_then_purge source has no text in storage after the verification period ends.
10. v1.yaml contains no value "from_argo", or each remaining value has an entry in docs/assumptions.md.
11. The collectors make no direct request to a site in the list google_news_only.
12. Daily sources run each day and weekly sources run each Monday, in the Africa/Lusaka time zone.
13. An approved SourceProposed proposal makes a new brief version, and the next run collects the new source.
14. Each early signal source type is in sources.early_signal or in known_gaps, with a reason.
