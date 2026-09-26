// Demand drivers: market events that change diesel demand for all customers (GET /api/demand-drivers). Live.
import { type BadgeTone, FeedItem, Sparkline } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useMemo } from "react";
import type { DemandDriver } from "../api/types";
import { moduleConfig } from "../config/modules";
import { useResource } from "../data/resource";
import { evidenceIds, useApi, useTaxonomy } from "./common/api";
import { certaintyStatus, formatDateTime, humanise, nameOf } from "./common/format";
import { ModuleRoot, resourceState } from "./common/ui";

const cfg = moduleConfig["demand-drivers"];

const DIRECTION: Record<string, { label: string; tone: BadgeTone }> = {
  demand_up: { label: "Demand up", tone: "positive" },
  demand_down: { label: "Demand down", tone: "negative" },
  procurement: { label: "Procurement", tone: "accent" },
  project_pipeline: { label: "Pipeline", tone: "neutral" },
};

/** Drivers for each of the last 12 weeks, oldest first. */
function weeklyCounts(items: DemandDriver[], weeks = 12, now = Date.now()): number[] {
  const week = 7 * 24 * 3600 * 1000;
  const counts = new Array<number>(weeks).fill(0);
  for (const d of items) {
    const t = Date.parse(d.observed_at ?? d.recorded_at);
    const i = Math.floor((now - t) / week);
    if (i >= 0 && i < weeks) counts[weeks - 1 - i]! += 1;
  }
  return counts;
}

export function DemandDriversModule(_: PanelProps) {
  const { reads } = useApi();
  const tax = useTaxonomy();
  const r = useResource<{ items: DemandDriver[] }>(`demand-drivers:${cfg.limit}`, () => reads.demandDrivers(cfg.limit), {
    live: cfg.live.events,
    batchMs: cfg.live.batchMs,
  });
  const items = useMemo(() => r.data?.items ?? [], [r.data]);
  const trend = useMemo(() => weeklyCounts(items), [items]);
  const s = resourceState(r, { label: "demand drivers", empty: items.length === 0, emptyTitle: "No demand drivers", emptyDescription: "Fuel shortages, pipeline outages, border delays and ERB changes show here." });
  return (
    <ModuleRoot id="demand-drivers" state={s.state}>
      {s.node ?? (
        <>
          <div className="strata-module__toolbar">
            <span className="strata-muted">Drivers per week, last 12 weeks</span>
            <Sparkline values={trend} label="Demand drivers per week, last 12 weeks" />
          </div>
          <div className="strata-module__fill" role="feed" aria-label="Demand drivers" aria-busy={r.refreshing || undefined}>
            {items.map((d) => {
              const dir = DIRECTION[d.direction] ?? { label: humanise(d.direction), tone: "neutral" as BadgeTone };
              return (
                <FeedItem
                  key={d.event_id}
                  data-driver-id={d.event_id}
                  title={d.title}
                  source={d.publisher ?? undefined}
                  time={formatDateTime(d.observed_at ?? d.recorded_at)}
                  dateTime={d.observed_at ?? d.recorded_at}
                  tier={dir}
                  status={certaintyStatus(d.certainty)}
                  evidenceIds={evidenceIds(d.evidence_ids) ?? undefined}
                  tags={[humanise(d.driver_type), ...d.geography.map((g) => nameOf(tax.data?.geographies, g))]}
                />
              );
            })}
          </div>
        </>
      )}
    </ModuleRoot>
  );
}
