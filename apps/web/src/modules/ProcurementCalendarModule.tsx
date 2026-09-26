// Procurement calendar: the forecast procurement window of each project on a 24 month axis (GET /api/calendar).
// A bar is a forecast window. A click opens its intervals and evidence. Projects without a date show the stage only,
// because fewer than five historical projects support an interval, or because contractor procurement has started
// (docs/05). Each stage shows the evidence of its ProjectStageChanged event (docs/07 rule 1). Live.
import { Badge, type Column, DataTable, Drawer, TimelineAxis, type TimelineRow } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useMemo, useState } from "react";
import type { CalendarResponse } from "../api/types";
import { moduleConfig } from "../config/modules";
import { useResource } from "../data/resource";
import { useApi, useStages } from "./common/api";
import { ForecastDetails } from "./common/drawers";
import { formatDate, nameOf, todayIso } from "./common/format";
import { useSelection } from "./common/selection";
import { FactValue, ModuleRoot, resourceState, SectionHeading } from "./common/ui";

const cfg = moduleConfig["procurement-calendar"];
type Item = CalendarResponse["items"][number];

export function ProcurementCalendarModule(_: PanelProps) {
  const { reads } = useApi();
  const stages = useStages();
  const { select } = useSelection();
  const [open, setOpen] = useState<Item | null>(null);
  const r = useResource<CalendarResponse>(`calendar:${cfg.months}`, () => reads.calendar(cfg.months), { live: cfg.live.events, batchMs: cfg.live.batchMs });
  const items = useMemo(() => r.data?.items ?? [], [r.data]);
  const lifecycle = useMemo(() => [...(stages.data?.lifecycle_stages ?? []), ...(stages.data?.restart_path ?? [])], [stages.data]);
  const stageName = (c: string | null) => nameOf(lifecycle, c);
  const today = todayIso();
  const start = today.slice(0, 7);

  const dated = items.filter((p) => p.forecast_start && p.forecast_end);
  const undated = items.filter((p) => !(p.forecast_start && p.forecast_end));
  const rows: TimelineRow[] = dated.map((p) => ({
    id: p.id,
    label: `${p.name} · ${stageName(p.stage)}`,
    ranges: [
      {
        id: `${p.id}-window`,
        start: p.forecast_start!,
        end: p.forecast_end!,
        label: `${formatDate(p.forecast_start)} to ${formatDate(p.forecast_end)}`,
        forecast: true,
        tone: p.in_engagement_window ? "accent" : "neutral",
      },
    ],
  }));

  const undatedColumns: Column<Item>[] = [
    { id: "name", header: "Project", value: (p) => p.name },
    {
      id: "stage",
      header: "Stage",
      value: (p) => p.stage_order ?? 0,
      cell: (p) => (
        <FactValue ids={p.stage_evidence_ids} label={`Stage of ${p.name}`}>
          {stageName(p.stage)}
        </FactValue>
      ),
    },
    { id: "window", header: "Engagement window", value: (p) => (p.in_engagement_window ? 1 : 0), cell: (p) => (p.in_engagement_window ? <Badge tone="accent">In window</Badge> : "") },
  ];

  const s = resourceState(r, { label: "procurement calendar", empty: items.length === 0, emptyTitle: "No projects", emptyDescription: "Forecast windows show here when projects have a lifecycle stage." });
  return (
    <ModuleRoot id="procurement-calendar" state={s.state}>
      {s.node ?? (
        <div className="strata-stack strata-pad">
          <TimelineAxis
            label="Forecast procurement windows"
            start={start}
            months={r.data?.months ?? cfg.months}
            today={today}
            rows={rows}
            onRangeSelect={(rowId) => {
              const p = dated.find((x) => x.id === rowId);
              if (p) {
                setOpen(p);
                select({ kind: "project", id: p.id, label: p.name });
              }
            }}
          />
          {undated.length > 0 && (
            <>
              <SectionHeading>No forecast date: stage only</SectionHeading>
              <DataTable label="Projects without a forecast date" toolbar={false} className="strata-kv" columns={undatedColumns} rows={undated} getRowId={(p) => p.id} />
            </>
          )}
        </div>
      )}
      <Drawer open={open !== null} onClose={() => setOpen(null)} title="Forecast window">
        {open?.forecast_detail ? (
          <div className="strata-stack" data-forecast-for={open.id}>
            <h3 className="strata-drawer-title">
              <FactValue ids={open.stage_evidence_ids} label={`Stage of ${open.name}`}>
                {`${open.name} · ${stageName(open.stage)}`}
              </FactValue>
            </h3>
            <ForecastDetails detail={open.forecast_detail} lifecycle={(c) => stageName(c)} />
          </div>
        ) : (
          open && <p>{`${open.name}: ${formatDate(open.forecast_start)} to ${formatDate(open.forecast_end)}`}</p>
        )}
      </Drawer>
    </ModuleRoot>
  );
}
