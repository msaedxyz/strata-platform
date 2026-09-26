# Research notes: Monitoring Brief v1

Date: 2026-09-26
Author: research subagent
Files: config/monitoring-brief/v1.yaml, config/taxonomy/geographies.yaml, config/taxonomy/activity-types.yaml, config/taxonomy/deal-types.yaml

## 1. Summary

The Argo files (/home/atlas/agents/argo/*) and config/monitoring-brief/v1.yaml were not available. This brief comes from public research with the WebSearch tool only. The build environment blocks direct fetches. No page was opened. Each fact, URL and coordinate comes from a WebSearch result title, link or summary.

The session web search budget ended after about 55 searches. The limit is 200 calls and other agents share it. Some planned research did not occur, for example district centre coordinates, news feed URLs and some early signal sources. Each of these items is a known gap or a null field. Nobody guessed a value.

Counts in v1.yaml:

| Item | Count |
|---|---|
| Daily watch sites | 20 |
| Weekly watch sites | 37 |
| Sites with geometry | 21 of 57 |
| Organisations | 71 |
| Themes | 36 (13 project_pipeline, 8 procurement, 7 demand_up, 8 demand_down) |
| Theme keywords (activity types) | 185 |
| Google News queries | 69 (35 daily, 34 weekly) |
| News sources | 13 |
| Early signal sources | 30 |
| Proposed sources | 2 |
| Known gaps | 18 |

## 2. Sites

### 2.1 Coordinates

1. A coordinate is in v1.yaml only when a search result showed it. The sources are Wikipedia articles and one Wikidata item (Mufulira Mine, Q19951143).
2. Some coordinates are for a town, an area or a bridge near the site, for example Nkana, Konkola, Chambishi, Kasumbalesa, Nakonde and Kariba Dam. These have approximate: true and a note.
3. Mindat gave coordinates for Kagem. Mindat is not an approved dataset in the brief format, so the geometry is null. The note gives the Mindat page for review.
4. The search budget ended before the district centre searches. 36 sites therefore have geometry: null. The next step is a Wikidata lookup of each district centre. Use approximate: true and the dataset "district centre (Wikidata)".

### 2.2 Site facts that the research did not confirm

| Site | Unconfirmed item |
|---|---|
| lumwana, zambia_lobito_rail, lusaka_ndola_dual_carriageway, arc_minerals_nw, batoka_gorge, lumwana_mfez | District not found |
| kariba_north_bank | District (Siavonga) not confirmed |
| chirundu_border | Province of Chirundu District not confirmed |
| kafue_sugar | Province of Shibuyunji District not confirmed |
| mopani_mufulira | Suspension of 13 February 2026 found. Current status not found |
| lusaka_ndola_dual_carriageway | Construction status not found |
| kafue_gorge_lower | Operator (ZESCO) not confirmed by a result |
| nakambala | The summary gave coordinates but did not name the page |
| kabwe_tailings | The link between Enviro Processing and Jubilee Metals is not confirmed |
| Border posts | Border agency operator not researched. operator is null |

### 2.3 Evidence for each site

Each site has an evidence_url and a note in v1.yaml. The main search queries were:

| Sites | Search query |
|---|---|
| kansanshi | Kansanshi mine Wikipedia coordinates Solwezi First Quantum |
| sentinel | Sentinel mine Kalumbila Wikipedia coordinates |
| lumwana | Lumwana mine Barrick Wikipedia coordinates |
| mopani_mufulira, mopani_nkana | Mopani Copper Mines Mufulira Nkana IRH 2026. Mufulira mine Wikipedia coordinates. Nkana mine Kitwe Wikipedia coordinates |
| kcm_nchanga, kcm_konkola | Konkola Copper Mines Vedanta Nchanga Konkola 2026. Nchanga Copper mine Wikipedia coordinates Chingola. Konkola mine Wikipedia coordinates Chililabombwe |
| mimbula | Mimbula mine Moxico Resources Chingola Wikipedia |
| enterprise | Enterprise nickel mine First Quantum Kalumbila 2026 |
| chambishi | Chambishi mine NFC Africa Mining Wikipedia coordinates |
| lubambe | Lubambe copper mine 2026 owner Chililabombwe |
| luanshya | Luanshya Copper Mines Baluba Muliashi CNMC 2026 |
| mingomba | Mingomba KoBold Metals Chililabombwe feasibility 2026 |
| kitumba | Kitumba copper project Mumbwa Intrepid Mines 2026 |
| kalengwa | Kalengwa copper mine Mufumbwe Zambia 2026 |
| kashime | Mkushi copper mine Zambia 2026 operator |
| kabwe_tailings | Kabwe mine tailings Jubilee Metals Enviro Processing 2026. Kabwe mine Wikipedia coordinates Broken Hill |
| maamba | Maamba Energy coal mine power station Sinazongwe expansion 2026. Maamba Coal Power Station Wikipedia coordinates location |
| kafue_gorge_lower | Kafue Gorge Lower Power Station Wikipedia coordinates |
| kariba_north_bank | Kariba North Bank Power Station Wikipedia coordinates extension. Kariba Dam Wikipedia coordinates |
| chisamba_solar | Zambia large solar power project 2026 construction MW Chisamba Copperbelt Energy. Chisamba Solar Power Plant Wikipedia coordinates |
| batoka_gorge | Batoka Gorge hydroelectric 2026 financial close EPC |
| nakambala | Zambia Sugar Nakambala estate Mazabuka Wikipedia coordinates |
| zambeef_mpongwe | Zambeef Products plc farms Mpongwe Huntley 2026 |
| kafue_sugar | Kafue Sugar estate Zambia 2026 expansion |
| amatheon_mumbwa | Amatheon Agri Zambia Mumbwa farm |
| mkushi_farm_block | Mkushi farm block commercial farms Zambia 2026 irrigation |
| nansanga_farm_block | Nansanga farm block Serenje development 2026 |
| indeni, ndola_fuel_terminal | Indeni oil refinery Ndola Wikipedia coordinates. Ndola fuel storage terminal Zambia 2026 capacity ERB |
| tazama_pipeline, tz_zm_products_pipeline | Tazama Pipeline Wikipedia Ndola terminal Dar es Salaam 2026 |
| lobito_lusaka_pipeline | Lobito-Lusaka Oil Products Pipeline Wikipedia status |
| chilanga_cement_ndola, chilanga_cement_chilanga, ndola_lime | Lafarge Chilanga cement plant Zambia Huaxin Ndola plant 2026 |
| dangote_masaiti | Dangote cement Masaiti plant Zambia 2026 |
| ncz_kafue | Nitrogen Chemicals of Zambia Kafue fertiliser plant 2026 |
| lusaka_south_mfez, chambishi_mfez, lumwana_mfez | Chambishi multi-facility economic zone Lusaka South MFEZ Lumwana MFEZ 2026 new investors |
| kasumbalesa_border | Kasumbalesa border post Zambia Wikipedia coordinates |
| chirundu_border | Chirundu border post Wikipedia coordinates one stop border |
| nakonde_border | Nakonde Tunduma border Wikipedia coordinates |
| kazungula_border | Kazungula Bridge one stop border post Wikipedia coordinates |
| mwami_border | Mwami border post Chipata Mchinji Wikipedia coordinates |
| katima_mulilo_border | Katima Mulilo Wenela border Sesheke Zambia Namibia Wikipedia coordinates |
| jimbe_border, mwinilunga_jimbe_t5 | Jimbe border post Zambia Angola Mwinilunga Lobito corridor |
| tazara | TAZARA railway revitalisation CCECC 2026 concession |
| zambia_lobito_rail | Zambia Lobito rail corridor greenfield Chingola Jimbe Africa Finance Corporation 2026 |
| lusaka_ndola_dual_carriageway | T3 road Zambia Wikipedia Lusaka Ndola dual carriageway Macro Ocean |
| kagem | Kagem emerald mine Lufwanyama Gemfields Wikipedia coordinates |
| muntanga | Mutanga uranium project GoviEx Zambia 2026 mining licence |
| munali | Munali nickel mine Mazabuka restart 2026 |
| arc_minerals_nw | Zambia copper exploration project North-Western Province 2026 drilling resource Anglo American Arc Minerals Midnight Sun |
| kasenseli | Kasenseli gold mine Mwinilunga Zambia 2026 |

Organisations for fuel supply came from the query "Zambia oil marketing companies Puma Energy Zambia Total Energies Zambia Mount Meru Petroleum Zambia diesel supply mines".

## 3. Sources

### 3.1 Verification labels

Each source has one of three verification texts:

1. Found: the exact URL was a result link.
2. Derived: the root or a section of a domain that was a result link. The exact path was not a result link. Confirm the path on the first run.
3. Feed in summary: the feed URL appeared in the text of a result summary, not as a link.

No terms of use were read. Each source has licence_code verify_then_purge and terms "Terms not checked: direct fetch blocked".

### 3.2 News sources

| Id | URL | Label | How found (query and result) |
|---|---|---|---|
| news_lusaka_times | http://www.lusakatimes.com/other-news/feed | Feed in summary | "Lusaka Times RSS feed lusakatimes.com/feed" |
| news_times_of_zambia | http://www.times.co.zm/ | Derived | Results http://www.times.co.zm/?p=63324 (MFEZ query) and https://www.times.co.zm/?p=135617 (Kasenseli query) |
| news_diggers | https://diggers.news/local/ | Derived | Result https://diggers.news/local/2026/07/03/chisamba-phase-ii-reaches-96-percent-completion/ (solar query) |
| news_znbc | https://www.znbc.co.zm/news/ | Derived | Result https://www.znbc.co.zm/news/farm-blocks-have-potential-to-increase-agriculture-production/ (Nansanga query) |
| news_zambian_mining_news | https://www.miningnewszambia.com/ | Derived | Results on the Mufulira suspension and Kansanshi S3 (Mopani and Enterprise queries) |
| news_zambian_business_times | https://zambianbusinesstimes.com/ | Derived | Results on Kalengwa, NFC Africa and Mount Meru |
| news_zambia_chamber_of_mines | https://mines.org.zm/ | Found | Mkushi copper query |
| news_mwebantu | https://www.mwebantu.com/ | Derived | Result https://www.mwebantu.com/erb-maintains-fuel-prices-for-september-2026 (ERB query) |
| news_daily_nation | https://dailynationzambia.com/ | Derived | Result on MFEZs (MFEZ query) |
| news_mining_technology | https://www.mining-technology.com/news/ | Derived | Results /news/luanshya-mine-to-restart-production-august/ and /news/moxico-zambia-copper-mine/ |
| news_mining_com | https://www.mining.com/ | Derived | Results on Kitumba, Lumwana and Anglo American |
| news_global_cement | https://www.globalcement.com/news | Derived | Results on Chilanga Cement and the August 2026 South East Africa update |
| news_railways_africa | https://www.railwaysafrica.com/news/ | Derived | Result on the TAZARA concession model (TAZARA query) |

### 3.3 Early signal sources

| Id | Source type | URL | Label | How found |
|---|---|---|---|---|
| es_zema_docs | zema_eia | https://www.zema.org.zm/docs/ | Derived | NCZ query. Result: ZEMA docs page for the NCZ blending plant |
| es_zema_uploads_example | zema_eia | https://www.zema.org.zm/wp-content/uploads/2024/01/Proposed-Construction-and-Operation-of-a-Fertilizer-Blending-Plant-by-NCZ.pdf | Found | NCZ query |
| es_fqm_news | exchange_filings | https://www.first-quantum.com/news/ | Derived | Enterprise query. Result: FQM 2026-2028 guidance news release |
| es_cnmc_news | exchange_filings | https://www.cnmcl.net/en/news-center/group-company-news/ | Found | Luanshya query |
| es_luse_zambeef | exchange_filings | https://africanfinancials.com/company/zm-zamb/ | Found | Zambeef query |
| es_luse_chilanga | exchange_filings | https://africanfinancials.com/company/zm-chil/ | Found | Chilanga query |
| es_barrick_lumwana | investor_reports | https://www.barrick.com/English/operations/lumwana/default.aspx | Found | Lumwana query |
| es_kobold_mingomba | investor_reports | https://koboldmetals.com/mingomba/ | Found | Mingomba query |
| es_goviex_muntanga | investor_reports | https://goviex.com/projects/muntanga/ | Found | Muntanga query |
| es_jubilee_copper | investor_reports | https://jubileemetalsgroup.com/copper/ | Found | Kabwe query |
| es_mopani_home | investor_reports | https://mopani.com.zm/ | Found | Mopani query |
| es_lubambe_home | investor_reports | https://lubambe.com/ | Found | Lubambe query |
| es_zccm_ih | investor_reports | https://www.zccm-ih.com.zm/ | Derived | Many ZCCM-IH asset pages in results |
| es_zambeef_annual_report | investor_reports | https://zambeefplc.com/wp-content/uploads/2024/12/Zambeef-Products-Plc-Annual-Report-2024.pdf | Found | Zambeef query |
| es_afdb_lobito_t5 | dfi_projects | https://www.afdb.org/en/documents/gpn-zambia-lobito-integrated-corridor-development-project-upgrading-mwinilunga-jimbe-t5-road | Found | Jimbe query |
| es_afdb_lobito_loan | dfi_projects | https://www.afdb.org/en/news-and-events/zambia-african-development-bank-group-approves-255m-loan-and-10m-grant-advance-lobito-economic-corridor-96069 | Found | Jimbe query |
| es_afc_news | dfi_projects | https://www.africafc.org/news-and-insights/news/ | Derived | Lobito rail query |
| es_eu_lobito | dfi_projects | https://international-partnerships.ec.europa.eu/lobito-corridor-building-future-together_en | Found | Lobito rail query |
| es_zda_izic_projects | zda_mfez | https://zda.org.zm/izic/projects/ | Derived | Maamba query. Result: /izic/projects/maamba-energy-ground-breaking/ |
| es_zppa_egp | procurement_notices | https://eprocure.zppa.org.zm/epps/ | Derived | NCZ query. Result: e-GP organisation page for NCZ |
| es_tazama_home | procurement_notices | https://tazama.co.zm/ | Found | TAZAMA query. A result was the new pipeline RFP advert |
| es_zambezira_batoka | procurement_notices | https://www.zambezira.org/hydro-electric-schemes/batoka-hes-project | Found | Batoka query |
| es_tazara_news | procurement_notices | https://www.tazarasite.com/ | Derived | TAZARA query |
| es_parliament | budget_parliament | https://www.parliament.gov.zm/ | Derived | T3 query (/node/10947) and Kasenseli query (/node/10118) |
| es_state_house | budget_parliament | https://www.sh.gov.zm/ | Derived | Mingomba query |
| es_pdu_blog | budget_parliament | https://www.pdu.gov.zm/blog/ | Derived | Kitumba query |
| es_motl | budget_parliament | https://www.motl.gov.zm/ | Derived | Jimbe and TAZARA queries |
| es_erb_home | market_regulator | https://www.erb.org.zm/ | Found | ERB query |
| es_erb_petroleum | market_regulator | https://www.erb.org.zm/petroleum | Found | ERB and Ndola terminal queries |
| es_moe_petroleum | market_regulator | https://www.moe.gov.zm/?page_id=2522 | Found | Oil marketing companies query |

### 3.4 Proposed sources

| Id | URL | Label | Reason |
|---|---|---|---|
| prop_copperbelt_katanga_mining | https://copperbeltkatangamining.com/ | Derived | It covers both sides of the Kasumbalesa corridor. Results on Kitumba and NFC Africa came from it |
| prop_logcluster_zambia_fuel | https://lca.logcluster.org/31-zambia-fuel | Found | It describes fuel infrastructure and has pages for the Kasumbalesa, Mwami and Jimbe crossings |

### 3.5 Google News only

The list is a conservative default. Nobody tested access. It contains the Zambia Daily Mail e-paper and main site, Mining Weekly, the African Energy database, Reuters, Bloomberg, the Financial Times, PitchBook, Wood Mackenzie and Mining Data Online. Review the list after the first run.

## 4. Gaps

| Gap | Reason |
|---|---|
| Zambia Mining Cadastre | No official URL found. The search budget ended |
| Government Gazette | No official online source found |
| PACRA register | No public feed or terms found. external_ids are empty for all organisations |
| SEDAR+ | No issuer filing URL found. The FQM news page is used instead |
| LSE RNS | Only one RNS story (Bezant Resources) found. No feed for watched operators |
| JSE SENS | Not found |
| LuSE announcements | No official LuSE page found. African Financials issuer pages are used instead |
| IFC and DFC project pages | Not found |
| ZESCO, RDA and ZCCM-IH procurement | Not found. ZPPA e-GP covers part of it |
| Ministry of Finance budget | Not found. Parliament and State House cover part of it |
| ZDA licences and MFEZ tenants | Only the ZDA conference project pages found |
| Job postings | Not found |
| Zambia Monitor, Mining Review Africa, Zambia Daily Mail feeds | The search budget ended before these searches |
| Paid sources | Wood Mackenzie, PitchBook, African Energy database and Mining Data Online appeared in results. No licence |
| DRC side of the corridor | Out of scope for v1. Not researched |
| District centre coordinates | The search budget ended. 36 sites have geometry: null |

Two of the nine early signal source types have no source: mining_cadastre and job_postings. Both are in known_gaps. The other seven types have at least one source in sources.early_signal.

## 5. Follow-up work

1. Confirm each source on the first collector run. Record the result in docs/decisions.md.
2. Get the RSS feed URL of each news site from its home page (link rel="alternate"). Replace the web entry if a feed exists.
3. Look up district centre coordinates on Wikidata for the 36 sites that have no geometry.
4. Search again for the Mining Cadastre portal, ZESCO and RDA tenders, SEDAR+ issuer pages, IFC and DFC project pages, and careers pages of the watched operators and contractors.
5. Confirm the unconfirmed items in section 2.2.

## 6. Rows for docs/decisions.md

| Date | Decision | Reason | Document |
|---|---|---|---|
| 2026-09-26 | Brief v1 was built from public research with WebSearch | The Argo files and config/monitoring-brief/v1.yaml were not in the repository or on the host | 04, v1.yaml |
| 2026-09-26 | Items that the research could not find are known gaps or null fields. No value was guessed | The session web search budget ended after about 55 searches | v1.yaml |
| 2026-09-26 | All sources other than Google News use licence code verify_then_purge. The collector confirms reachability and terms on its first run | The build environment blocks direct fetches, so no page or terms of use were read | 04, v1.yaml |
| 2026-09-26 | Where no feed URL was found, a source uses the root or a section of a domain from a result. The verification text marks it as derived | Search results gave article URLs but not feed URLs | v1.yaml |
| 2026-09-26 | Site coordinates come only from Wikipedia or Wikidata values in search results. Mindat is not used. 36 of 57 sites have geometry null | docs/03 forbids invented coordinates. The search budget ended before the district centre lookups | 03, v1.yaml |
| 2026-09-26 | status_hint "producing" means "in operation" for power, industrial, transport, border and fuel_supply sites | The status list comes from mines | v1.yaml |
| 2026-09-26 | Site entries can have two optional fields: corridor and note | Corridors link border and transport sites to geography codes. Notes show what the research did not confirm | v1.yaml |
| 2026-09-26 | Early signal sources can have an extra source type market_regulator (ERB, Ministry of Energy) | ERB price decisions are Tier 0 market demand drivers but are not one of the nine early signal types | 04, v1.yaml |
| 2026-09-26 | The google_news_only list is a conservative default of e-paper, subscription and paywalled domains | Direct access was not tested | 04, v1.yaml |
| 2026-09-26 | Activity type codes use the format theme__keyword_slug. A spelling variant gets a numeric suffix | Each keyword needs a unique code | 05, activity-types.yaml |
| 2026-09-26 | fuel_shortage and pipeline_outage have direction demand_up. border_delay and erb_price_change have direction demand_down | A shortage or outage makes customers need another supply. Delays and price rises reduce consumption. Tier rules treat all four as market demand drivers | 05, v1.yaml |
| 2026-09-26 | Geography codes include zw, bw, mw, na, corr_chirundu_beitbridge and corr_trans_caprivi | The watched border posts connect to these countries and corridors | 05, geographies.yaml |
| 2026-09-26 | The province parents of Chirundu and Shibuyunji districts need confirmation | Research did not confirm them | geographies.yaml |
| 2026-09-26 | external_ids are empty for all organisations | Research found no PACRA, LEI, ISIN or SEDAR numbers | v1.yaml |
| 2026-09-26 | The two proposed sources are Copperbelt Katanga Mining and the Logistics Cluster Zambia fuel assessment | They cover the DRC side of the corridor and fuel supply infrastructure | 04, v1.yaml |
