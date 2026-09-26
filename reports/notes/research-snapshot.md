# Research snapshot: notes

## Summary

1. The snapshot is in data/snapshots/2026-09-26/items.jsonl. It has 146 real, distinct items. Each item has a title, URL, publisher, date and search query.
2. The target was 250 items. The session web search budget (200 calls) ended after this agent ran 35 searches. We did not add any item that a search did not show.
3. Topics: mines 52, transport 32, fuel 24, power 24, procurement 14. Agriculture and industry has no items.
4. 57 items have a date (54 from the URL, 3 from the result). 89 items have no date.
5. Most dated items are from March to September 2026. September 2026 has 14 items.
6. Important early signals in the snapshot: the KCM tailings plant EPC award to Nerin (September 2026), the Mingomba ground breaking (May 2026), the Kitumba trial production, the Luanshya restart, the Lumwana expansion, the Maamba solar commissioning, the Chirundu and Nakonde border upgrades, the TAZARA concession and the TAZAMA open access changes.
7. Next step: run a second collection when the search budget allows. Cover agriculture and industry, exploration licences, ZEMA assessments, feasibility studies, Nchanga, Enterprise, Kalengwa and Kalumbila.

## Rows for docs/decisions.md

| Date | Decision | Reason | Document |
|---|---|---|---|
| 2026-09-26 | Use a research snapshot of real items, collected with WebSearch, to fill the dashboard until the collectors can reach the sources | Direct fetch to news sites and Google News is blocked in the build environment | 04, data/snapshots/2026-09-26/README.md |
| 2026-09-26 | Snapshot items have title, URL, publisher, date and search query only. They use the licence link_only | This matches the Google News item. No article text was read | 04 |
| 2026-09-26 | Keep published_at null when no date shows in the URL or the result. Allow "YYYY-MM" when only the month is known | Do not guess a date. Lead time calculations need true dates | 04, 05 |
| 2026-09-26 | The snapshot has 146 items, not 250 | The session web search budget ended after 35 searches. No item was invented | data/snapshots/2026-09-26/README.md |
| 2026-09-26 | Agriculture and industry is a known gap in the snapshot | The search budget ended before these searches | 04, data/snapshots/2026-09-26/README.md |
| 2026-09-26 | The topic field is a label from the search query group, not a fact from the source | Rule 1 needs facts to link to a source span. The topic is not a canonical fact | 03, data/snapshots/2026-09-26/README.md |
