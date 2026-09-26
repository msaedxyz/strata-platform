// Ticker strip: the latest Tier 0 and Tier 1 signals and the counts by tier (GET /api/ticker). Live.
import { type TickerCount, type TickerItem, TickerStrip } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useMemo } from "react";
import type { TickerResponse } from "../api/types";
import { appConfig } from "../config/app.config";
import { moduleConfig } from "../config/modules";
import { useResource } from "../data/resource";
import { useApi } from "./common/api";
import { useDetailDrawer } from "./common/drawers";
import { formatTime, tierBadge } from "./common/format";
import { ModuleRoot } from "./common/ui";

const cfg = moduleConfig.ticker;

export function useTicker() {
  const { reads } = useApi();
  return useResource<TickerResponse>(`ticker:${cfg.limit}`, () => reads.ticker(cfg.limit), { live: cfg.live.events, batchMs: cfg.live.batchMs });
}

/** The ticker strip. The shell shows it in its ticker slot, and the Monitoring workspace can show it as a panel. */
export function TickerContent({ label = "Latest Tier 0 and Tier 1 signals" }: { label?: string }) {
  const r = useTicker();
  const { openSignal } = useDetailDrawer();
  const items: TickerItem[] = useMemo(
    () =>
      (r.data?.items ?? []).map((s) => ({
        id: s.id,
        text: s.title,
        tag: tierBadge(s.tier).label,
        tone: tierBadge(s.tier).tone,
        time: formatTime(s.published_at ?? s.recorded_at),
        onSelect: () => openSignal(s),
      })),
    [r.data, openSignal],
  );
  const counts: TickerCount[] = useMemo(
    () => (r.data?.counts ?? []).map((c) => ({ label: `${tierBadge(c.tier).label} 24h`, value: c.day, tone: tierBadge(c.tier).tone })),
    [r.data],
  );
  return (
    <TickerStrip
      items={items}
      counts={counts}
      speed={appConfig.ticker.speedPxPerSecond}
      loading={r.loading}
      error={r.error}
      emptyText="No Tier 0 or Tier 1 signals yet"
      label={label}
    />
  );
}

export function TickerModule(_: PanelProps) {
  const r = useTicker();
  const state = r.error ? "error" : r.loading ? "loading" : r.data && r.data.items.length === 0 ? "empty" : "ready";
  return (
    <ModuleRoot id="ticker" state={state}>
      <TickerContent label="Latest signals" />
    </ModuleRoot>
  );
}
