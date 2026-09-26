// Timeline: the events of an entity, a project or an opportunity, with evidence links and an "as of" date
// (GET /api/timeline). The "as of" date reads the state at the end of that day. Not live (docs/07).
import { Button, DatePicker, EmptyState, FeedItem, Select } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useMemo, useState } from "react";
import type { TimelineEvent, TimelineResponse } from "../api/types";
import { useResource } from "../data/resource";
import { evidenceIds, useApi, useStages } from "./common/api";
import { certaintyStatus, endOfDayIso, formatDate, formatDateTime, humanise, nameOf, shortValue } from "./common/format";
import { type Selected, useSelection } from "./common/selection";
import { ModuleRoot, resourceState } from "./common/ui";
import { useDeals } from "./KanbanModule";

/** A short text for the payload of an event: the stage change, the status or the main value. */
function describe(e: TimelineEvent, stage: (c: string) => string): string {
  const p = e.payload;
  if (e.event_type === "DealStageChanged" || e.event_type === "ProjectStageChanged") return `${stage(String(p.from_stage ?? "")) || "Start"} to ${stage(String(p.to_stage))}`;
  if (e.event_type === "SiteStatusChanged") return `${humanise(String(p.from_status ?? "")) || "Unknown"} to ${humanise(String(p.to_status))}`;
  if (typeof p.title === "string") return p.title;
  if (typeof p.predicate === "string") return `${humanise(p.predicate)}: ${shortValue(p.value)}`;
  if (typeof p.action === "string") return `${p.action}, due ${formatDate(String(p.due_date ?? ""))}`;
  if (typeof p.note === "string") return `${humanise(String(p.kind ?? ""))}: ${p.note}`;
  return Object.entries(p)
    .slice(0, 3)
    .map(([k, v]) => `${humanise(k)}: ${shortValue(v, 40)}`)
    .join(", ");
}

const STREAM: Record<Selected["kind"], string> = { deal: "deal", project: "project", entity: "entity" };

export function TimelineModule(_: PanelProps) {
  const { reads } = useApi();
  const stages = useStages();
  const deals = useDeals();
  const { focus, select } = useSelection();
  const [asOf, setAsOf] = useState("");
  const target = focus;
  const key = target ? `timeline:${target.kind}:${target.id}:${asOf}` : null;
  const r = useResource<TimelineResponse>(key, () => reads.timeline(STREAM[target!.kind], target!.id, asOf ? endOfDayIso(asOf) : undefined));
  const stageName = (c: string) => nameOf([...(stages.data?.deal_stages ?? []), ...(stages.data?.lifecycle_stages ?? [])], c);
  const items = useMemo(() => [...(r.data?.items ?? [])].reverse(), [r.data]);

  const dealOptions = useMemo(
    () => [{ value: "", label: "Choose an opportunity" }, ...(deals.data?.items ?? []).map((d) => ({ value: d.id, label: d.title }))],
    [deals.data],
  );

  const toolbar = (
    <div className="strata-module__toolbar">
      <Select
        label="Opportunity"
        hideLabel
        value={target?.kind === "deal" ? target.id : ""}
        options={target && target.kind !== "deal" ? [{ value: "", label: target.label }, ...dealOptions.slice(1)] : dealOptions}
        onChange={(e) => {
          const d = deals.data?.items.find((x) => x.id === e.target.value);
          if (d) select({ kind: "deal", id: d.id, label: d.title });
        }}
      />
      <DatePicker label="As of" value={asOf} onChange={setAsOf} />
      {asOf && (
        <Button size="sm" variant="ghost" onClick={() => setAsOf("")}>
          Show now
        </Button>
      )}
      <Button size="sm" variant="ghost" icon="reset" disabled={!key} onClick={() => void r.reload()}>
        Reload
      </Button>
    </div>
  );

  if (!target)
    return (
      <ModuleRoot id="timeline" state="empty">
        {toolbar}
        <EmptyState title="Nothing selected" description="Select an opportunity, a project or a site in another panel." icon="calendar" />
      </ModuleRoot>
    );

  const state = r.data?.state ?? null;
  const current = state ? String(state.stage ?? state.status ?? "") : "";
  const s = resourceState(r, { label: "timeline", empty: items.length === 0 && (r.data?.proposals.length ?? 0) === 0, emptyTitle: asOf ? `No events up to ${formatDate(asOf)}` : "No events" });
  return (
    <ModuleRoot id="timeline" state={s.state}>
      {toolbar}
      <div className="strata-module__summary" data-timeline-state={current}>
        <span className="strata-muted">{asOf ? `${target.label}, as of ${formatDate(asOf)}:` : `${target.label}, now:`}</span>
        <strong>{current ? (target.kind === "entity" ? humanise(current) : stageName(current)) : "No state"}</strong>
      </div>
      {s.node ?? (
        <div className="strata-module__fill" role="feed" aria-label={`Events of ${target.label}`}>
          {(r.data?.proposals ?? [])
            .filter((p) => p.status === "pending")
            .map((p) => (
              <FeedItem key={p.id} data-proposal-id={p.id} title={p.title} time={formatDateTime(p.created_at)} dateTime={p.created_at} status="pending_approval" tags={["Proposal"]} />
            ))}
          {items.map((e) => (
            <FeedItem
              key={e.id}
              data-event-id={e.id}
              data-event-type={e.event_type}
              title={`${humanise(e.event_type)}: ${describe(e, stageName)}`}
              source={`${humanise(e.actor_type)} ${e.actor_id}`}
              time={formatDateTime(e.occurred_at ?? e.recorded_at)}
              dateTime={e.occurred_at ?? e.recorded_at}
              status={certaintyStatus(e.certainty)}
              evidenceIds={evidenceIds(e.evidence_ids) ?? undefined}
              // A change by the team has a reason and no source evidence (docs/03: DealStageChanged needs evidence or
              // a reason from a human). The reason is its provenance.
              summary={typeof e.payload.reason === "string" && e.payload.reason ? `Reason: ${e.payload.reason}` : undefined}
              tags={e.proposal_id ? [`Approved proposal ${e.proposal_id}`] : undefined}
            />
          ))}
        </div>
      )}
    </ModuleRoot>
  );
}
