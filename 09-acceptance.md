# 09. Acceptance

Each scenario is an automated test in tests/e2e/. Each scenario runs on the local stack with the fixture server.

| No. | Scenario | Pass condition |
|---|---|---|
| 1 | An admin activates a new brief version. The collectors run. A fixture article describes a sale process at a watched entity | A Tier 0 alert appears as Unconfirmed within 15 minutes of the collector run. An approver confirms it. Telemetry shows every timestamp |
| 2 | A fixture article reports a rumour of a deal | Each claim has certainty reported or speculative. No deal stage changes without approval |
| 3 | Two articles name one company in two different ways | Strata gives one entity. A proposal to merge two existing entities goes to the approval queue |
| 4 | An analyst drags a Kanban card to the next stage | The card shows Pending approval. An approver approves. The timeline shows the event with evidence. The "as of" view for the previous day shows the old stage |
| 5 | A Viewer calls the approve endpoint | HTTP 403 |
| 6 | The analyst who created a proposal tries to approve it | HTTP 403 |
| 7 | A test runs UPDATE on the event table | The database returns an error |
| 8 | A fixture document contains instructions to the model | The result is the same as for the document without the instructions |
| 9 | A test deletes and rebuilds all projections | The projection hashes do not change |
| 10 | An admin erases a person | The API returns no personal fields for that person. The hash chain check passes |
| 11 | A gitleaks scan runs on the repository and its history | Zero findings |
| 12 | A SQL check counts canonical facts without verified evidence | The count is zero |
| 13 | A fixture item reports a suspension at a mine on the daily watch list | A SiteStatusChanged proposal and a Tier 0 alert. The site watch list shows the pending status |
| 14 | A fixture item reports a fuel shortage | A DemandDriverObserved event in the market stream and a Tier 0 alert |
| 15 | A fixture item from a google_news_only site | Strata uses the item text only and sets read_at_source |

| 16 | A fixture ZEMA notice describes a new mine project | Strata creates a project at the stage "Environmental assessment filed", raises a Tier 0 alert, and puts it on the procurement calendar |
| 17 | An analyst logs a touchpoint and a next action for an opportunity | The relationship panel shows both. The priority list lowers the rank for "no contact found" |

## Lead time backtest

This test shows whether Strata finds opportunities months before they become public tenders.

1. Collect at least 20 contractor procurement events in Zambia mining and industrials from the last three years, such as tenders, contract mining awards, EPC awards and haulage contracts. Each event needs evidence.
2. For each event, collect the public sources that existed before its date, from the sources in brief v1.
3. Run Strata on those sources in date order, with no access to later sources.
4. For each event, record the date of the first Strata signal about the project.
5. Lead time is the interval from the first signal to the procurement event.

Strata passes when both conditions are true:

- Strata finds an earlier signal for 70 percent or more of the events.
- The median lead time is six months or more.

Record each event, its first signal, its lead time and each miss with the reason in the final report.

## Parallel run with Argo

After M7, run Strata and Argo together for two weeks.

1. Collect each item that Argo reports in that period.
2. Match each Argo item to a Strata signal.
3. Strata passes when it finds 95 percent or more of the Argo items.
4. For each item that both find, record which system found it first.
5. Record the reason for each miss in the final report.

## Sign off

1. Run all scenarios in CI.
2. Record the results in the final report.
3. Mohamed signs off.
