// Signal feed: all in scope items with filters by sector, geography and tier (GET /api/signals and GET /api/config/taxonomy).
// The list renders only the items in view and loads the next page near the end. Live: a new signal goes to the top.
import { FeedItem, SearchInput, Select, type SelectOption, VirtualList } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Signal, SignalsResponse, Taxonomy } from "../api/types";
import { moduleConfig } from "../config/modules";
import { useLiveEvents } from "../live/LiveProvider";
import { evidenceIds, useApi, useTaxonomy } from "./common/api";
import { useDetailDrawer } from "./common/drawers";
import { certaintyStatus, formatDateTime, formatNumber, nameOf, tierBadge } from "./common/format";
import { ModuleRoot, type ModuleState } from "./common/ui";

const cfg = moduleConfig["signal-feed"];

interface Filters {
  tier: string;
  sector: string;
  geography: string;
  q: string;
}

interface FeedState {
  items: Signal[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | undefined;
  /** Ids that came by a live update. They show the change highlight once. */
  fresh: ReadonlySet<string>;
}

const EMPTY: FeedState = { items: [], total: 0, loading: true, loadingMore: false, error: undefined, fresh: new Set() };

function queryOf(f: Filters, limit: number, offset: number) {
  return {
    tier: f.tier ? [Number(f.tier)] : undefined,
    sector: f.sector ? [f.sector] : undefined,
    geography: f.geography ? [f.geography] : undefined,
    q: f.q || undefined,
    limit,
    offset,
  };
}

/** The pages of the feed for one set of filters. */
function useSignalPages(filters: Filters) {
  const { reads } = useApi();
  const [state, setState] = useState<FeedState>(EMPTY);
  const gen = useRef(0);
  const busy = useRef(false);
  const latest = useRef(state);
  latest.current = state;

  const loadFirst = useCallback(() => {
    const g = ++gen.current;
    busy.current = true;
    setState((s) => ({ ...s, loading: s.items.length === 0, error: undefined }));
    reads
      .signals(queryOf(filters, cfg.pageSize, 0))
      .then((res: SignalsResponse) => {
        if (g !== gen.current) return;
        setState({ items: res.items, total: res.total, loading: false, loadingMore: false, error: undefined, fresh: new Set() });
      })
      .catch((err: unknown) => {
        if (g !== gen.current) return;
        setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : "The signals did not load." }));
      })
      .finally(() => {
        if (g === gen.current) busy.current = false;
      });
  }, [reads, filters]);

  useEffect(() => {
    setState(EMPTY);
    loadFirst();
  }, [loadFirst]);

  const loadMore = useCallback(() => {
    const cur = latest.current;
    if (busy.current || cur.items.length === 0 || cur.items.length >= cur.total) return;
    const g = gen.current;
    const offset = cur.items.length;
    busy.current = true;
    setState((s) => ({ ...s, loadingMore: true }));
    reads
      .signals(queryOf(filters, cfg.pageSize, offset))
      .then((res) => {
        if (g !== gen.current) return;
        setState((s) => {
          const seen = new Set(s.items.map((x) => x.id));
          return { ...s, items: [...s.items, ...res.items.filter((x) => !seen.has(x.id))], total: res.total, loadingMore: false };
        });
      })
      .catch(() => g === gen.current && setState((s) => ({ ...s, loadingMore: false })))
      .finally(() => {
        if (g === gen.current) busy.current = false;
      });
  }, [reads, filters]);

  // Live: read the newest signals once for each batch of events and add the new ones at the top.
  useLiveEvents(
    cfg.live.events,
    () => {
      const g = gen.current;
      reads
        .signals(queryOf(filters, cfg.livePatchSize, 0))
        .then((res) => {
          if (g !== gen.current) return;
          setState((s) => {
            const seen = new Set(s.items.map((x) => x.id));
            const added = res.items.filter((x) => !seen.has(x.id));
            if (added.length === 0) return { ...s, total: res.total };
            return { ...s, items: [...added, ...s.items], total: res.total, fresh: new Set(added.map((x) => x.id)) };
          });
        })
        .catch(() => undefined);
    },
    cfg.live.batchMs,
  );

  return { state, loadMore, reload: loadFirst };
}

function options(list: { code: string; name: string }[] | undefined, all: string): SelectOption[] {
  return [{ value: "", label: all }, ...(list ?? []).map((x) => ({ value: x.code, label: x.name }))];
}

function geographyOptions(tax: Taxonomy | undefined): SelectOption[] {
  const order = { country: 0, corridor: 1, province: 2, district: 3 } as const;
  const list = [...(tax?.geographies ?? [])].sort((a, b) => order[a.level] - order[b.level] || a.name.localeCompare(b.name));
  return [{ value: "", label: "All geographies" }, ...list.map((g) => ({ value: g.code, label: g.name }))];
}

const SignalRow = memo(function SignalRow({ s, fresh, tax, onOpen }: { s: Signal; fresh: boolean; tax: Taxonomy | undefined; onOpen: (s: Signal) => void }) {
  const summary = s.summary?.[0]?.text;
  const tags = [
    ...s.sectors.map((c) => nameOf(tax?.sectors, c)),
    ...s.geographies.slice(0, 3).map((c) => nameOf(tax?.geographies, c)),
    ...(s.read_at_source ? ["Read at source"] : []),
  ];
  return (
    <FeedItem
      data-signal-id={s.id}
      title={s.title}
      source={s.publisher ?? undefined}
      time={formatDateTime(s.published_at ?? s.recorded_at)}
      dateTime={s.published_at ?? s.recorded_at}
      tier={tierBadge(s.tier)}
      status={certaintyStatus(s.certainty)}
      summary={summary ?? undefined}
      tags={tags}
      evidenceIds={evidenceIds(s.evidence_ids) ?? undefined}
      fresh={fresh}
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a")) return;
        onOpen(s);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onOpen(s);
      }}
    />
  );
});

export function SignalFeedModule(_: PanelProps) {
  const tax = useTaxonomy();
  const { openSignal } = useDetailDrawer();
  const [filters, setFilters] = useState<Filters>({ tier: "", sector: "", geography: "", q: "" });
  const [text, setText] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === text ? f : { ...f, q: text })), cfg.searchDebounceMs);
    return () => clearTimeout(t);
  }, [text]);
  const { state, loadMore, reload } = useSignalPages(filters);
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  const tierOptions = useMemo<SelectOption[]>(() => [{ value: "", label: "All tiers" }, { value: "0", label: "Tier 0" }, { value: "1", label: "Tier 1" }, { value: "2", label: "Tier 2" }], []);
  const sectorOptions = useMemo(() => options(tax.data?.sectors, "All sectors"), [tax.data]);
  const geoOptions = useMemo(() => geographyOptions(tax.data), [tax.data]);
  const renderItem = useCallback((s: Signal) => <SignalRow s={s} fresh={state.fresh.has(s.id)} tax={tax.data} onOpen={openSignal} />, [state.fresh, tax.data, openSignal]);

  const moduleState: ModuleState = state.error ? "error" : state.loading ? "loading" : state.items.length === 0 ? "empty" : "ready";
  const filtered = !!(filters.tier || filters.sector || filters.geography || filters.q);
  return (
    <ModuleRoot id="signal-feed" state={moduleState}>
      <div className="strata-module__toolbar" role="search" aria-label="Signal filters">
        <Select label="Tier" hideLabel value={filters.tier} onChange={set("tier")} options={tierOptions} />
        <Select label="Sector" hideLabel value={filters.sector} onChange={set("sector")} options={sectorOptions} />
        <Select label="Geography" hideLabel value={filters.geography} onChange={set("geography")} options={geoOptions} />
        <SearchInput label="Search signals" placeholder="Search titles" value={text} onChange={(e) => setText(e.target.value)} onClear={() => setText("")} />
        <span className="strata-muted strata-num" aria-live="polite" data-signal-total={state.total}>
          {`${formatNumber(state.items.length)} of ${formatNumber(state.total)}`}
        </span>
      </div>
      <div className="strata-module__fill">
        <VirtualList
          items={state.items}
          getKey={(s) => s.id}
          renderItem={renderItem}
          label="Signals"
          estimateSize={cfg.estimateItemPx}
          onEndReached={loadMore}
          loading={state.loading}
          loadingMore={state.loadingMore}
          error={state.error}
          onRetry={reload}
          emptyTitle={filtered ? "No signal matches the filters" : "No signals yet"}
        />
      </div>
    </ModuleRoot>
  );
}
