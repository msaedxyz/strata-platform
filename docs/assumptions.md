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
