// Source health: the status of each source of the active brief, and the known gaps (GET /api/sources/health and
// GET /api/sources/known-gaps). Live, and it reloads on an interval because collector runs are not events.
import { Badge, type BadgeTone, type Column, DataTable, Tabs } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useMemo } from "react";
import type { KnownGap, KnownGapsResponse, SourceHealth, SourceHealthResponse } from "../api/types";
import { moduleConfig } from "../config/modules";
import { useResource } from "../data/resource";
import { useApi } from "./common/api";
import { formatDateTime, formatNumber, formatPercent, humanise } from "./common/format";
import { ModuleRoot, resourceState } from "./common/ui";

const cfg = moduleConfig["source-health"];

function status(s: SourceHealth): { label: string; tone: BadgeTone } {
  if (s.last_status === "failed") return { label: "Failed", tone: "negative" };
  if (s.last_status === "success" && (s.error_rate ?? 0) > 0) return { label: "Errors", tone: "warning" };
  if (s.last_status === "success") return { label: "OK", tone: "positive" };
  return { label: "No run", tone: "neutral" };
}

const columns: Column<SourceHealth>[] = [
  { id: "name", header: "Source", value: (s) => s.name, width: 200 },
  { id: "status", header: "Status", value: (s) => status(s).label, cell: (s) => <Badge tone={status(s).tone}>{status(s).label}</Badge> },
  { id: "kind", header: "Kind", value: (s) => humanise(s.kind) },
  { id: "success", header: "Last success", value: (s) => s.last_success_at ?? "", cell: (s) => formatDateTime(s.last_success_at) },
  { id: "errors", header: "Error rate", value: (s) => s.error_rate, cell: (s) => formatPercent(s.error_rate), numeric: true },
  { id: "docs", header: "Documents per run", value: (s) => s.documents_per_run, cell: (s) => formatNumber(s.documents_per_run), numeric: true },
  { id: "next", header: "Next run", value: (s) => s.next_run_at, cell: (s) => formatDateTime(s.next_run_at) },
  { id: "error", header: "Last error", value: (s) => s.last_error ?? "" },
];

const gapColumns: Column<KnownGap & { i: number }>[] = [
  { id: "name", header: "Source", value: (g) => g.name, width: 220 },
  { id: "reason", header: "Reason", value: (g) => g.reason },
  { id: "workaround", header: "Workaround", value: (g) => humanise(g.workaround ?? "") },
];

export function SourceHealthModule(_: PanelProps) {
  const { reads } = useApi();
  const r = useResource<SourceHealthResponse>("sources:health", reads.sourceHealth, { live: cfg.live.events, batchMs: cfg.live.batchMs, refreshMs: cfg.refreshMs });
  const gaps = useResource<KnownGapsResponse>("sources:known-gaps", reads.knownGaps, { live: cfg.live.events, batchMs: cfg.live.batchMs });
  const sources = useMemo(() => r.data?.sources ?? [], [r.data]);
  const gapRows = useMemo(() => (gaps.data?.known_gaps ?? r.data?.known_gaps ?? []).map((g, i) => ({ ...g, i })), [gaps.data, r.data]);
  const failing = sources.filter((s) => s.last_status === "failed").length;

  const s = resourceState(r, { label: "source health", empty: r.data?.brief_version === null, emptyTitle: "No active brief", emptyDescription: "An admin activates a brief version in the brief editor." });
  return (
    <ModuleRoot id="source-health" state={s.state}>
      {s.node ?? (
        <Tabs
          label="Source health"
          className="strata-tabs"
          items={[
            {
              id: "sources",
              label: failing ? `Sources, ${failing} failed` : "Sources",
              count: sources.length,
              content: <DataTable label={`Sources of brief version ${r.data?.brief_version ?? ""}`} columns={columns} rows={sources} getRowId={(x) => x.id} emptyTitle="No sources" />,
            },
            {
              id: "gaps",
              label: "Known gaps",
              count: gapRows.length,
              content: <DataTable label="Known gaps" columns={gapColumns} rows={gapRows} getRowId={(g) => String(g.i)} emptyTitle="No known gaps" />,
            },
          ]}
        />
      )}
    </ModuleRoot>
  );
}
