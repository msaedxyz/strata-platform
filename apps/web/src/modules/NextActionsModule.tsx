// Next actions: the next action of each opportunity, by due date (the next_action of GET /api/deals). Live.
// A row selects the opportunity, so the relationship panel shows it.
import { Badge, type Column, DataTable, DatePicker } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useMemo, useState } from "react";
import type { Deal, NextAction } from "../api/types";
import { moduleConfig } from "../config/modules";
import { useStages } from "./common/api";
import { formatDate, nameOf, todayIso } from "./common/format";
import { useSelection } from "./common/selection";
import { DealStageText, ModuleRoot, resourceState } from "./common/ui";
import { useDeals } from "./KanbanModule";

const cfg = moduleConfig["next-actions"];
type Row = Deal & { next_action: NextAction };

export function NextActionsModule(_: PanelProps) {
  const deals = useDeals();
  const stages = useStages();
  const { select, deal: selected } = useSelection();
  const [dueBy, setDueBy] = useState("");
  const today = todayIso();
  const all = useMemo(() => (deals.data?.items ?? []).filter((d): d is Row => !!d.next_action), [deals.data]);
  const rows = useMemo(() => (dueBy ? all.filter((d) => d.next_action.due_date <= dueBy) : all), [all, dueBy]);
  const stageName = (c: string) => nameOf(stages.data?.deal_stages, c);

  const columns: Column<Row>[] = useMemo(
    () => [
      {
        id: "due",
        header: "Due",
        value: (d) => d.next_action.due_date,
        cell: (d) => (
          <span className="strata-inline">
            <span className="strata-num">{formatDate(d.next_action.due_date)}</span>
            {d.next_action.due_date < today && <Badge tone="negative">Overdue</Badge>}
          </span>
        ),
        width: 170,
      },
      { id: "action", header: "Action", value: (d) => d.next_action.action, width: 220 },
      { id: "deal", header: "Opportunity", value: (d) => d.title },
      { id: "owner", header: "Owner", value: (d) => d.next_action.owner_user_id },
      { id: "stage", header: "Stage", value: (d) => stageName(d.stage), cell: (d) => <DealStageText stage={d.stage} pending={d.stage_pending} names={stageName} /> },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stages.data, today],
  );

  const s = resourceState(deals, { label: "next actions", empty: all.length === 0, emptyTitle: "No next actions", emptyDescription: "Set a next action in the relationship panel." });
  return (
    <ModuleRoot id="next-actions" state={s.state}>
      {s.node ?? (
        <>
          <div className="strata-module__toolbar">
            <DatePicker label="Due by" value={dueBy} onChange={setDueBy} />
          </div>
          <div className="strata-module__fill">
            <DataTable
              label="Next actions"
              columns={columns}
              rows={rows}
              getRowId={(d) => d.id}
              defaultSort={{ columnId: "due", direction: "asc" }}
              selectedRowId={selected?.id}
              onRowClick={(d) => select({ kind: "deal", id: d.id, label: d.title })}
              virtualize={rows.length > cfg.virtualizeAbove}
              emptyTitle="No next action is due by this date"
            />
          </div>
        </>
      )}
    </ModuleRoot>
  );
}
