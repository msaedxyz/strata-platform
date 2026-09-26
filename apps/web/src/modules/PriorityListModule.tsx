// Priority list: opportunities ranked by lead time, demand estimate, confidence and buyer fit (GET /api/priority).
// A row opens the breakdown of the score. Live.
import { Badge, BarChart, type BarDatum, Button, type Column, DataTable, Drawer } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useMemo, useState } from "react";
import type { PriorityItem } from "../api/types";
import { moduleConfig } from "../config/modules";
import { useResource } from "../data/resource";
import { useApi, useStages } from "./common/api";
import { useDetailDrawer } from "./common/drawers";
import { formatLeadTime, formatNumber, formatPercent, humanise, nameOf } from "./common/format";
import { KeyValues } from "./common/KeyValues";
import { useSelection } from "./common/selection";
import { DealStageText, FactValue, ModuleRoot, resourceState, SectionHeading } from "./common/ui";

const cfg = moduleConfig["priority-list"];

/** Names of the parts of the score (docs/05 scorer rule 5). Other parts show their key in words. */
const PART_NAMES: Record<string, string> = {
  lead_time: "Lead time",
  demand: "Demand estimate",
  demand_estimate: "Demand estimate",
  confidence: "Confidence",
  buyer_fit: "Buyer fit",
  no_contact: "No contact found",
  no_contact_boost: "No contact found",
  engagement_window: "Engagement window",
};

/** The parts of priority_breakdown as bars. A part is a number or an object with score (or value) and weight. */
export function breakdownBars(b: Record<string, unknown> | null | undefined): BarDatum[] {
  if (!b) return [];
  const out: BarDatum[] = [];
  for (const [k, v] of Object.entries(b)) {
    let score: number | undefined;
    if (typeof v === "number") score = v;
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const x = o.contribution ?? o.score ?? o.value;
      if (typeof x === "number") score = x;
    }
    if (score === undefined || k === "total") continue;
    out.push({ label: PART_NAMES[k] ?? humanise(k), value: score, tone: score < 0 ? "negative" : "accent" });
  }
  return out;
}

export function PriorityListModule(_: PanelProps) {
  const { reads } = useApi();
  const stages = useStages();
  const { select } = useSelection();
  const { openDeal } = useDetailDrawer();
  const [open, setOpen] = useState<PriorityItem | null>(null);
  const r = useResource<{ items: PriorityItem[] }>(`priority:${cfg.limit}`, () => reads.priority(cfg.limit), { live: cfg.live.events, batchMs: cfg.live.batchMs });
  const rows = useMemo(() => (r.data?.items ?? []).map((x, i) => ({ ...x, rank: i + 1 })), [r.data]);
  const stageName = (c: string) => nameOf(stages.data?.deal_stages, c);

  const columns: Column<PriorityItem & { rank: number }>[] = useMemo(
    () => [
      { id: "rank", header: "Rank", value: (x) => x.rank, numeric: true, width: 56 },
      {
        id: "title",
        header: "Opportunity",
        value: (x) => x.title,
        cell: (x) => (
          <FactValue ids={x.evidence_ids} label={x.title}>
            {x.title}
          </FactValue>
        ),
        width: 260,
      },
      { id: "site", header: "Site", value: (x) => x.site_name ?? "" },
      { id: "stage", header: "Stage", value: (x) => stageName(x.stage), cell: (x) => <DealStageText stage={x.stage} pending={x.stage_pending} names={stageName} /> },
      { id: "lead", header: "Lead time", value: (x) => x.lead_time_days, cell: (x) => formatLeadTime(x.lead_time_days), numeric: true },
      { id: "demand", header: "Demand l/month (est.)", value: (x) => x.demand_litres_month, cell: (x) => formatNumber(x.demand_litres_month), numeric: true },
      { id: "confidence", header: "Confidence", value: (x) => x.confidence, cell: (x) => formatPercent(x.confidence), numeric: true },
      { id: "fit", header: "Buyer fit", value: (x) => x.buyer_fit, cell: (x) => formatPercent(x.buyer_fit), numeric: true },
      { id: "contact", header: "Contact", value: (x) => (x.has_contact ? "yes" : "no"), cell: (x) => (x.has_contact ? "Found" : <Badge tone="warning">No contact found</Badge>) },
      { id: "score", header: "Score", value: (x) => x.priority_score, cell: (x) => (x.priority_score === null ? "" : x.priority_score.toFixed(2)), numeric: true },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stages.data],
  );

  const s = resourceState(r, { label: "priority list", empty: rows.length === 0, emptyTitle: "No open opportunities" });
  const bars = breakdownBars(open?.priority_breakdown);
  return (
    <ModuleRoot id="priority-list" state={s.state}>
      {s.node ?? (
        <DataTable
          label="Opportunities by priority"
          columns={columns}
          rows={rows}
          getRowId={(x) => x.id}
          selectedRowId={open?.id}
          onRowClick={(x) => {
            setOpen(x);
            select({ kind: "deal", id: x.id, label: x.title });
          }}
          virtualize={rows.length > cfg.virtualizeAbove}
        />
      )}
      <Drawer open={open !== null} onClose={() => setOpen(null)} title="Priority breakdown">
        {open && (
          <div className="strata-stack" data-breakdown-for={open.id}>
            <h3 className="strata-drawer-title">
              <FactValue ids={open.evidence_ids} label={open.title}>
                {open.title}
              </FactValue>
            </h3>
            <KeyValues
              label="Score inputs"
              rows={[
                { id: "lead", label: "Lead time", value: formatLeadTime(open.lead_time_days) || "No forecast" },
                { id: "demand", label: "Demand estimate", value: open.demand_litres_month === null ? "No estimate" : `${formatNumber(open.demand_litres_month)} litres a month, estimate` },
                { id: "confidence", label: "Confidence", value: formatPercent(open.confidence) },
                { id: "fit", label: "Buyer fit", value: formatPercent(open.buyer_fit) },
                { id: "contact", label: "Contact found", value: open.has_contact ? "Yes" : "No" },
                { id: "score", label: "Priority score", value: open.priority_score?.toFixed(2) ?? "" },
              ]}
            />
            <SectionHeading>Breakdown</SectionHeading>
            <BarChart label="Priority score breakdown" data={bars} format={(v) => v.toFixed(2)} />
            <div>
              <Button
                size="sm"
                onClick={() => {
                  setOpen(null);
                  openDeal(open.id);
                }}
              >
                Open opportunity
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </ModuleRoot>
  );
}
