# 06. Governance and Access

## Roles

| Role | Permissions |
|---|---|
| Viewer | Read dashboards, timelines and evidence |
| Analyst | Viewer permissions. Create proposals, move Kanban cards, upload documents, acknowledge alerts, add contacts and log touchpoints |
| Approver | Analyst permissions. Approve, reject and edit proposals. Confirm and dismiss Tier 0 alerts |
| Admin | Approver permissions. Manage users, roles, sources, brief versions and configuration |

1. Enforce each permission in the API. The frontend only hides controls.
2. A user can never approve a proposal that the same user created.

## Approval queue

The approval queue shows each proposal with its evidence. Each evidence item shows the quote with the span highlighted and a link to the source.

| Action | Result |
|---|---|
| Approve | The governance service writes the proposed events |
| Reject | The user must give a reason. No event goes to the record |
| Edit and approve | The service writes a human event that keeps the original evidence |

## Approval policy

Keep the policy in config/approval-policy.yaml. Use these defaults:

| Event type | Default policy |
|---|---|
| SignalScored | Automatic |
| EntityIdentified, new entity only | Automatic if resolution confidence is 0.9 or more, otherwise review |
| EntityAttributeAsserted | Automatic if certainty is stated, otherwise review |
| EntityMerged, EntitySplit | Always review |
| DealIdentified | Always review |
| DealStageChanged | Always review |
| RelationshipAsserted | Review |
| SiteStatusChanged | Review |
| DemandDriverObserved | Automatic if certainty is stated, otherwise review |
| SourceProposed | Always review by an admin |
| ProjectStageChanged | Automatic if certainty is stated, otherwise review |
| ProcurementWindowForecast | Automatic |
| Engagement events from a user | Automatic. The user is the actor |

## Tier 0 alerts

A Tier 0 alert must go out at once. An approval gate would remove the speed that makes it useful.

1. Raise the alert with the status Unconfirmed.
2. Send it to the frontend and to email.
3. An approver confirms or dismisses the alert.
4. The alert shows its status in every place where it appears.

## Alert telemetry

Record these values for each alert:

- The published, fetched and raised timestamps.
- The delivery timestamp for each channel.
- The acknowledgement timestamp and the user.
- The outcome: confirmed, dismissed or false positive, with the tier rule that raised it.

Calculate these metrics:

- Latency from fetch to alert.
- Time to acknowledgement.
- Rate of false positives for each tier rule.

## Audit log

1. Write each user action that changes data as an event with actor type human.
2. Write each login, logout and permission change to a separate security log.

## Personal data

News stories name real people. Their personal data must be deletable, but the event store accepts inserts only.

1. Encrypt the personal fields of each person entity with a separate key for that person.
2. To erase a person, delete the key. The history stays intact, and the personal fields become unreadable.
3. Keep business contact data only: name, role, organisation, business email, business phone and the source of the contact.
4. Record the legal basis and the retention period in docs/assumptions.md.

## Completion criteria

1. A Viewer gets HTTP 403 on each write endpoint.
2. A user who tries to approve an own proposal gets HTTP 403.
3. Each default in the approval policy has a test.
4. A Tier 0 alert reaches the frontend with the status Unconfirmed, before any approval.
5. The telemetry API returns all the values and metrics above for the fixture alerts.
6. After erasure of a person, the API returns no personal fields for that person, and the hash chain check still passes.
