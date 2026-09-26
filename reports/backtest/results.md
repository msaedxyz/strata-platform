# Lead time backtest results

Run date: 2026-09-26 (UTC 14:25:26). Backend: deterministic. Brief version: 1.

Dataset: 7 events and 19 traces (14 distinct documents). Files: tests/backtest/events.yaml and tests/backtest/traces.yaml.

scripts/run_backtest.py writes this file. Do not edit it by hand.

## Result

| Condition | Value | Threshold | Status |
|---|---|---|---|
| Strata finds an earlier signal for 70 percent or more of the events | 100 percent (7 of 7) | 70 percent | Pass |
| The median lead time is 6 months or more | 14.8 months | 6.0 months | Pass |
| The dataset has 20 or more events (docs/09 step 1) | 7 | 20 | Fail |

The two pass conditions of docs/09 are true. The dataset has only 7 events. docs/09 needs 20 or more. The backtest therefore does not pass yet.

Events in the window 2023-10-01 to 2026-09-26 only: 6 of 6 detected, median lead time 20.3 months. The window is not strict, so the conditions above use all events.

## Sensitivity to the matching rules

The same replay, with fewer matching rules. The first row is the result above.

| Rules | Detected | Median lead time | Two docs/09 conditions |
|---|---|---|---|
| All rules (project, site, title, company) | 7 of 7 | 14.8 months | Pass |
| Without the title words (project, site, company) | 6 of 7 | 20.3 months | Pass |
| Entity links only, no company level (project, site) | 3 of 7 | 13.8 months | Fail |

First signal date of each event for each set of rules:

| Event | All rules | Without the title words | Entity links only, no company level |
|---|---|---|---|
| EV-007 | 2022-05-09 | 2022-05-09 | 2022-05-09 |
| EV-001 | 2023-07-07 | 2023-07-07 | 2023-07-07 |
| EV-002 | 2023-07-07 | 2023-07-07 | 2023-07-07 |
| EV-004 | 2023-12-22 | 2023-12-22 | miss |
| EV-006 | 2025-06-24 | miss | miss |
| EV-003 | 2023-12-22 | 2023-12-22 | miss |
| EV-005 | 2024-07-22 | 2024-07-22 | miss |

## Events

| Event | Date | Project | Type | First signal date | First signal title | Tier | Match | Lead time |
|---|---|---|---|---|---|---|---|---|
| EV-007 (outside the window) | 2023-07-04 | Kansanshi S3 Expansion | equipment_order | 2022-05-09 | First Quantum board signs off development of Kansanshi S3 Expansion, Enterprise nickel project | 0 | project: entity 'Kansanshi S3 Expansion' and site: entity 'Kansanshi mine' (kansanshi) and title: words Kansanshi | 421 days (13.8 months) |
| EV-001 | 2023-12-12 | Lumwana Super Pit Expansion | epc_award | 2023-07-07 | Great Future Beckons for Lumwana as Barrick Unlocks Potential | 2 | site: entity 'Lumwana mine' (lumwana) and title: words Lumwana and company: entity 'Barrick Mining Corporation' (barrick) | 158 days (5.2 months) |
| EV-002 | 2024-09-30 | Lumwana Super Pit Expansion | equipment_order | 2023-07-07 | Great Future Beckons for Lumwana as Barrick Unlocks Potential | 2 | site: entity 'Lumwana mine' (lumwana) and title: words Lumwana and company: entity 'Barrick Mining Corporation' (barrick) | 451 days (14.8 months) |
| EV-004 | 2026-04-10 | Mopani underground fleet renewal | equipment_order | 2023-12-22 | ZCCM-IH Transaction Announcement Regarding Mopani Copper Mines | 2 | title: words Mopani and company: entity 'Mopani Copper Mines Plc' (mopani_copper_mines) | 840 days (27.6 months) |
| EV-006 | 2026-04-28 | Zambia Lobito Rail (Jimbe to Chingola greenfield line) | tender | 2025-06-24 | AfDB invests $1B in Lobito Corridor, signs Zambia rail pact | 2 | title: words Lobito + Zambia + rail | 308 days (10.1 months) |
| EV-003 | 2026-06-22 | Mopani underground development | drilling_contract | 2023-12-22 | ZCCM-IH Transaction Announcement Regarding Mopani Copper Mines | 2 | title: words Mopani and company: entity 'Mopani Copper Mines Plc' (mopani_copper_mines) | 913 days (30.0 months) |
| EV-005 | 2026-09-17 | KCM Tailings Leach Plant | epc_award | 2024-07-22 | Vedanta Regains Control of Konkola Copper Mines in Zambia | 2 | title: words Konkola and company: entity 'Konkola Copper Mines Plc' (kcm) | 787 days (25.9 months) |

## Misses

Strata found an earlier signal for each event. There is no miss.

## Signals

Each SignalScored event of the replay, in date order, with the entities that it names.

| Date | Title | Tier | Tier rule | Entities |
|---|---|---|---|---|
| 2022-05-09 | First Quantum board signs off development of Kansanshi S3 Expansion, Enterprise nickel project | 0 | t0_new_project_first_trace | organisation:First Quantum Minerals, site:Kansanshi mine, site:Enterprise nickel mine, project:Kansanshi S3 Expansion, project:Enterprise nickel project |
| 2023-07-07 | Great Future Beckons for Lumwana as Barrick Unlocks Potential | 2 | t2_relevant | organisation:Barrick Mining Corporation, site:Lumwana mine |
| 2023-10-04 | Barrick Earmarks $2 Billion for Copper 'Super Pit' in Zambia | 2 | t2_relevant | organisation:Barrick Mining Corporation |
| 2023-12-12 | Lycopodium engaged by Barrick for Lumwana copper expansion study | 0 | t0_new_project_first_trace | organisation:Barrick Mining Corporation, site:Lumwana mine, project:Lumwana copper expansion |
| 2023-12-22 | ZCCM-IH Transaction Announcement Regarding Mopani Copper Mines | 2 | t2_relevant | organisation:ZCCM Investments Holdings Plc, organisation:Mopani Copper Mines Plc |
| 2023-12-22 | Abu Dhabi's IRH Will Invest $1.1 Billion in Mopani Copper Deal | 2 | t2_relevant | organisation:Mopani Copper Mines Plc, organisation:International Resources Holding |
| 2024-01-29 | Barrick Gold accelerates Lumwana mine expansion project | 2 | t2_relevant | organisation:Barrick Mining Corporation, site:Lumwana mine, project:Lumwana copper expansion |
| 2024-07-22 | Vedanta Regains Control of Konkola Copper Mines in Zambia | 2 | t2_relevant | organisation:Konkola Copper Mines Plc, organisation:Vedanta Resources |
| 2024-09-11 | Feasibility study on Lumwana Super Pit expansion expected by year-end | 0 | t0_enters_engagement_window | site:Lumwana mine, project:Lumwana copper expansion |
| 2025-05-02 | Vedanta Resources weighs Zambia copper IPO to fund $1 billion investment | 2 | t2_relevant | organisation:Vedanta Resources |
| 2025-06-24 | AfDB invests $1B in Lobito Corridor, signs Zambia rail pact | 2 | t2_relevant | organisation:African Development Bank |
| 2025-11-07 | Vedanta spins off Konkola Copper Mines into US-domiciled CopperTech Metals Inc | 2 | t2_relevant | organisation:Konkola Copper Mines Plc, organisation:Vedanta Resources |
| 2026-04-10 | Epiroc wins large order from Mopani Copper Mines in Zambia | 1 | t1_contractor_award_watched | organisation:Mopani Copper Mines Plc |

## Method

1. The harness starts with a fresh database. It loads brief v1 and the watch lists.
2. Each trace becomes a source through the collector pipeline. The source type is snapshot and the retention is link_only. The text is the title of the trace. The published date and the fetched date are the trace date.
3. The harness loads the traces in date order. It enriches each source before it loads the next source. So the agents never see a later source.
4. A signal is a SignalScored event in the event store. The backtest counts the tiers 0, 1, 2.
5. For each event, the first signal is the earliest signal before the event date that meets a rule in config/backtest.yaml: a project entity, a site entity, the words of the title, or the operator entity (company level).
6. Lead time is the event date minus the first signal date. A month is 30.44 days. The median uses the detected events only.

## Limits

1. The traces were found with hindsight. The gaps are therefore an upper limit.
2. The text of each trace is its title only. The agents see no body text.
3. The deterministic backend ran the agents. The Anthropic backend has no backtest numbers yet.
4. 4 of 7 detected events (EV-004, EV-006, EV-003, EV-005) match on the title words or the operator entity only. The resolver did not link the site or the project of the event to the first signal.
