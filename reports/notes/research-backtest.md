# Research note: lead time backtest dataset

Date: 2026-09-26

Status: PARTIAL. The dataset has 7 events. The target is 26. The minimum in docs/09-acceptance.md is 20. Do not run the backtest on this dataset as a pass or fail test until more events are added.

## Files

- tests/backtest/events.yaml: 7 contractor procurement events.
- tests/backtest/traces.yaml: 19 earlier traces. Some traces are the same document. Each row links to one event.

## Method

1. The agent used the WebSearch tool only. Direct HTTP to the sites was blocked.
2. The agent searched for procurement events at the watched sites and projects. Examples are Kansanshi, Lumwana, Mopani, KCM, Mingomba, the Lobito corridor, Maamba and the Chisamba solar plant.
3. For each event, the agent searched for earlier public traces of the same project.
4. The agent kept an item only when a search result gave its URL and its date.
5. The agent took most dates from the URL path or from the article id. The note field of each row gives the basis of the date.
6. The text field holds the title only. The search results gave summaries, not exact source words. A summary is not a quote, so the agent did not put it in the text field.
7. The agent checked that the YAML files parse with python3 and PyYAML.
8. The agent checked that each trace date is before its event date.

## Why the dataset is small

The session web search budget ran out after 33 searches by this agent. The session limit is 200 searches, and other work in the session used the rest. The tool refused all further searches. The agent did not add items from memory, because the rules forbid facts without a source.

## Counts

| Item | Count |
|---|---|
| Events | 7 |
| Events in the window October 2023 to September 2026 | 6 |
| Traces | 19 |
| Events with at least one earlier trace | 7 |
| Events with two or more earlier traces | 5 |

## Gap from the earliest trace to the event

| Event | Project | Event date | Earliest trace | Gap in months |
|---|---|---|---|---|
| EV-001 | Lumwana Super Pit, Lycopodium study award | 2023-12-12 | 2023-07-07 | 5.2 |
| EV-002 | Lumwana Super Pit, Metso equipment order | 2024-09-30 | 2023-07-07 | 14.8 |
| EV-003 | Mopani, Laxyo raise boring contract | 2026-06-22 | 2023-12-22 | 30.0 |
| EV-004 | Mopani, Epiroc underground fleet order | 2026-04-10 | 2023-12-22 | 27.6 |
| EV-005 | KCM tailings leach plant, NERIN EPC | 2026-09-17 | 2024-07-22 | 25.9 |
| EV-006 | Zambia Lobito Rail, EPC bid phase | 2026-04-28 | 2025-06-24 | 10.1 |
| EV-007 | Kansanshi S3, Metso flotation order | 2023-07-04 | 2022-05-09 | 13.8 |

The median gap for all 7 events is 14.8 months. The median gap for the 6 events in the window is 20.3 months. A month is 30.4375 days.

These gaps are an upper limit for Strata. The agent found the traces with hindsight. Strata must find the same traces in date order with no knowledge of later events.

## Weak traces

1. EV-003, EV-004 and EV-005 have company level traces only. The traces show new owners and new capital for Mopani and KCM. They do not name the raise boring work, the fleet order or the tailings leach plant.
2. EV-006 has one dated trace only. The search results named earlier traces, such as the AFC concession agreements, the USTDA grant and a railway MoU. The results gave no date for them, so the agent did not add them.
3. EV-007 is outside the window by about three months. Exclude it if the window is strict.

## Projects with no event

The agent found each project below, but found no dated contractor procurement event for it.

| Project | Reason |
|---|---|
| Kansanshi S3 (after October 2023) | The search results named no contractor award in the window |
| Mingomba (KoBold) | Shaft sinking started on 29 April 2026. No search result named the shaft sinking contractor |
| Maamba Energy phase II | The search results gave financing and commissioning, but no EPC contractor or award date |
| Chisamba solar | PowerChina was the EPC contractor. No search result gave the award date |
| CEC Itimpi phase II | No search result named the EPC contractor or the award date |
| CEC Riverside solar | The EPC contract with Sinohydro was in December 2021. This is outside the window |
| Enterprise nickel | The contract miner mobilised in June 2022. This is outside the window |
| Lumwana Super Pit construction | Barrick said that 81 percent of Q1 2025 procurement went to local contractors. No search result named a contractor |

## Projects not searched

The budget ran out before the agent searched these projects: Mimbula (Moxico), Kitumba, TAZARA, roads that serve mines, fuel supply contracts, drilling contracts, ZPPA notices, ZEMA notices and cadastre records. The next research session must start with these.

## Event type outside the brief list

Three events are orders for equipment from original equipment makers: EV-002, EV-004 and EV-007. The list of event types has no type for them. The agent used the new type equipment_order. An equipment order shows a new fleet or a new plant, so it is a signal of diesel demand. It is not a contract to a service contractor.

## Rows for docs/decisions.md

| Date | Decision | Reason | Document |
|---|---|---|---|
| 2026-09-26 | The backtest dataset is partial, with 7 events and 19 traces. Add events before the backtest runs as a pass or fail test | The session web search budget ran out. The minimum in 09 is 20 events | 09, tests/backtest |
| 2026-09-26 | Add the event type equipment_order to the backtest data | Orders for mine fleets and plant equipment show diesel demand. The type list had no type for them | 09, tests/backtest/events.yaml |
| 2026-09-26 | The text of a backtest trace is its title only, unless a source shows the exact words | A search summary is not a quote. Rule 1 needs a real text span | 09, tests/backtest/traces.yaml |
| 2026-09-26 | Keep EV-007 (Kansanshi S3, July 2023) with a flag. Exclude it from a strict window | The event is about three months before the window. Its data is verified | 09, tests/backtest/events.yaml |
| 2026-09-26 | Record the basis of each date in the note field. Most dates come from the URL path or the article id | Search results do not always show a date. The basis lets a reviewer check the date | 09, tests/backtest |
| 2026-09-26 | A company level trace counts as a trace of the project, with a note | New owners and new capital at a mine come before its contracts. The note shows that the trace does not name the work | 09, tests/backtest/traces.yaml |
