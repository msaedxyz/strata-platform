import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { Icon } from "../icons";
import { cx } from "../lib/utils";
import { Drawer } from "./Overlay";
import { EmptyState, ErrorState, LoadingState } from "./States";
import "./Provenance.css";

/** A non-empty list of evidence ids. A fact without evidence does not compile (docs/07 rule 2). */
export type EvidenceIds = readonly [string, ...string[]];

/** One evidence span (docs/03 evidence table) with the text around it. */
export interface Evidence {
  id: string;
  /** The exact text of the span. */
  quote: string;
  /** Text before and after the span in the source, so the span shows in context. */
  before?: string;
  after?: string;
  sourceUrl: string;
  sourceTitle?: string;
  publisher?: string;
  /** Already formatted date text. */
  publishedAt?: string;
}

export type EvidenceLoader = (ids: readonly string[]) => Promise<Evidence[]>;

const EvidenceContext = createContext<EvidenceLoader | null>(null);

/** The app gives the loader that calls the API. */
export function EvidenceProvider({ loader, children }: { loader: EvidenceLoader; children: ReactNode }) {
  return <EvidenceContext.Provider value={loader}>{children}</EvidenceContext.Provider>;
}

export function EvidenceQuote({ evidence }: { evidence: Evidence }) {
  return (
    <figure className="sds-evidence">
      <blockquote className="sds-evidence__quote">
        {evidence.before && <span className="sds-evidence__context">…{evidence.before}</span>}
        <mark className="sds-evidence__span">{evidence.quote}</mark>
        {evidence.after && <span className="sds-evidence__context">{evidence.after}…</span>}
      </blockquote>
      <figcaption className="sds-evidence__source">
        <span>
          {[evidence.publisher, evidence.publishedAt].filter(Boolean).join(" · ")}
          {evidence.sourceTitle && <span className="sds-evidence__title"> {evidence.sourceTitle}</span>}
        </span>
        <a className="sds-evidence__link" href={evidence.sourceUrl} target="_blank" rel="noreferrer noopener">
          Open source
          <Icon name="externalLink" size="sm" />
        </a>
      </figcaption>
    </figure>
  );
}

type LoadState = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; items: Evidence[] };

export interface ProvenanceControlProps {
  evidenceIds: EvidenceIds;
  /** Evidence that the caller already has. Without it, the control uses the EvidenceProvider loader. */
  evidence?: Evidence[];
  /** What the fact is, for the drawer title and the accessible name. */
  label?: string;
  defaultOpen?: boolean;
  inline?: boolean;
}

/** The provenance control. It opens the evidence with the span highlighted and a link to the source (docs/07 rule 1). */
export function ProvenanceControl({ evidenceIds, evidence, label, defaultOpen = false, inline }: ProvenanceControlProps) {
  const loader = useContext(EvidenceContext);
  const [open, setOpen] = useState(defaultOpen);
  const [state, setState] = useState<LoadState>(evidence ? { kind: "done", items: evidence } : { kind: "idle" });
  const [attempt, setAttempt] = useState(0);
  const key = evidenceIds.join(",");

  useEffect(() => {
    if (!open || evidence) return undefined;
    if (!loader) {
      setState({ kind: "error", message: "No evidence loader is available." });
      return undefined;
    }
    let live = true;
    setState({ kind: "loading" });
    loader(key.split(","))
      .then((items) => live && setState({ kind: "done", items }))
      .catch((err: unknown) => live && setState({ kind: "error", message: err instanceof Error ? err.message : "The evidence did not load." }));
    return () => {
      live = false;
    };
  }, [open, evidence, loader, key, attempt]);

  const count = evidenceIds.length;
  const name = `Show evidence${label ? ` for ${label}` : ""} (${count} ${count === 1 ? "source" : "sources"})`;
  let body: ReactNode;
  if (state.kind === "loading" || state.kind === "idle") body = <LoadingState label="Loading evidence" rows={3} />;
  else if (state.kind === "error") body = <ErrorState title="The evidence did not load" description={state.message} onRetry={() => setAttempt((a) => a + 1)} />;
  else if (state.items.length === 0) body = <EmptyState title="No evidence found" description={`Evidence ids: ${evidenceIds.join(", ")}`} />;
  else
    body = (
      <ol className="sds-evidence-list">
        {state.items.map((e) => (
          <li key={e.id}>
            <EvidenceQuote evidence={e} />
          </li>
        ))}
      </ol>
    );

  return (
    <>
      <button type="button" className="sds-provenance" aria-label={name} title={name} onClick={() => setOpen(true)} aria-haspopup="dialog" data-evidence-ids={key}>
        <Icon name="evidence" size="sm" />
        {count > 1 && <span className="sds-provenance__count sds-num">{count}</span>}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={label ? `Evidence: ${label}` : "Evidence"} inline={inline}>
        {body}
      </Drawer>
    </>
  );
}

export interface FactProps {
  /** At least one evidence id. The type rejects an empty list at compile time. */
  evidenceIds: EvidenceIds;
  children: ReactNode;
  label?: string;
  evidence?: Evidence[];
  className?: string;
  defaultOpen?: boolean;
  inline?: boolean;
}

/** A fact on the screen: the value and its provenance control. */
export function Fact({ evidenceIds, children, label, evidence, className, defaultOpen, inline }: FactProps) {
  if (evidenceIds.length === 0) {
    throw new Error("Fact: a fact needs at least one evidence id (docs/07 rule 2).");
  }
  return (
    <span className={cx("sds-fact", className)}>
      <span className="sds-fact__value">{children}</span>
      <ProvenanceControl evidenceIds={evidenceIds} evidence={evidence} label={label} defaultOpen={defaultOpen} inline={inline} />
    </span>
  );
}
