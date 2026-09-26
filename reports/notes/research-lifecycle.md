# Research note: lifecycle intervals for the window forecaster

Date: 2026-09-26

Documents: 03-data-model.md (Project lifecycle), 05-enrichment.md (Window forecaster)

## 1. Purpose

The window forecaster calculates the start of contractor procurement from the current lifecycle stage of a project. It uses intervals from historical projects. This note gives the evidence for these intervals.

## 2. Files

| File | Content |
|---|---|
| config/lifecycle-history.yaml | 27 historical projects and their dated milestones. Each milestone has a URL, a publisher, a title and a note |
| scripts/compute_lifecycle_intervals.py | The script that calculates the intervals. It uses Python 3.11 and PyYAML only |
| config/lifecycle-intervals.generated.yaml | The output of the script. Do not edit it by hand |

To make the intervals again, run this command:

```
python scripts/compute_lifecycle_intervals.py
```

## 3. Method

1. We used WebSearch only. Direct HTTP access to most sites is blocked in this environment.
2. We took each date from a search result. We recorded the URL of that result. We did not invent a date or a URL.
3. We recorded the precision of each date: day, month, quarter or year. When a URL path gave only a month, we used month precision.
4. We mapped each event to one stage in the lifecycle of 03-data-model.md. Section 6 gives the mapping rules.
5. The script uses the earliest date of each stage for each project. This is the first time the project reached the stage.
6. The script converts each partial date to one point date. A month date becomes day 15. A quarter date becomes day 15 of the middle month. A year date becomes 1 July.
7. The script calculates two sets of intervals:
   - from each earlier stage to contractor_procurement, in the main order and in the restart order
   - between each pair of consecutive stages, in the main order and in the restart order
8. Sometimes a later stage has an earlier date. If the difference is inside the combined uncertainty of the two dates, the script sets the interval to 0 days. The output lists these projects as concurrent_projects.
9. If the difference is larger, the script marks the project as out_of_order. The interval of that project is not in the median, the minimum or the maximum. The output lists the project and the number of days.
10. The script marks an interval with fewer than 5 projects as insufficient. This follows rule 5 of the Window forecaster in 05-enrichment.md.
11. All parameters of the script are in the settings block of config/lifecycle-history.yaml. The code contains no threshold or stage list.

## 4. Projects

The history has 27 projects. 17 are in Zambia. The other 10 are in DRC (4), Botswana (2), Namibia (2), Tanzania (1) and Mozambique (1).

| Id | Country | Type | Stages with a date |
|---|---|---|---|
| lumwana_super_pit | ZM | copper expansion | 4, 8, 9 |
| kansanshi_s3 | ZM | copper expansion | 8 |
| enterprise_nickel | ZM | nickel | 8, 9, 10, 11, 12 |
| sentinel_trident | ZM | copper | 10, 11, 12 |
| lumwana_original | ZM | copper | 4, 8, 9, 10, 11 |
| munali_nickel | ZM | nickel | 9, 10, 11 |
| kafue_gorge_lower | ZM | hydropower | 8, 9, 11 |
| maamba_phase2 | ZM | coal power | 8, 10 |
| ngonye_solar | ZM | solar | 8, 10, 11 |
| bangweulu_solar | ZM | solar | 8, 10, 11 |
| chisamba_solar | ZM | solar | 10, 11 |
| kitumba | ZM | copper | 3, 7, 8, 10, 11 |
| mimbula | ZM | copper | 11 |
| kcm_restart | ZM | copper restart | restart_plan, recapitalisation, 9 |
| mopani_recap | ZM | copper recapitalisation | restart_plan, recapitalisation |
| lubambe | ZM | copper recapitalisation | recapitalisation |
| zambia_lobito_rail | ZM | rail | 7 |
| kamoa_kakula | CD | copper | 3, 4, 5, 7, 9, 10, 11, 12 |
| kipushi_restart | CD | zinc restart | restart_plan, 4, 10, 11, restart |
| tfm_mixed_ore | CD | copper-cobalt expansion | 8, 11 |
| kisanfu | CD | copper-cobalt | 8 |
| khoemacau_zone5 | BW | copper-silver | 4, 7, 8, 9, 10, 11, 12 |
| motheo_t3 | BW | copper-silver | 4, 5, 7, 8, 9, 11, 12 |
| otjikoto | NA | gold | 4, 6, 7, 8, 9, 10, 11 |
| tschudi | NA | copper | 6, 10, 11, 13 |
| nyanzaga | TZ | gold | 4, 7, 8, 9 |
| balama | MZ | graphite | 4, 7, 10, 11, 12 |

Stage numbers: 3 scoping_prefeasibility, 4 feasibility, 5 eia_filed, 6 environmental_approval, 7 licence_granted, 8 financing_fid, 9 contractor_procurement, 10 construction_mobilisation, 11 commissioning_rampup, 12 steady_operation, 13 care_maintenance_suspension_closure.

## 5. Intervals

One month is 30.4375 days. "OOO" means out of order.

### 5.1 Intervals to contractor procurement

| From | To | n | Median | Min | Max | Projects | OOO | Status |
|---|---|---|---|---|---|---|---|---|
| feasibility | contractor_procurement | 6 | 624 d (20.5 mo) | 0 d | 1805 d (59.3 mo) | lumwana_super_pit, lumwana_original, khoemacau_zone5, motheo_t3, otjikoto, nyanzaga | kamoa_kakula | Sufficient |
| financing_fid | contractor_procurement | 5 | 7 d (0.2 mo) | 0 d | 167 d (5.5 mo) | lumwana_super_pit, enterprise_nickel, motheo_t3, otjikoto, nyanzaga | lumwana_original, kafue_gorge_lower, khoemacau_zone5 | Sufficient |
| licence_granted | contractor_procurement | 4 | 1390 d (45.7 mo) | 198 d | 1912 d (62.8 mo) | kamoa_kakula, khoemacau_zone5, otjikoto, nyanzaga | motheo_t3 | Insufficient |
| eia_filed | contractor_procurement | 2 | 320 d (10.5 mo) | 152 d | 488 d | kamoa_kakula, motheo_t3 | none | Insufficient |
| environmental_approval | contractor_procurement | 1 | 320 d (10.5 mo) | 320 d | 320 d | otjikoto | none | Insufficient |
| scoping_prefeasibility | contractor_procurement | 0 | none | none | none | none | kamoa_kakula | Insufficient |
| restart_plan | contractor_procurement | 1 | 741 d (24.3 mo) | 741 d | 741 d | kcm_restart | none | Insufficient |
| recapitalisation | contractor_procurement | 1 | 677 d (22.2 mo) | 677 d | 677 d | kcm_restart | none | Insufficient |

### 5.2 Consecutive stages

| From | To | n | Median | Min | Max | Status |
|---|---|---|---|---|---|---|
| contractor_procurement | construction_mobilisation | 4 | 1 d (0.0 mo) | 0 d | 4 d | Insufficient. OOO: lumwana_original, munali_nickel |
| construction_mobilisation | commissioning_rampup | 14 | 571 d (18.7 mo) | 250 d (8.2 mo) | 1286 d (42.3 mo) | Sufficient |
| commissioning_rampup | steady_operation | 6 | 329 d (10.8 mo) | 37 d (1.2 mo) | 762 d (25.0 mo) | Sufficient |
| licence_granted | financing_fid | 4 | 1354 d (44.5 mo) | 31 d | 3804 d (125.0 mo) | Insufficient. OOO: motheo_t3 |
| scoping_prefeasibility | feasibility | 1 | 571 d (18.8 mo) | 571 d | 571 d | Insufficient |
| environmental_approval | licence_granted | 1 | 122 d (4.0 mo) | 122 d | 122 d | Insufficient |
| restart_plan | recapitalisation | 2 | 78 d (2.5 mo) | 64 d | 91 d | Insufficient |
| feasibility | eia_filed | 0 | none | none | none | Insufficient. OOO: kamoa_kakula, motheo_t3 |

### 5.3 Status of the requested intervals

| Interval | Target | Result |
|---|---|---|
| 4 to 9 | 5 projects | Met. n = 6 |
| 5 to 9 | 5 projects | Not met. n = 2 |
| 6 to 9 | 5 projects | Not met. n = 1 |
| 7 to 9 | 5 projects | Not met. n = 4 |
| 8 to 9 | 5 projects | Met. n = 5 |
| 9 to 10 | 5 projects | Not met. n = 4 |
| restart_plan to 9 | 5 projects | Not met. n = 1 |

## 6. Mapping rules

1. A board approval of an owner-funded project is financing_fid. Examples are Kansanshi S3, Enterprise, Lumwana Super Pit and Otjikoto.
2. A signed debt facility or a financial close is financing_fid.
3. The first award of an EPC, EPCM, EP or mining contract is contractor_procurement. If a source only says that procurement was placed in a quarter, we used that quarter (Lumwana Super Pit).
4. A groundbreaking, the start of a pre-strip or the first blast of a decline is construction_mobilisation.
5. First concentrate, first gold, first copper or the first commissioned unit is commissioning_rampup.
6. A declaration of commercial production is steady_operation.
7. A concession agreement for infrastructure is licence_granted (Zambia Lobito rail).
8. For a restart, the agreement that returns the asset to an operator is restart_plan. The completion of the equity deal is recapitalisation.
9. The date of a news article is the date of the event only when the source gives no better date. The note of each milestone says when we did this.

## 7. Findings

1. From feasibility, procurement starts after a median of about 20 months. The range is wide, from 0 to 59 months. A change of owner or a long wait for financing makes the interval long (Khoemacau, Nyanzaga, Lumwana first development).
2. From financing_fid, procurement starts almost at once. The median is 7 days. In 3 more projects, the contract came before the financing (Khoemacau, Lumwana first development, Kafue Gorge Lower). Thus the engagement window closes at stage 8 or before it. The team must engage at stage 4 to 7.
3. For EPC plus finance projects with Chinese lenders, the EPC award comes first. The loan comes later. Kafue Gorge Lower got its EPC contract in October 2015 and its buyer's credit in November 2017.
4. Some projects start contractor work before the feasibility study. Kamoa-Kakula awarded the Kakula decline contract in November 2017. The PFS came in February 2019 and the DFS in September 2020. The lifecycle agent must accept a stage 9 or stage 10 event before stage 4.
5. Construction to first production has a median of about 19 months (n = 14). Solar projects take 8 to 15 months. Large underground copper mines take 24 to 42 months.
6. A mining licence can come after the contracts. Motheo got its licence in July 2021, after the FID and after both contract awards.

## 8. Gaps

1. The session used all its WebSearch calls (200). Many planned searches did not run. These data are missing:
   - Kansanshi S3: contractor award, construction start and first production dates
   - Lumwana Super Pit: named EPC or mining contract, environmental approval
   - Sentinel: feasibility study and licence dates
   - Mimbula: all stages before first copper
   - Mingomba, Kalengwa and Chambishi: no data
   - Kafue Gorge Lower: EIA approval and construction start
   - Maamba Phase II, Chisamba, Ngonye and Bangweulu: EPC award dates
   - Mopani and Lubambe: contractor awards after the recapitalisation
   - Lobito Atlantic Railway (Angola brownfield): dated milestones
   - Zimbabwe and Angola: no projects
2. Few sources give dates for eia_filed and environmental_approval. Zambian EIA dates are in the ZEMA register. A collector for the ZEMA register can fill this gap.
3. The restart path has one project with a contractor date (KCM). The restart_plan to contractor_procurement interval cannot support a forecast.
4. Some sources are summary pages (NS Energy, Mining Technology, Wikipedia). They are secondary sources.

## 9. Milestones to verify

The search summary gave these dates, but it did not show the exact page. The note of each milestone starts with "VERIFY:". A human must open the page and confirm the date.

| Project | Stage | Date |
|---|---|---|
| lumwana_super_pit | feasibility | 2025-02-19 |
| lumwana_original | contractor_procurement | 2006-10 |
| kafue_gorge_lower | commissioning_rampup | 2021-07-23 |
| kcm_restart | contractor_procurement | 2025-09 |
| tfm_mixed_ore | commissioning_rampup | 2023-10 |
| khoemacau_zone5 | feasibility | 2014-07 |
| khoemacau_zone5 | licence_granted | 2015 |
| khoemacau_zone5 | construction_mobilisation | 2019-06-28 |
| motheo_t3 | eia_filed | 2019-08 |
| otjikoto | environmental_approval | 2012-08 |
| otjikoto | feasibility | 2013-01 |
| otjikoto | financing_fid | 2013-01 |
| otjikoto | construction_mobilisation | 2013-04-26 |
| nyanzaga | licence_granted | 2021-12-13 |
| balama | licence_granted | 2013-12 |
| balama | construction_mobilisation | 2016-07 |
| balama | steady_operation | 2019-01 |

## 10. Recommendations for the forecaster

1. Load the intervals from config/lifecycle-intervals.generated.yaml into config/lifecycle.yaml. Keep the list of supporting projects with each interval.
2. Forecast a procurement date only from feasibility and from financing_fid. Both have 5 or more projects.
3. For stages 5, 6 and 7 and for the restart path, show the lifecycle stage only. Show no date.
4. Show the share of out of order projects with each interval. For financing_fid, 3 of 8 projects awarded contracts before financing.
5. Run the script again when new history is added. Add projects from the ZEMA register and from company filings to reach 5 projects for 5 to 9, 6 to 9, 7 to 9 and 9 to 10.

## 11. Decision rows for decisions.md

| Date | Decision | Reason | Document |
|---|---|---|---|
| 2026-09-26 | Keep the historical milestones in config/lifecycle-history.yaml. Make the intervals with scripts/compute_lifecycle_intervals.py into config/lifecycle-intervals.generated.yaml | Rule 11 keeps intervals in configuration. A script makes the intervals repeatable and shows the projects that support them | 05 |
| 2026-09-26 | config/lifecycle.yaml takes its intervals from config/lifecycle-intervals.generated.yaml | 05 says to store the intervals in config/lifecycle.yaml. One generated source prevents two different copies | 05 |
| 2026-09-26 | Use the earliest date of each stage for each project | The forecaster needs the first time that a project reaches a stage | 05 |
| 2026-09-26 | Convert a month date to day 15, a quarter date to day 15 of the middle month, and a year date to 1 July | Many sources give only a month, a quarter or a year | 05 |
| 2026-09-26 | Set a negative interval to 0 if it is inside the date uncertainty. Remove a larger negative interval from the statistics and list it as out of order | Owners often award contracts before or with the financing. The output must show these cases but must not give a negative median | 05 |
| 2026-09-26 | Forecast procurement dates only from feasibility (n = 6) and financing_fid (n = 5). Show the stage only for stages 5, 6 and 7 and for the restart path | Fewer than five historical projects support the other intervals | 05 |
| 2026-09-26 | An owner-funded board approval is financing_fid. A concession agreement is licence_granted | The lifecycle has no separate stage for these events | 03 |
| 2026-09-26 | The lifecycle agent accepts a stage 9 or stage 10 event before stage 4 | Kamoa-Kakula awarded contractor work before its PFS and DFS | 03, 05 |
| 2026-09-26 | A milestone with a note that starts with "VERIFY:" needs a human check before the forecaster uses it in production | The search summary gave the date but not the exact page | 05, 06 |
