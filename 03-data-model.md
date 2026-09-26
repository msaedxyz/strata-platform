# 03. Canonical Data Model

## Design

Strata keeps an event store as the single record of truth. Each change to an organisation, person, asset or deal is an event. Projections calculate the current state from the events. You can delete and rebuild each projection at any time.

To correct a fact, append a new event that supersedes the old event. Never change or delete an event.

## Tables

### source

One row for each collected document.

| Column | Content |
|---|---|
| id | ULID |
| type | rss, web, pdf or manual |
| url | Original location |
| publisher | Name of the publisher |
| published_at, fetched_at | Timestamps |
| licence_code | Code from the source list in the brief |
| retention_policy | full, verify_then_purge or link_only |
| brief_version_id | Brief version that caused the collection |
| content_hash | SHA-256 of the normalised text |
| simhash | Fingerprint for near duplicates |
| duplicate_of | Source id of the first copy, or null |
| raw_uri, text_uri | Object storage locations |
| page_map | Character offset where each PDF page starts |
| language | ISO 639-1 code |

### evidence

One row for each span of text that supports a claim.

| Column | Content |
|---|---|
| id | ULID |
| source_id | Source of the span |
| char_start, char_end | Offsets in the normalised text |
| quote | The exact text of the span, 500 characters at most |
| quote_hash | SHA-256 of the quote |

### entity

A registry of identities only. The attributes of each entity come from events.

| Column | Content |
|---|---|
| id | ULID |
| type | organisation, person, site, project, opportunity or location |
| site_class | For sites: mine, exploration, farm, power, industrial, transport, border or fuel_supply |
| watch | daily, weekly or none, from the active brief |
| geometry | PostGIS point or area, with the evidence or dataset that gives it |
| external_ids | JSON, for example Companies House number or LEI |

### event

The append only store.

| Column | Content |
|---|---|
| id | ULID |
| stream_type, stream_id | The entity or deal that the event is about |
| sequence | Position in the stream |
| event_type | Name from the list below |
| payload | JSON that matches the schema for the event type |
| evidence_ids | Array of evidence ids |
| certainty | stated, reported or speculative |
| actor_type | agent, human or system |
| actor_id | User id, agent name or service name |
| model_id, prompt_version | Filled when an agent made the proposal |
| proposal_id | The approved proposal |
| brief_version_id | Active brief version |
| supersedes_event_id | Event that this event corrects, or null |
| recorded_at | Database timestamp |
| prev_hash, hash | Hash chain for each stream |

### monitoring_brief_version

Each brief version is immutable. A change to the brief makes a new version.

### proposal

Agents and analysts write proposals here. The proposal lifecycle is its own event stream: created, approved, rejected, edited and approved.

## Event types

| Event type | Needs evidence |
|---|---|
| EntityIdentified | Yes |
| EntityAttributeAsserted | Yes |
| EntityMerged, EntitySplit | Yes |
| RelationshipAsserted | Yes |
| DealIdentified | Yes. A deal is an opportunity |
| DealAttributeAsserted | Yes |
| DealStageChanged | Yes, or a reason from a human approver |
| SignalScored | Yes |
| DemandDriverObserved | Yes |
| ProjectStageChanged | Yes |
| ProcurementWindowForecast | Yes. It also cites the lifecycle intervals that it uses |
| DemandEstimated | Yes, for each input |
| ContactAdded, TouchpointLogged, NextActionSet, PrequalificationStatusChanged | No. The actor must be a human user |
| SiteStatusChanged | Yes. Values: producing, ramping up, care and maintenance, suspended, closed, under construction |
| AlertRaised, AlertConfirmed, AlertDismissed | Yes |
| AlertAcknowledged | No |
| ClaimRetracted | No. It needs a reason |

## Deal stages

In Strata, a deal is a commercial opportunity at a site or with an organisation, for example a supply contract, a tender or a haulage contract. Load the stages from config/stages.yaml. Use these defaults until Mohamed confirms them:

1. Signal
2. Qualified
3. Contact found
4. Approach
5. Relationship active
6. Prequalification
7. Tender or proposal
8. Negotiation
9. Won
10. Lost
11. Parked

## Project lifecycle

A project is a planned change at a site, for example a new mine, an expansion, a restart, a power plant or a road contract. Each project has a lifecycle stage. Load the stages from config/lifecycle.yaml. Use these defaults:

1. Exploration
2. Resource defined
3. Scoping or pre-feasibility study
4. Feasibility study
5. Environmental assessment filed
6. Environmental approval
7. Mining or construction licence granted
8. Financing close or final investment decision
9. Contractor procurement, such as EPC, contract mining or haulage
10. Construction or mobilisation
11. Commissioning and ramp up
12. Steady operation
13. Care and maintenance, suspension or closure

For a restart, the stages are: care and maintenance, restart plan, recapitalisation, contractor procurement and restart.

The engagement window is stages 4 to 8. In this window, the team can build relationships before the procurement starts.

## Buyers

The organisation that buys diesel is often a contractor and not the site owner. For example, a contract mining company or a haulage contractor buys the fuel for its fleet. For each project, record each buyer role with a RelationshipAsserted event:

- Owner
- EPC contractor
- Mining contractor
- Haulage contractor
- Fuel supplier of record

## Relationships and engagement

Record the work of the team as human events. These events need no source evidence, because the team is the source.

| Event type | Content |
|---|---|
| ContactAdded | A person, the role, the organisation and how the team found the contact |
| TouchpointLogged | A call, meeting, email or site visit, with the date and a short note |
| NextActionSet | The next action, the owner in the team and the due date |
| PrequalificationStatusChanged | Not started, submitted, approved or rejected, for a buyer |

## Demand estimate

Strata can estimate the diesel demand of a project. Each estimate uses a formula from config/demand-model.yaml and inputs that have evidence, such as fleet size, ore tonnage or contract value. Label each value as an estimate, and show its formula and inputs. If an input has no evidence, show no estimate.

## Demand drivers

Some events change diesel demand for all customers at once, for example load shedding, a fuel shortage, a pipeline outage, a border delay or a change from the Energy Regulation Board. Record each of these as a DemandDriverObserved event in a market stream, not in the stream of one opportunity.

## Site locations

1. Take site coordinates from OpenStreetMap or from a dataset that Mohamed gives.
2. Record the dataset and its licence as the evidence for each geometry.
3. If no dataset gives a point, use the centre of the district and set the flag approximate.
4. Never invent coordinates.

## Constraints

1. Give the application database role INSERT and SELECT on the event table only.
2. Add a trigger that raises an error on UPDATE, DELETE or TRUNCATE of the event table.
3. Add a CHECK constraint so that each event type in the table above has at least one evidence id where it needs evidence.
4. Store the hash of the previous event in the stream in prev_hash. Calculate hash from prev_hash and the event content.
5. Validate each payload against a JSON schema for its event type before insert.
6. Give each API read the option `as_of`, which returns the state at a past timestamp.

## Completion criteria

1. An UPDATE, DELETE or TRUNCATE on the event table fails for every database role, including the owner role that the application uses.
2. An insert of a fact event with no evidence fails.
3. A script checks the hash chain of every stream and reports zero breaks.
4. A test deletes all projections, replays all events, and gets projections with the same hash as before.
5. An `as_of` query returns the correct deal stage for a timestamp before and after a stage change.
6. A correction event supersedes the old fact in the projection, and the old fact stays in the history.
7. An insert of an engagement event with an agent actor fails.
8. A DemandEstimated event without evidence for each input fails.
