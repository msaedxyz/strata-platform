// Site watch list: the sites of the active brief on the daily and weekly lists, with the status, the pending status,
// the operator and the last signal (GET /api/sites). Live.
import { type Column, DataTable, Tabs } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useMemo, useState } from "react";
import type { Site } from "../api/types";
import { moduleConfig } from "../config/modules";
import { useResource } from "../data/resource";
import { useApi, useTaxonomy } from "./common/api";
import { useDetailDrawer } from "./common/drawers";
import { formatDateTime, humanise, nameOf } from "./common/format";
import { FactValue, ModuleRoot, resourceState, SiteStatus } from "./common/ui";

const cfg = moduleConfig["site-watch-list"];

export function SiteWatchListModule(_: PanelProps) {
  const { reads } = useApi();
  const tax = useTaxonomy();
  const { openSite } = useDetailDrawer();
  const [tab, setTab] = useState<"daily" | "weekly">("daily");
  const r = useResource<{ items: Site[] }>("sites:all", () => reads.sites({ watch: "all" }), { live: cfg.live.events, batchMs: cfg.live.batchMs });
  const all = useMemo(() => r.data?.items ?? [], [r.data]);
  const rows = useMemo(() => all.filter((x) => x.watch === tab), [all, tab]);
  const geo = (c: string | null) => nameOf(tax.data?.geographies, c);

  const columns: Column<Site>[] = useMemo(
    () => [
      { id: "name", header: "Site", value: (x) => x.name, width: 200 },
      { id: "class", header: "Class", value: (x) => nameOf(tax.data?.site_classes, x.site_class) },
      {
        id: "status",
        header: "Status",
        value: (x) => `${x.status ?? ""} ${x.status_pending ?? ""}`,
        cell: (x) => <SiteStatus status={x.status} pending={x.status_pending} />,
        width: 220,
      },
      {
        id: "operator",
        header: "Operator",
        value: (x) => x.operator_name ?? "",
        cell: (x) => {
          const attr = x.attributes?.operator ?? x.attributes?.operates;
          return x.operator_name ? (
            <FactValue ids={attr?.evidence_ids} label={`Operator of ${x.name}`}>
              {x.operator_name}
            </FactValue>
          ) : (
            ""
          );
        },
      },
      { id: "province", header: "Province", value: (x) => geo(x.province) },
      { id: "last", header: "Last signal", value: (x) => x.last_signal_at ?? "", cell: (x) => formatDateTime(x.last_signal_at) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tax.data],
  );

  const s = resourceState(r, { label: "sites", empty: all.length === 0, emptyTitle: "No watched sites", emptyDescription: "The active brief has no daily or weekly watch list." });
  const count = (w: string) => all.filter((x) => x.watch === w).length;
  return (
    <ModuleRoot id="site-watch-list" state={s.state}>
      {s.node ?? (
        <Tabs
          label="Watch list"
          className="strata-tabs"
          value={tab}
          onChange={(id) => setTab(id as "daily" | "weekly")}
          items={(["daily", "weekly"] as const).map((w) => ({
            id: w,
            label: humanise(w),
            count: count(w),
            content:
              w === tab ? (
                <DataTable
                  label={`${humanise(tab)} watch list`}
                  columns={columns}
                  rows={rows}
                  getRowId={(x) => x.id}
                  onRowClick={(x) => openSite(x.id)}
                  virtualize={rows.length > cfg.virtualizeAbove}
                  emptyTitle="No sites on this list"
                />
              ) : null,
          }))}
        />
      )}
    </ModuleRoot>
  );
}
