// Priority list: opportunities ranked by lead time, demand estimate, confidence and buyer fit (GET /api/priority).
// A row opens the breakdown of the score. Live.
import { Badge, BarChart, type BarDatum, Button, type Column, DataTable, Drawer } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useMemo, useState } from "react";
import type { PriorityBreakdown, PriorityItem } from "../api/types";
import { moduleConfig } from "../config/modules";
import { useResource } from "../data/resource";
import { useApi, useStages } from "./common/api";
import { useDetailDrawer } from "./common/drawers";
import { formatLeadTime, formatNumber, formatPercent, humanise, nameOf } from "./common/format";
import { KeyValues } from "./common/KeyValues";
import { useSelection } from "./common/selection";
import { DealStageText, FactValue, ModuleRoot, resourceState, SectionHeading } from "./common/ui";

const cfg = moduleConfig["priority-list"];

/** Names of the parts of the score (docs/05 scorer rules 5 and 6). Other parts show their key in words. */
const PART_NAMES: Record<string, string> = {
  lead_time: "Lead time",
  demand: "Demand estimate",
  confidence: "Confidence",
  buyer_fit: "Buyer fit",
  no_contact_boost: "No contact found",
};

/** The parts of priority_breakdown (services/projections/priority.py) in the order of `parts`, as bars of the
 * contribution of each part to the score. */
export function breakdownBars(b: PriorityBreakdown | null | undefined): BarDatum[] {
  if (!b) return [];
  const out: BarDatum[] = [];
  for (const k of b.parts) {
    const part = (b as unknown as Record<string, { contribution?: unknown } | undefined>)[k];
    if (!part || typeof part.contribution !== "number") continue;
    out.push({ label: PART_NAMES[k] ?? humanise(k), value: part.contribution, tone: part.contribution < 0 ? "negative" : "accent" });
  }
  return out;
}

/** The evidence ids of a part of the breakdown (docs/07 rule 1). */
const partIds = (b: PriorityBreakdown | null | undefined, k: "lead_time" | "demand" | "confidence" | "buyer_fit" | "no_contact_boost") => b?.[k]?.evidence_ids ?? [];

export function PriorityListModule(_: PanelProps) {
  const { reads } = useApi();
  const stages = useStages();
  const { select } = useSelection();
  const { openDeal } = useDetailDrawer();
  const [open, setOpen] = useState<PriorityItem | null>(null);
  const r = useResource<{ items: PriorityItem[] }>(`priority:${cfg.limit}`, () => reads.priority(cfg.limit), { live: cfg.live.events, batchMs: cfg.live.batchMs });
  // The API ranks the list: by group, then the "no contact found" rule, then the score (docs/05 scorer rules 5 and 6).
  const rows = useMemo(() => r.data?.items ?? [], [r.data]);
  const stageName = (c: string) => nameOf(stages.data?.deal_stages, c);

  const columns: Column<PriorityItem>[] = useMemo(
    () => [
      { id: "rank", header: "Rank", value: (x) => x.rank, numeric: true, width: 56 },
      { id: "group", header: "Group", value: (x) => x.priority_breakdown?.group.name ?? "", cell: (x) => `${x.priority_breakdown?.group.name ?? ""} (${x.group_rank})` },
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
      {
        id: "stage",
        header: "Stage",
        value: (x) => stageName(x.stage),
        cell: (x) => (
          <FactValue ids={x.stage_evidence_ids} label={`Stage of ${x.title}`}>
            <DealStageText stage={x.stage} pending={x.stage_pending} names={stageName} />
          </FactValue>
        ),
      },
      {
        id: "lead",
        header: "Lead time",
        value: (x) => x.lead_time_days,
        cell: (x) => (
          <FactValue ids={partIds(x.priority_breakdown, "lead_time")} label="Lead time">
            {formatLeadTime(x.lead_time_days)}
          </FactValue>
        ),
        numeric: true,
      },
      {
        id: "demand",
        header: "Demand l/month (est.)",
        value: (x) => x.demand_litres_month,
        cell: (x) => (
          <FactValue ids={partIds(x.priority_breakdown, "demand")} label="Demand estimate">
            {formatNumber(x.demand_litres_month)}
          </FactValue>
        ),
        numeric: true,
      },
      {
        id: "confidence",
        header: "Confidence",
        value: (x) => x.confidence,
        cell: (x) => (
          <FactValue ids={partIds(x.priority_breakdown, "confidence")} label="Confidence">
            {formatPercent(x.confidence)}
          </FactValue>
        ),
        numeric: true,
      },
      {
        id: "fit",
        header: "Buyer fit",
        value: (x) => x.buyer_fit,
        cell: (x) => (
          <FactValue ids={partIds(x.priority_breakdown, "buyer_fit")} label="Buyer fit">
            {formatPercent(x.buyer_fit)}
          </FactValue>
        ),
        numeric: true,
      },
      { id: "contact", header: "Contact", value: (x) => (x.has_contact ? "yes" : "no"), cell: (x) => (x.has_contact ? "Found" : <Badge tone={x.no_contact_rule ? "warning" : "neutral"}>No contact found</Badge>) },
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
                {
                  id: "lead",
                  label: "Lead time",
                  value: (
                    <FactValue ids={partIds(open.priority_breakdown, "lead_time")} label="Lead time">
                      {formatLeadTime(open.lead_time_days) || "No forecast"}
                    </FactValue>
                  ),
                },
                {
                  id: "demand",
                  label: "Demand estimate",
                  value: (
                    <FactValue ids={partIds(open.priority_breakdown, "demand")} label="Demand estimate">
                      {open.demand_litres_month === null ? "No estimate" : `${formatNumber(open.demand_litres_month)} litres a month, estimate`}
                    </FactValue>
                  ),
                },
                {
                  id: "confidence",
                  label: "Confidence",
                  value: (
                    <FactValue ids={partIds(open.priority_breakdown, "confidence")} label="Confidence">
                      {`${formatPercent(open.confidence)}${open.priority_breakdown ? ` (${humanise(String(open.priority_breakdown.confidence.value ?? "unknown"))})` : ""}`}
                    </FactValue>
                  ),
                },
                {
                  id: "fit",
                  label: "Buyer fit",
                  value: (
                    <FactValue ids={partIds(open.priority_breakdown, "buyer_fit")} label="Buyer fit">
                      {`${formatPercent(open.buyer_fit)}${open.priority_breakdown ? ` (${humanise(String(open.priority_breakdown.buyer_fit.value ?? "unknown").replace(/^buyer_role_/, ""))})` : ""}`}
                    </FactValue>
                  ),
                },
                { id: "contact", label: "Contact found", value: open.has_contact || open.priority_breakdown?.no_contact_boost.contact_found ? "Yes" : "No" },
                {
                  id: "rule",
                  label: "Engagement window, no contact",
                  value: (
                    <FactValue ids={partIds(open.priority_breakdown, "no_contact_boost")} label="Engagement window">
                      {open.no_contact_rule ? "Yes: first in its group" : open.priority_breakdown?.no_contact_boost.in_engagement_window ? "In the window, contact found" : "Not in the window"}
                    </FactValue>
                  ),
                },
                { id: "group", label: "Group", value: `${open.priority_breakdown?.group.name ?? ""}, rank ${open.group_rank}` },
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
