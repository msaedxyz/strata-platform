// Quarantine: agent output that failed a guardrail, with the reason codes (GET /api/quarantine, M3). Not live.
// The output is data from a model. The drawer shows it as text only.
import { Badge, type Column, DataTable, Drawer, Select, TextArea } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useMemo, useState } from "react";
import type { QuarantineItem, QuarantineResponse } from "../api/types";
import { getQuarantine, getQuarantineItem } from "../api/writes";
import { moduleConfig } from "../config/modules";
import { useResource } from "../data/resource";
import { useApi } from "./common/api";
import { formatDateTime, humanise } from "./common/format";
import { KeyValues } from "./common/KeyValues";
import { ModuleRoot, resourceState } from "./common/ui";

const cfg = moduleConfig.quarantine;

function QuarantineDetail({ id }: { id: string }) {
  const { http } = useApi();
  const r = useResource<QuarantineItem>(`quarantine:${id}`, () => getQuarantineItem(http, id));
  const q = r.data;
  if (!q) return <p className="strata-muted">{r.error ?? "Loading"}</p>;
  return (
    <div className="strata-stack" data-quarantine-id={q.id}>
      <KeyValues
        label="Quarantine item"
        rows={[
          { id: "reason", label: "Reason code", value: <Badge tone="negative">{q.reason_code}</Badge> },
          { id: "agent", label: "Agent", value: humanise(q.agent) },
          { id: "model", label: "Model", value: q.model_id ?? "" },
          { id: "prompt", label: "Prompt version", value: q.prompt_version ?? "" },
          { id: "source", label: "Source", value: q.source_id ?? "" },
          { id: "time", label: "Time", value: formatDateTime(q.created_at) },
        ]}
      />
      <TextArea label="Detail" code readOnly rows={6} value={JSON.stringify(q.detail, null, 2)} />
      <TextArea label="Agent output" code readOnly rows={10} value={JSON.stringify(q.output, null, 2)} />
    </div>
  );
}

export function QuarantineModule(_: PanelProps) {
  const { http } = useApi();
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const r = useResource<QuarantineResponse>(`quarantine:list:${cfg.limit}`, () => getQuarantine(http, cfg.limit));
  const all = useMemo(() => r.data?.items ?? [], [r.data]);
  const codes = useMemo(() => [...new Set(all.map((q) => q.reason_code))].sort(), [all]);
  const rows = reason ? all.filter((q) => q.reason_code === reason) : all;

  const columns: Column<QuarantineItem>[] = [
    { id: "time", header: "Time", value: (q) => q.created_at, cell: (q) => formatDateTime(q.created_at), width: 150 },
    { id: "reason", header: "Reason code", value: (q) => q.reason_code, cell: (q) => <Badge tone="negative">{q.reason_code}</Badge> },
    { id: "agent", header: "Agent", value: (q) => humanise(q.agent) },
    { id: "model", header: "Model", value: (q) => q.model_id ?? "" },
  ];

  const s = resourceState(r, { label: "quarantine", empty: all.length === 0, emptyTitle: "No quarantined output", emptyDescription: "Agent output that fails a guardrail shows here." });
  return (
    <ModuleRoot id="quarantine" state={s.state}>
      {s.node ?? (
        <>
          <div className="strata-module__toolbar">
            <Select label="Reason code" hideLabel value={reason} onChange={(e) => setReason(e.target.value)} options={[{ value: "", label: "All reason codes" }, ...codes.map((c) => ({ value: c, label: c }))]} />
          </div>
          <div className="strata-module__fill">
            <DataTable label="Quarantined agent output" columns={columns} rows={rows} getRowId={(q) => q.id} onRowClick={(q) => setOpen(q.id)} selectedRowId={open ?? undefined} defaultSort={{ columnId: "time", direction: "desc" }} />
          </div>
        </>
      )}
      <Drawer open={open !== null} onClose={() => setOpen(null)} title="Quarantined output">
        {open && <QuarantineDetail id={open} />}
      </Drawer>
    </ModuleRoot>
  );
}
