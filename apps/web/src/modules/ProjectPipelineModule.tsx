// Project pipeline: projects by lifecycle stage, with the engagement window marked (GET /api/projects and
// GET /api/config/stages). The bars count the projects at each stage. The engagement window stages use the accent tone. Live.
import { Badge, BarChart, type BarDatum, type Column, DataTable, StatusBadge } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useMemo } from "react";
import type { Project, StagesConfig } from "../api/types";
import { moduleConfig } from "../config/modules";
import { useResource } from "../data/resource";
import { useApi, useStages, useTaxonomy } from "./common/api";
import { useDetailDrawer } from "./common/drawers";
import { certaintyStatus, formatDate, nameOf } from "./common/format";
import { useSelection } from "./common/selection";
import { FactValue, ModuleRoot, resourceState, SectionHeading } from "./common/ui";

const cfg = moduleConfig["project-pipeline"];

/** The order numbers of the engagement window stages (docs/03: stages 4 to 8). */
export function windowOrders(stages: StagesConfig | undefined): [number, number] | null {
  if (!stages) return null;
  const find = (c: string) => stages.lifecycle_stages.find((s) => s.code === c)?.order;
  const lo = find(stages.engagement_window.from);
  const hi = find(stages.engagement_window.to);
  return lo !== undefined && hi !== undefined ? [lo, hi] : null;
}

export function useProjects() {
  const { reads } = useApi();
  return useResource<{ items: Project[] }>("projects", reads.projects, { live: cfg.live.events, batchMs: cfg.live.batchMs });
}

export function ProjectPipelineModule(_: PanelProps) {
  const stages = useStages();
  const tax = useTaxonomy();
  const r = useProjects();
  const { openProject } = useDetailDrawer();
  const { select } = useSelection();
  const items = useMemo(() => r.data?.items ?? [], [r.data]);
  const win = windowOrders(stages.data);
  const lifecycle = useMemo(() => [...(stages.data?.lifecycle_stages ?? []), ...(stages.data?.restart_path ?? [])], [stages.data]);
  const stageName = (c: string | null) => nameOf(lifecycle, c);
  const inWindow = (order: number) => !!win && order >= win[0] && order <= win[1];

  const bars: BarDatum[] = useMemo(
    () =>
      (stages.data?.lifecycle_stages ?? []).map((st) => ({
        label: inWindow(st.order) ? `${st.name} (window)` : st.name,
        value: items.filter((p) => p.stage === st.code).length,
        tone: inWindow(st.order) ? "accent" : "neutral",
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stages.data, items],
  );

  const columns: Column<Project>[] = useMemo(
    () => [
      { id: "name", header: "Project", value: (p) => p.name, width: 220 },
      {
        id: "stage",
        header: "Stage",
        value: (p) => p.stage_order ?? 0,
        cell: (p) => (
          <span className="strata-inline">
            <FactValue ids={p.stage_evidence_ids} label={`Stage of ${p.name}`}>
              {stageName(p.stage)}
            </FactValue>
            {certaintyStatus(p.stage_certainty) && <StatusBadge status={certaintyStatus(p.stage_certainty)!} />}
          </span>
        ),
        width: 260,
      },
      { id: "window", header: "Engagement window", value: (p) => (p.in_engagement_window ? 1 : 0), cell: (p) => (p.in_engagement_window ? <Badge tone="accent">In window</Badge> : "") },
      { id: "site", header: "Site", value: (p) => p.site_name ?? "" },
      { id: "sector", header: "Sector", value: (p) => nameOf(tax.data?.sectors, p.sector) },
      { id: "forecast", header: "Procurement forecast", value: (p) => p.forecast_start ?? "", cell: (p) => (p.forecast_start ? `${formatDate(p.forecast_start)} to ${formatDate(p.forecast_end)}` : "Stage only") },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stages.data, tax.data],
  );

  const s = resourceState(
    { loading: r.loading || stages.loading, error: r.error ?? stages.error, reload: r.reload },
    { label: "projects", empty: items.length === 0, emptyTitle: "No projects", emptyDescription: "A project shows here from its first public trace." },
  );
  const from = stages.data ? stageName(stages.data.engagement_window.from) : "";
  const to = stages.data ? stageName(stages.data.engagement_window.to) : "";
  return (
    <ModuleRoot id="project-pipeline" state={s.state}>
      {s.node ?? (
        <div className="strata-stack strata-module__fill">
          <div className="strata-inline">
            <Badge tone="accent" data-engagement-window>{`Engagement window: ${from} to ${to}`}</Badge>
          </div>
          <BarChart label="Projects by lifecycle stage" data={bars} />
          <SectionHeading>Projects</SectionHeading>
          <div className="strata-table-box">
            <DataTable
              label="Projects"
              columns={columns}
              rows={items}
              getRowId={(p) => p.id}
              defaultSort={{ columnId: "stage", direction: "asc" }}
              onRowClick={(p) => {
                select({ kind: "project", id: p.id, label: p.name });
                openProject(p.id);
              }}
              virtualize={items.length > cfg.virtualizeAbove}
            />
          </div>
        </div>
      )}
    </ModuleRoot>
  );
}
