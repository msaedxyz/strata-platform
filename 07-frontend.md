# 07. Frontend

## Principle

Strata is an exact replica of Infora. It uses the Infora shell, navigation, panel framework, components, keyboard shortcuts, command input, search, live update behaviour and layout storage without change. The Strata content goes inside Infora panels. Use the tokens and components from packages/design-system only. Build each Strata module from Infora components. Do not add a component or a visual pattern that Infora does not have.

## Build order

1. Build packages/design-system from /audit/tokens.json and /audit/components.md.
2. Build a Storybook story for each component and each state.
3. Build packages/panel-framework from /audit/layout-system.md.
4. Build the application shell.
5. Build the Strata modules.

## Strata modules

For each module, record in docs/decisions.md the Infora components that it uses.

| Module | Content | Live |
|---|---|---|
| Ticker strip | Latest Tier 0 and Tier 1 signals, and counts by tier | Yes |
| Tier 0 alerts | Alert feed with status badge, acknowledge, confirm and dismiss | Yes |
| Demand drivers | Market events that change diesel demand for all customers | Yes |
| Site watch list | The sites in the active brief, with status, operator and last signal | Yes |
| Signal feed | All in scope items, with filters by sector, geography and tier | Yes |
| Geographic deal map | A map of Zambia and the corridors, with sites, opportunities and signals. Filters by site class, stage and sector. A click opens the site or deal drawer | Yes |
| Kanban stage board | One column for each stage in config/stages.yaml | Yes |
| Priority list | Opportunities ranked by lead time, demand estimate, confidence and buyer fit, with the breakdown | Yes |
| Project pipeline | Projects by lifecycle stage, with the engagement window marked | Yes |
| Procurement calendar | Forecast procurement windows for each project on a time axis of 24 months | Yes |
| Relationship panel | For each opportunity: the buyer roles, contacts, touchpoints, next action and prequalification status | Yes |
| Timeline | Events for an entity or a deal, with evidence links and an "as of" date control | No |
| Approval queue | Proposals with evidence, as in docs/06-governance.md | Yes |
| Quarantine | Rejected agent output with reason codes | No |
| Source health | Status of each source | Yes |
| Brief editor | Edit the brief, see the differences between versions, and activate a version | No |
| Alert telemetry | The metrics from docs/06-governance.md | Yes |

## Rules

1. Each fact on the screen shows a provenance control. The control opens the evidence with the span highlighted and a link to the source.
2. Make the TypeScript type of the fact component require evidence ids, so that a fact without evidence does not compile.
3. A drag on the Kanban board creates a DealStageChanged proposal. The card shows "Pending approval" until an approver decides.
4. Show unconfirmed and reported items with the same visual status style in every module.
5. Use one name for each action through the whole flow. For example, the button "Approve" gives the message "Approved".
6. Use the lint rule that stops raw colour and size values outside packages/design-system.

## Default workspaces

| Workspace | Panels |
|---|---|
| Origination | Priority list, procurement calendar, project pipeline, geographic deal map |
| Relationships | Kanban stage board, relationship panel, next actions |
| Monitoring | Ticker strip, Tier 0 alerts, demand drivers, signal feed, site watch list, source health |
| Review | Approval queue, quarantine, alert telemetry |

Keep user layouts with the same method that Infora uses.

## Quality floor

1. Keyboard focus is visible on each control.
2. Motion obeys the reduced motion setting.
3. Axe finds no issue that the Infora baseline does not have.

## Completion criteria

1. packages/design-system contains every token in /audit/tokens.json.
2. For each component state in the audit, a Playwright visual test compares the Storybook story with the audit screenshot. The pixel difference is 1 percent or less at 1920x1080 and 1440x900. Mask live data before the comparison.
3. Each behaviour in /audit/layout-system.md and each keyboard shortcut in /audit/behaviour.md has an end to end test, and gives the same result as in Infora.
4. The lint rule for raw values gives zero findings.
5. A new event appears in its live module two seconds or less after the database commit, on the local stack.
6. With fixture data of 10000 signals and 500 deals, the dashboard becomes interactive in three seconds or less at 1920x1080.
7. During live feed updates, the browser records no task longer than 200 milliseconds.
8. Each module in the table works with fixture data and has an end to end test.
9. A review of the component inventory finds no Strata component that is not in /audit/components.md.
10. The M5 progress report shows screenshots of the Strata shell next to the Infora audit screenshots.
