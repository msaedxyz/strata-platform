# API contract for the Strata modules

The frontend modules (M6) and the governance service (M4) use this contract. The read endpoints exist in services/api/routers/read.py. M4 adds the write endpoints. The typed client in packages/api-client comes from the OpenAPI schema.

All endpoints need a bearer token from Keycloak. The API enforces each role. The frontend only hides controls. Each write by a user becomes an event with actor type human.

## Read endpoints (Viewer and up)

| Endpoint | Module |
|---|---|
| GET /api/config/stages | Kanban columns, project pipeline, lifecycle stages, engagement window |
| GET /api/config/taxonomy | Filters for the signal feed and the map |
| GET /api/ticker | Ticker strip: latest Tier 0 and Tier 1 signals, counts by tier |
| GET /api/signals?tier=&sector=&geography=&theme=&entity_id=&q=&limit=&offset= | Signal feed |
| GET /api/demand-drivers | Demand drivers |
| GET /api/alerts?status=&tier= | Tier 0 alerts |
| GET /api/sites?watch=daily\|weekly\|all&site_class= | Site watch list (status and status_pending) |
| GET /api/entities?q=&type= | Search |
| GET /api/entities/{id}?as_of= | Site or organisation drawer |
| GET /api/map?site_class=&stage=&sector= | Geographic deal map |
| GET /api/projects?stage= and GET /api/projects/{id}?as_of= | Project pipeline |
| GET /api/calendar?months=24 | Procurement calendar |
| GET /api/deals?stage= and GET /api/deals/{id}?as_of= | Kanban stage board, deal drawer |
| GET /api/priority | Priority list with priority_breakdown |
| GET /api/deals/{id}/relationship | Relationship panel |
| GET /api/timeline?stream_type=&stream_id=&as_of= | Timeline with the "as of" control |
| GET /api/evidence?ids= | Provenance control: quote, span offsets, link, context for licence full |
| GET /api/sources/health, GET /api/sources/known-gaps | Source health |
| GET /api/briefs, GET /api/briefs/{version}, GET /api/briefs/diff?from=&to= | Brief editor |
| GET /api/quarantine, GET /api/quarantine/{id} | Quarantine (M3) |
| GET /api/live (SSE, token in `access_token`) | Live updates. Each message has id, stream_type, stream_id, event_type |

## Write endpoints (M4)

| Endpoint | Role | Body | Result |
|---|---|---|---|
| GET /api/proposals?status=pending | Viewer | | Proposals with proposed events and evidence items |
| POST /api/proposals/{id}/approve | Approver, not the creator | | `{"status": "approved"}`. 403 for the creator |
| POST /api/proposals/{id}/reject | Approver | `{"reason": "..."}` (required) | `{"status": "rejected"}` |
| POST /api/proposals/{id}/edit-approve | Approver, not the creator | `{"events": [...]}` | `{"status": "edited_approved"}` |
| POST /api/deals/{id}/stage | Analyst | `{"to_stage": "qualified"}` | A DealStageChanged proposal. The card shows "Pending approval" |
| POST /api/deals/{id}/contacts | Analyst | `{"name", "role", "organisation_id", "email", "phone", "found_via"}` | ContactAdded |
| POST /api/deals/{id}/touchpoints | Analyst | `{"kind": "call\|meeting\|email\|site_visit", "date", "note", "contact_id"}` | TouchpointLogged |
| POST /api/deals/{id}/next-action | Analyst | `{"action", "owner_user_id", "due_date"}` | NextActionSet |
| POST /api/deals/{id}/prequalification | Analyst | `{"buyer_id", "status"}` | PrequalificationStatusChanged |
| POST /api/alerts/{id}/acknowledge | Analyst | | AlertAcknowledged |
| POST /api/alerts/{id}/confirm | Approver | `{"reason"}` | AlertConfirmed |
| POST /api/alerts/{id}/dismiss | Approver | `{"reason", "false_positive": bool}` | AlertDismissed |
| GET /api/telemetry/alerts | Viewer | | Timestamps for each alert and the metrics |
| POST /api/persons/{id}/erase | Admin | `{"reason"}` | Deletes the key of the person |
| POST /api/sources/manual | Analyst | file or URL | A source (M2) |
| POST /api/briefs, POST /api/briefs/{version}/activate | Admin | | Brief versions (M2) |
| POST /api/proposals/{id}/approve-source | Admin | | A new brief version (M2) |

## Action names

Use one name for each action through the whole flow (docs/07 rule 5).

| Button | Message after success |
|---|---|
| Approve | Approved |
| Reject | Rejected |
| Edit and approve | Edited and approved |
| Acknowledge | Acknowledged |
| Confirm | Confirmed |
| Dismiss | Dismissed |
| Move to stage | Moved, pending approval |
| Add contact | Contact added |
| Log touchpoint | Touchpoint logged |
| Set next action | Next action set |
| Activate | Activated |
