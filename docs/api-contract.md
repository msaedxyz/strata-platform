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

## M6 additions

These additions do not break the contract. Each adds fields only.

1. The governance, engagement and priority endpoints have response models in services/api/routers/schemas.py. The typed client (packages/api-client) gives their shapes. A response can have more fields than its model lists.
2. GET /api/sites: identity_evidence_ids, status_event_id, status_evidence_ids, status_certainty, operator_event_id, operator_evidence_ids, last_signal_id, last_signal_title and last_signal_evidence_ids.
3. GET /api/deals and GET /api/deals/{id}: stage_event_id, stage_evidence_ids, stage_reason, stage_actor_type and certainty. A stage that the team moved has a reason and no source evidence.
4. GET /api/map: each site has identity_evidence_ids, status_event_id, status_evidence_ids, status_certainty and geometry_source. Each deal has evidence_ids, stage_event_id, stage_evidence_ids and stage_reason. Each project has stage_event_id, stage_evidence_ids, forecast_event_id and forecast_evidence_ids.
5. GET /api/calendar: stage_event_id, stage_evidence_ids, stage_certainty and demand_estimate. The forecast_detail of a stage at or after contractor procurement has procurement_reached true and no dates.
6. GET /api/priority: the items come in the order of the groups of config/priority.yaml. In a group, a deal whose project is in the engagement window and has no contact found comes first, then the other deals by score. Each item has rank, group_rank, group_order, priority_group, no_contact_rule, project_name, stage_event_id and stage_evidence_ids. priority_breakdown has the parts lead_time, demand, confidence, buyer_fit and no_contact_boost. Each part has its value, score, weight, contribution, event_ids and evidence_ids.
7. The demand estimate of a project (demand_estimate) gives the formula, the factors and each input with its fact event id and evidence ids.
