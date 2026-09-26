// Alert telemetry: latency from fetch to alert, time to acknowledgement, false positive rate for each tier rule,
// and the timestamps of each alert (GET /api/telemetry/alerts, M4, docs/06 "Alert telemetry"). Live.
import { BarChart, type Column, DataTable, StatusBadge, Tabs } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useMemo } from "react";
import { getTelemetry, type TelemetryAlert, type TelemetryResponse } from "../api/writes";
import { moduleConfig } from "../config/modules";
import { useResource } from "../data/resource";
import { useApi } from "./common/api";
import { formatDateTime, formatDuration, formatPercent, humanise, tierBadge } from "./common/format";
import { KeyValues } from "./common/KeyValues";
import { ModuleRoot, resourceState, SectionHeading } from "./common/ui";

const cfg = moduleConfig["alert-telemetry"];

const alertColumns: Column<TelemetryAlert>[] = [
  { id: "title", header: "Alert", value: (a) => a.title, width: 220 },
  { id: "rule", header: "Tier rule", value: (a) => `${tierBadge(a.tier).label} ${a.tier_rule}` },
  {
    id: "outcome",
    header: "Outcome",
    value: (a) => a.outcome ?? a.status,
    cell: (a) => {
      const st = a.outcome ?? a.status;
      return st === "confirmed" || st === "dismissed" || st === "false_positive" || st === "unconfirmed" ? <StatusBadge status={st} /> : humanise(st);
    },
  },
  { id: "published", header: "Published", value: (a) => a.published_at ?? "", cell: (a) => formatDateTime(a.published_at) },
  { id: "fetched", header: "Fetched", value: (a) => a.fetched_at ?? "", cell: (a) => formatDateTime(a.fetched_at) },
  { id: "raised", header: "Raised", value: (a) => a.raised_at, cell: (a) => formatDateTime(a.raised_at) },
  {
    id: "delivered",
    header: "Delivered",
    value: (a) => a.delivered.frontend ?? a.delivered.email ?? "",
    cell: (a) =>
      [
        a.delivered.frontend ? `Frontend ${formatDateTime(a.delivered.frontend)}` : a.delivered.frontend_broadcast ? `Frontend broadcast ${formatDateTime(a.delivered.frontend_broadcast)}` : null,
        a.delivered.email ? `Email ${formatDateTime(a.delivered.email)}` : a.delivery_status.email ? `Email ${humanise(a.delivery_status.email)}` : null,
      ]
        .filter(Boolean)
        .join(", "),
  },
  { id: "ack", header: "Acknowledged", value: (a) => a.acknowledged_at ?? "", cell: (a) => (a.acknowledged_at ? `${formatDateTime(a.acknowledged_at)} by ${a.acknowledged_by ?? ""}` : "") },
  { id: "decided", header: "Decided", value: (a) => a.decided_at ?? "", cell: (a) => (a.decided_at ? `${formatDateTime(a.decided_at)}${a.decided_by ? ` by ${a.decided_by}` : ""}` : "") },
];

export function AlertTelemetryModule(_: PanelProps) {
  const { http } = useApi();
  const r = useResource<TelemetryResponse>("telemetry:alerts", () => getTelemetry(http), { live: cfg.live.events, batchMs: cfg.live.batchMs });
  const m = r.data?.metrics;
  const fp = useMemo(
    () =>
      (m?.false_positive_rate_by_tier_rule ?? []).map((x) => ({
        label: `${x.tier_rule} (${x.false_positive} of ${x.decided} decided)`,
        value: x.false_positive_rate ?? 0,
        tone: (x.false_positive_rate ?? 0) > 0 ? ("negative" as const) : ("positive" as const),
      })),
    [m],
  );
  const s = resourceState(r, { label: "alert telemetry", empty: (r.data?.items.length ?? 0) === 0, emptyTitle: "No alerts yet", emptyDescription: "The metrics show after the first alert." });
  return (
    <ModuleRoot id="alert-telemetry" state={s.state}>
      {s.node ??
        (m && (
          <Tabs
            label="Alert telemetry"
            className="strata-tabs"
            items={[
              {
                id: "metrics",
                label: "Metrics",
                content: (
                  <div className="strata-stack">
                    <KeyValues
                      label="Alert metrics"
                      rows={[
                        { id: "lat-med", label: "Latency fetch to alert, median", value: formatDuration(m.latency_fetch_to_alert_seconds.median) },
                        { id: "lat-p90", label: "Latency fetch to alert, 90th percentile", value: formatDuration(m.latency_fetch_to_alert_seconds.p90) },
                        { id: "ack-med", label: "Time to acknowledgement, median", value: formatDuration(m.time_to_acknowledgement_seconds.median) },
                        { id: "ack-p90", label: "Time to acknowledgement, 90th percentile", value: formatDuration(m.time_to_acknowledgement_seconds.p90) },
                        { id: "ack-n", label: "Acknowledged alerts", value: `${m.time_to_acknowledgement_seconds.n} of ${r.data?.items.length ?? 0}` },
                      ]}
                    />
                    <SectionHeading>False positive rate by tier rule</SectionHeading>
                    <BarChart label="False positive rate by tier rule" data={fp} format={(v) => formatPercent(v)} max={1} />
                  </div>
                ),
              },
              {
                id: "alerts",
                label: "Alerts",
                count: r.data?.items.length,
                content: <DataTable label="Alert timestamps" columns={alertColumns} rows={r.data?.items ?? []} getRowId={(a) => a.id} defaultSort={{ columnId: "raised", direction: "desc" }} />,
              },
            ]}
          />
        ))}
    </ModuleRoot>
  );
}
