// The detail drawers: site, opportunity (deal), project and signal. One drawer for the whole app.
// Each drawer shows facts with their provenance controls (docs/07 rule 1).
import {
  Button,
  type Column,
  DataTable,
  Drawer,
  EmptyState,
  ErrorState,
  EvidenceQuote,
  FeedItem,
  LoadingState,
  StatusBadge,
} from "@strata/design-system";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import type { DealDetail, EntityDetail, ForecastInterval, MapDeal, ProjectDetail, Relationship, Signal, TickerSignal } from "../../api/types";
import { useResource } from "../../data/resource";
import { evidenceIds, toEvidence, useApi, useStages, useTaxonomy } from "./api";
import { certaintyStatus, formatDate, formatDateTime, formatNumber, humanise, nameOf, shortValue, tierBadge } from "./format";
import { KeyValues } from "./KeyValues";
import { useSelection } from "./selection";
import { DealStageText, FactValue, SectionHeading, SiteStatus } from "./ui";

type Target =
  | { kind: "site"; id: string; deals?: MapDeal[] }
  | { kind: "deal"; id: string }
  | { kind: "project"; id: string }
  | { kind: "signal"; signal: Signal | TickerSignal };

interface DrawerValue {
  openSite: (id: string, deals?: MapDeal[]) => void;
  openDeal: (id: string) => void;
  openProject: (id: string) => void;
  openSignal: (signal: Signal | TickerSignal) => void;
}

const DrawerContext = createContext<DrawerValue>({ openSite: () => undefined, openDeal: () => undefined, openProject: () => undefined, openSignal: () => undefined });

export const useDetailDrawer = () => useContext(DrawerContext);

export function DetailDrawerProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null);
  const openSite = useCallback((id: string, deals?: MapDeal[]) => setTarget({ kind: "site", id, deals }), []);
  const openDeal = useCallback((id: string) => setTarget({ kind: "deal", id }), []);
  const openProject = useCallback((id: string) => setTarget({ kind: "project", id }), []);
  const openSignal = useCallback((signal: Signal | TickerSignal) => setTarget({ kind: "signal", signal }), []);
  const value = useMemo(() => ({ openSite, openDeal, openProject, openSignal }), [openSite, openDeal, openProject, openSignal]);
  const close = () => setTarget(null);

  let title = "";
  let body: ReactNode = null;
  if (target?.kind === "site") {
    title = "Site";
    body = <SiteBody id={target.id} deals={target.deals} onDeal={openDeal} />;
  } else if (target?.kind === "deal") {
    title = "Opportunity";
    body = <DealBody id={target.id} onClose={close} />;
  } else if (target?.kind === "project") {
    title = "Project";
    body = <ProjectBody id={target.id} />;
  } else if (target?.kind === "signal") {
    title = "Signal";
    body = <SignalBody signal={target.signal} />;
  }

  return (
    <DrawerContext.Provider value={value}>
      {children}
      <Drawer open={target !== null} onClose={close} title={title} className="strata-detail-drawer">
        <div className="strata-stack" data-detail-drawer={target?.kind}>
          {body}
        </div>
      </Drawer>
    </DrawerContext.Provider>
  );
}

function Loading({ r, label }: { r: { loading: boolean; error: string | undefined; reload: () => unknown }; label: string }) {
  if (r.error) return <ErrorState description={r.error} onRetry={() => void r.reload()} />;
  return <LoadingState rows={4} label={`Loading ${label}`} />;
}

const relColumns: Column<Relationship>[] = [
  { id: "predicate", header: "Relationship", value: (r) => humanise(r.predicate.replace(/^buyer_role_/, "buyer: ")) },
  {
    id: "other",
    header: "With",
    value: (r) => r.organisation_name ?? r.object_name ?? r.subject_name ?? r.object_id,
    cell: (r) => (
      <FactValue ids={r.evidence_ids} label={humanise(r.predicate)}>
        {r.organisation_name ?? r.object_name ?? r.subject_name ?? r.object_id}
      </FactValue>
    ),
  },
  { id: "certainty", header: "Certainty", value: (r) => r.certainty ?? "", cell: (r) => (certaintyStatus(r.certainty) ? <StatusBadge status={certaintyStatus(r.certainty)!} /> : humanise(r.certainty)) },
];

function SiteBody({ id, deals, onDeal }: { id: string; deals?: MapDeal[]; onDeal: (id: string) => void }) {
  const { reads } = useApi();
  const tax = useTaxonomy();
  const stages = useStages();
  const r = useResource<EntityDetail>(`entity:${id}`, () => reads.entity(id));
  const { select } = useSelection();
  if (!r.data) return <Loading r={r} label="site" />;
  const e = r.data.entity;
  const geo = (code: string | null) => nameOf(tax.data?.geographies, code);
  const stageName = (c: string) => nameOf(stages.data?.deal_stages, c);
  return (
    <>
      <h3 className="strata-drawer-title" data-entity-id={e.id}>
        <FactValue ids={e.identity_evidence_ids} label={e.name}>
          {e.name}
        </FactValue>
      </h3>
      <KeyValues
        label="Site details"
        rows={[
          { id: "class", label: "Site class", value: nameOf(tax.data?.site_classes, e.site_class) },
          { id: "watch", label: "Watch list", value: humanise(e.watch) },
          {
            id: "status",
            label: "Status",
            value: (
              <FactValue ids={e.status_evidence_ids} label={`Status of ${e.name}`}>
                <SiteStatus status={e.status} pending={e.status_pending} />
              </FactValue>
            ),
          },
          { id: "district", label: "District", value: geo(e.district) },
          { id: "province", label: "Province", value: geo(e.province) },
          ...Object.entries(e.attributes ?? {}).map(([k, a]) => ({
            id: `attr-${k}`,
            label: humanise(k),
            value: (
              <FactValue ids={a.evidence_ids} label={humanise(k)}>
                {shortValue(a.value)}
              </FactValue>
            ),
          })),
        ]}
      />
      <Button size="sm" icon="calendar" onClick={() => select({ kind: "entity", id: e.id, label: e.name })}>
        Show in timeline
      </Button>
      {deals && deals.length > 0 && (
        <>
          <SectionHeading>Opportunities</SectionHeading>
          <DataTable
            label="Opportunities at the site"
            toolbar={false}
            className="strata-kv"
            rows={deals}
            getRowId={(d) => d.id}
            onRowClick={(d) => onDeal(d.id)}
            columns={[
              {
                id: "title",
                header: "Opportunity",
                value: (d) => d.title,
                cell: (d) => (
                  <FactValue ids={d.evidence_ids} label={d.title}>
                    {d.title}
                  </FactValue>
                ),
              },
              {
                id: "stage",
                header: "Stage",
                value: (d) => stageName(d.stage),
                cell: (d) => (
                  <FactValue ids={d.stage_evidence_ids} label={`Stage of ${d.title}`}>
                    <DealStageText stage={d.stage} pending={d.stage_pending} names={stageName} />
                  </FactValue>
                ),
              },
            ]}
          />
        </>
      )}
      <SectionHeading>Relationships</SectionHeading>
      <DataTable label="Relationships" toolbar={false} className="strata-kv" rows={r.data.relationships} getRowId={(x) => x.event_id} columns={relColumns} emptyTitle="No relationships" />
      <SectionHeading>Recent signals</SectionHeading>
      {r.data.signals.length === 0 ? (
        <EmptyState title="No signals" />
      ) : (
        <div>
          {r.data.signals.map((s) => (
            <FeedItem
              key={s.id}
              title={s.title}
              source={s.publisher ?? undefined}
              time={formatDateTime(s.published_at)}
              dateTime={s.published_at ?? undefined}
              tier={tierBadge(s.tier)}
              evidenceIds={evidenceIds(s.evidence_ids) ?? undefined}
            />
          ))}
        </div>
      )}
    </>
  );
}

function DealBody({ id, onClose }: { id: string; onClose: () => void }) {
  const { reads } = useApi();
  const stages = useStages();
  const tax = useTaxonomy();
  const { select } = useSelection();
  const r = useResource<DealDetail>(`deal:${id}`, () => reads.deal(id));
  if (!r.data) return <Loading r={r} label="opportunity" />;
  const d = r.data.deal;
  const stageName = (c: string) => nameOf(stages.data?.deal_stages, c);
  return (
    <>
      <h3 className="strata-drawer-title" data-deal-id={d.id}>
        <FactValue ids={d.evidence_ids} label={d.title}>
          {d.title}
        </FactValue>
      </h3>
      <KeyValues
        label="Opportunity details"
        rows={[
          {
            id: "stage",
            label: "Stage",
            value: (
              <FactValue ids={d.stage_evidence_ids} label={`Stage of ${d.title}`}>
                <DealStageText stage={d.stage} pending={d.stage_pending} names={stageName} />
              </FactValue>
            ),
          },
          // A stage that an approver moved has the reason of the move (the team is the source, docs/03).
          ...(d.stage_reason ? [{ id: "reason", label: "Stage reason", value: d.stage_reason }] : []),
          { id: "type", label: "Deal type", value: nameOf(tax.data?.deal_types, d.deal_type) },
          { id: "prequal", label: "Prequalification", value: humanise(d.prequalification_status) || "Not started" },
          { id: "contact", label: "Contact found", value: d.has_contact ? "Yes" : "No" },
          { id: "next", label: "Next action", value: d.next_action ? `${d.next_action.action} (due ${formatDate(d.next_action.due_date)})` : "None" },
          ...Object.entries(d.attributes ?? {}).map(([k, a]) => ({
            id: `attr-${k}`,
            label: humanise(k),
            value: (
              <FactValue ids={a.evidence_ids} label={humanise(k)}>
                {shortValue(a.value)}
              </FactValue>
            ),
          })),
        ]}
      />
      <div className="strata-inline">
        <Button
          size="sm"
          icon="users"
          onClick={() => {
            select({ kind: "deal", id: d.id, label: d.title });
            onClose();
          }}
        >
          Select opportunity
        </Button>
      </div>
      <SectionHeading>Stage history</SectionHeading>
      <DataTable
        label="Stage history"
        toolbar={false}
        className="strata-kv"
        rows={d.stage_history ?? []}
        getRowId={(h) => h.event_id}
        emptyTitle="No stage changes"
        columns={[
          { id: "at", header: "Date", value: (h) => h.at, cell: (h) => formatDateTime(h.at) },
          { id: "from", header: "From", value: (h) => stageName(h.from ?? "") },
          { id: "to", header: "To", value: (h) => stageName(h.to) },
        ]}
      />
    </>
  );
}

const intervalColumns = (lifecycle: (c: string) => string): Column<ForecastInterval>[] => [
  { id: "from", header: "From stage", value: (i) => lifecycle(i.from) },
  { id: "to", header: "To stage", value: (i) => lifecycle(i.to) },
  { id: "median", header: "Median days", value: (i) => i.median_days, numeric: true },
  { id: "range", header: "Range", value: (i) => (i.min_days !== undefined && i.max_days !== undefined ? `${i.min_days} to ${i.max_days}` : "") },
  { id: "n", header: "Projects", value: (i) => i.n_projects, numeric: true },
];

/** The forecast window of a project: the date range, the intervals and the evidence (docs/05 window forecaster). */
export function ForecastDetails({ detail, lifecycle }: { detail: NonNullable<ProjectDetail["project"]["forecast_detail"]>; lifecycle: (c: string) => string }) {
  return (
    <>
      <KeyValues
        label="Forecast"
        rows={[
          {
            id: "window",
            label: "Procurement window",
            value:
              detail.start && detail.end ? (
                <FactValue ids={detail.evidence_ids} label="Forecast procurement window">
                  {`${formatDate(detail.start)} to ${formatDate(detail.end)}`}
                </FactValue>
              ) : detail.procurement_reached ? (
                <FactValue ids={detail.evidence_ids} label="Procurement stage">
                  No window: contractor procurement has started
                </FactValue>
              ) : (
                "No date: too few historical projects support an interval"
              ),
          },
          { id: "from", label: "From stage", value: lifecycle(detail.current_stage) },
          ...(detail.shift_months_nearer ? [{ id: "shift", label: "Moved nearer", value: `${detail.shift_months_nearer} months` }] : []),
          ...(detail.supporting_projects?.length ? [{ id: "support", label: "Supporting projects", value: detail.supporting_projects.join(", ") }] : []),
        ]}
      />
      <SectionHeading>Intervals</SectionHeading>
      <DataTable label="Forecast intervals" toolbar={false} className="strata-kv" rows={detail.intervals} getRowId={(i) => `${i.from}-${i.to}`} columns={intervalColumns(lifecycle)} emptyTitle="No intervals" />
    </>
  );
}

function ProjectBody({ id }: { id: string }) {
  const { reads } = useApi();
  const stages = useStages();
  const tax = useTaxonomy();
  const { select } = useSelection();
  const r = useResource<ProjectDetail>(`project:${id}`, () => reads.project(id));
  if (!r.data) return <Loading r={r} label="project" />;
  const p = r.data.project;
  const lifecycle = (c: string) => nameOf([...(stages.data?.lifecycle_stages ?? []), ...(stages.data?.restart_path ?? [])], c);
  const est = p.demand_estimate;
  return (
    <>
      <h3 className="strata-drawer-title" data-project-id={p.id}>
        {p.name}
      </h3>
      <KeyValues
        label="Project details"
        rows={[
          {
            id: "stage",
            label: "Lifecycle stage",
            value: (
              <FactValue ids={p.stage_evidence_ids} label="Lifecycle stage">
                {lifecycle(p.stage ?? "")}
              </FactValue>
            ),
          },
          { id: "window", label: "Engagement window", value: p.in_engagement_window ? "In the window" : "Not in the window" },
          { id: "sector", label: "Sector", value: nameOf(tax.data?.sectors, p.sector) },
          { id: "first", label: "First public trace", value: formatDate(p.first_trace_at) },
          ...(est
            ? [
                {
                  id: "demand",
                  label: "Demand (estimate)",
                  value: (
                    <FactValue ids={est.evidence_ids ?? Object.values(est.inputs).flatMap((i) => i.evidence_ids)} label="Demand estimate">
                      {`${formatNumber(est.value)} ${humanise(est.unit)}, estimate. Formula ${est.formula_name ?? est.formula_id}: ${est.expression}`}
                    </FactValue>
                  ),
                },
                ...Object.entries(est.inputs).map(([k, inp]) => ({
                  id: `input-${k}`,
                  label: `Input: ${humanise(k)}`,
                  value: (
                    <FactValue ids={inp.evidence_ids} label={humanise(k)}>
                      {shortValue(inp.value)}
                    </FactValue>
                  ),
                })),
              ]
            : []),
        ]}
      />
      <div className="strata-inline">
        <Button size="sm" icon="calendar" onClick={() => select({ kind: "project", id: p.id, label: p.name })}>
          Show in timeline
        </Button>
      </div>
      {p.forecast_detail && <ForecastDetails detail={p.forecast_detail} lifecycle={lifecycle} />}
      <SectionHeading>Buyer roles</SectionHeading>
      <DataTable label="Buyer roles" toolbar={false} className="strata-kv" rows={r.data.relationships} getRowId={(x) => x.event_id} columns={relColumns} emptyTitle="No buyer roles" />
    </>
  );
}

function SignalBody({ signal }: { signal: Signal | TickerSignal }) {
  const { reads } = useApi();
  const key = signal.evidence_ids.length ? `evidence:${signal.evidence_ids.join(",")}` : null;
  const ev = useResource(key, () => reads.evidence(signal.evidence_ids));
  return (
    <>
      <FeedItem
        title={signal.title}
        source={signal.publisher ?? undefined}
        time={formatDateTime(signal.published_at)}
        dateTime={signal.published_at ?? undefined}
        tier={tierBadge(signal.tier)}
        status={"certainty" in signal ? certaintyStatus(signal.certainty) : undefined}
        tags={signal.read_at_source ? ["Read at source"] : undefined}
      />
      <SectionHeading>Evidence</SectionHeading>
      {!ev.data ? (
        key ? <Loading r={ev} label="evidence" /> : <EmptyState title="No evidence" />
      ) : (
        <ol className="strata-list">
          {ev.data.items.map((e) => (
            <li key={e.id}>
              <EvidenceQuote evidence={toEvidence(e)} />
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
