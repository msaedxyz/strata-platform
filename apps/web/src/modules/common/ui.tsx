// Parts that each module uses. They compose design system components only. They add no visual pattern.
import { Badge, type BadgeTone, cx, EmptyState, ErrorState, Fact, LoadingState, STATUS_STYLE, StatusBadge } from "@strata/design-system";
import { type ReactNode, useEffect, useRef } from "react";
import { evidenceIds } from "./api";
import { humanise } from "./format";

export type ModuleState = "loading" | "ready" | "empty" | "error";

/**
 * The root of a module. data-module-state tells the tests and the performance test when the module has its data.
 * The first time a module is ready, it sets a performance mark (docs/07 criterion 6).
 */
export function ModuleRoot({ id, state, children, className }: { id: string; state: ModuleState; children: ReactNode; className?: string }) {
  const marked = useRef(false);
  useEffect(() => {
    if (marked.current || state === "loading") return;
    marked.current = true;
    performance.mark(`strata:module-ready:${id}`);
  }, [id, state]);
  return (
    <div className={cx("strata-module", className)} data-module={id} data-module-state={state}>
      {children}
    </div>
  );
}

/** The loading, error and empty states of a resource. Returns null when the module can show its data. */
export function resourceState(
  r: { loading: boolean; error: string | undefined; reload: () => unknown },
  opts: { label: string; empty?: boolean; emptyTitle?: string; emptyDescription?: ReactNode },
): { state: ModuleState; node: ReactNode | null } {
  if (r.error) return { state: "error", node: <ErrorState description={r.error} onRetry={() => void r.reload()} /> };
  if (r.loading) return { state: "loading", node: <LoadingState rows={5} label={`Loading ${opts.label}`} /> };
  if (opts.empty) return { state: "empty", node: <EmptyState title={opts.emptyTitle ?? "No data"} description={opts.emptyDescription} /> };
  return { state: "ready", node: null };
}

/** A value with its provenance control when it has evidence (docs/07 rule 1). */
export function FactValue({ ids, label, children }: { ids: readonly string[] | null | undefined; label: string; children: ReactNode }) {
  const e = evidenceIds(ids);
  return e ? (
    <Fact evidenceIds={e} label={label}>
      {children}
    </Fact>
  ) : (
    <>{children}</>
  );
}

/**
 * A value that waits for approval or confirmation, for example a site status from a SiteStatusChanged proposal.
 * It has the one visual style of unconfirmed and reported items (docs/07 rule 4).
 */
export function UnverifiedValue({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <Badge tone={STATUS_STYLE.unconfirmed.tone} data-status="pending" title={title}>
      {children}
    </Badge>
  );
}

const SITE_STATUS_TONE: Record<string, BadgeTone> = {
  producing: "positive",
  ramping_up: "accent",
  under_construction: "accent",
  care_and_maintenance: "warning",
  suspended: "negative",
  closed: "neutral",
};

/** The site status and, when one waits for approval, the pending status. */
export function SiteStatus({ status, pending }: { status: string | null; pending: string | null }) {
  return (
    <span className="strata-inline">
      {status ? <Badge tone={SITE_STATUS_TONE[status] ?? "neutral"}>{humanise(status)}</Badge> : <span className="strata-muted">Unknown</span>}
      {pending && <UnverifiedValue title="Waits for approval">{`${humanise(pending)}, pending`}</UnverifiedValue>}
    </span>
  );
}

/** The stage of an opportunity, with "Pending approval" when a stage change waits for an approver. */
export function DealStageText({ stage, pending, names }: { stage: string; pending: string | null; names: (code: string) => string }) {
  return (
    <span className="strata-inline">
      <span>{names(stage)}</span>
      {pending && (
        <>
          <StatusBadge status="pending_approval" />
          <span className="strata-muted">{`to ${names(pending)}`}</span>
        </>
      )}
    </span>
  );
}

/** A small heading inside a module. */
export function SectionHeading({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 className="strata-heading" id={id}>
      {children}
    </h3>
  );
}
