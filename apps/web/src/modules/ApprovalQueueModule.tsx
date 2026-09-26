// Approval queue: the pending proposals with their evidence (GET /api/proposals?status=pending, M4). Each evidence
// item shows the quote with the span highlighted and a link to the source (docs/06). Approvers approve, reject
// (a reason is required) or edit and approve. A user never approves an own proposal (docs/06), so the queue hides
// Approve and Edit and approve for the creator. The API enforces it. Live.
import { Badge, Button, type Column, DataTable, EvidenceQuote, FeedItem, Modal, StatusBadge, TextArea } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useMemo, useState } from "react";
import type { EvidenceItem } from "../api/types";
import { approveProposal, type EditedEvent, editApproveProposal, getProposals, type Proposal, type ProposedEvent, rejectProposal } from "../api/writes";
import { useSession } from "../auth/AuthContext";
import { useCan } from "../auth/RequireRole";
import { moduleConfig } from "../config/modules";
import { useResource } from "../data/resource";
import { ACTIONS, useAction } from "./common/actions";
import { type EvidenceLike, toEvidence, useApi } from "./common/api";
import { certaintyStatus, formatDateTime, humanise, shortValue, tierBadge } from "./common/format";
import { ModuleRoot, resourceState, SectionHeading } from "./common/ui";

const cfg = moduleConfig["approval-queue"];

type Dialog = { kind: "reject" | "editApprove"; proposal: Proposal } | null;

const eventColumns: Column<ProposedEvent & { i: number }>[] = [
  { id: "type", header: "Event", value: (e) => humanise(e.event_type), sortable: false },
  {
    id: "payload",
    header: "Change",
    value: (e) =>
      Object.entries(e.payload)
        .map(([k, v]) => `${humanise(k)}: ${shortValue(v, 60)}`)
        .join(", "),
    sortable: false,
  },
  { id: "certainty", header: "Certainty", value: (e) => e.certainty ?? "", cell: (e) => (certaintyStatus(e.certainty) ? <StatusBadge status={certaintyStatus(e.certainty)!} /> : humanise(e.certainty)), sortable: false },
];

export function ApprovalQueueModule(_: PanelProps) {
  const { http, reads } = useApi();
  const session = useSession();
  const canDecide = useCan("approver");
  const { run, busy } = useAction();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState("");
  const [eventsText, setEventsText] = useState("");
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const r = useResource<Proposal[]>(
    `proposals:${cfg.status}`,
    async () => {
      const res = await getProposals(http, cfg.status);
      return res.items;
    },
    { live: cfg.live.events, batchMs: cfg.live.batchMs },
  );
  const proposals = useMemo(() => r.data ?? [], [r.data]);

  // The proposal gives its evidence items (quote, offsets, source link). GET /api/evidence adds the text around the
  // span for a source with licence full, so the queue loads the items of every listed proposal in one request.
  const allIds = useMemo(() => [...new Set(proposals.flatMap((p) => [...p.evidence.map((e) => e.id), ...p.events.flatMap((e) => e.evidence_ids)]))].sort(), [proposals]);
  const ev = useResource<{ items: EvidenceItem[] }>(allIds.length ? `evidence:${allIds.join(",")}` : null, () => reads.evidence(allIds));
  const evidenceById = useMemo(() => {
    const m = new Map<string, EvidenceLike>();
    for (const p of proposals) for (const e of p.evidence) m.set(e.id, e);
    for (const e of ev.data?.items ?? []) m.set(e.id, e);
    return m;
  }, [ev.data, proposals]);

  const decide = async (kind: "approve" | "reject" | "editApprove", p: Proposal, fn: () => Promise<unknown>) => {
    const ok = await run(kind, fn, { busyKey: `${kind}:${p.id}`, description: p.title });
    if (ok) {
      setDialog(null);
      r.mutate((list) => list?.filter((x) => x.id !== p.id));
      void r.reload();
    }
  };

  const openDialog = (kind: "reject" | "editApprove", p: Proposal) => {
    setDialog({ kind, proposal: p });
    setReason("");
    setFormError(undefined);
    // Edit and approve changes the payload and the certainty of each event. The stream, the type and the evidence stay.
    setEventsText(JSON.stringify(p.events.map((e) => ({ event_type: e.event_type, payload: e.payload, certainty: e.certainty ?? null })), null, 2));
  };

  const submitDialog = () => {
    if (!dialog) return;
    const p = dialog.proposal;
    if (dialog.kind === "reject") {
      if (!reason.trim()) {
        setFormError("Give a reason. A rejection needs a reason.");
        return;
      }
      void decide("reject", p, () => rejectProposal(http, p.id, reason.trim()));
      return;
    }
    let events: EditedEvent[];
    try {
      const parsed = JSON.parse(eventsText) as Array<Partial<ProposedEvent>>;
      if (!Array.isArray(parsed) || parsed.length !== p.events.length) throw new Error("not a list");
      events = parsed.map((e) => ({ payload: e.payload ?? null, certainty: e.certainty ?? null }));
    } catch {
      setFormError(`Give the events as a JSON list with ${p.events.length} ${p.events.length === 1 ? "entry" : "entries"}.`);
      return;
    }
    void decide("editApprove", p, () => editApproveProposal(http, p.id, events));
  };

  const s = resourceState(r, { label: "approval queue", empty: proposals.length === 0, emptyTitle: "No proposals wait for approval" });
  return (
    <ModuleRoot id="approval-queue" state={s.state}>
      {s.node ?? (
        <ul className="strata-module__fill strata-list" aria-label="Proposals" aria-busy={r.refreshing || undefined}>
          {proposals.map((p) => {
            const own = p.created_by_me || p.created_by === session.user.id;
            const ids = [...new Set([...p.evidence.map((e) => e.id), ...p.events.flatMap((e) => e.evidence_ids)])];
            return (
              <li key={p.id} data-proposal-id={p.id} className="strata-proposal">
                <FeedItem
                  title={p.title}
                  source={`${humanise(p.kind)} · ${humanise(p.created_by_type)} ${p.created_by}${p.model_id ? ` · ${p.model_id}` : ""}`}
                  time={formatDateTime(p.created_at)}
                  dateTime={p.created_at}
                  tier={p.tier !== null ? tierBadge(p.tier) : undefined}
                  status="pending_approval"
                  summary={p.summary ?? undefined}
                  tags={own ? ["You created this proposal"] : undefined}
                  actions={
                    canDecide && (
                      <>
                        {!own && (
                          <Button size="sm" variant="primary" loading={busy === `approve:${p.id}`} onClick={() => void decide("approve", p, () => approveProposal(http, p.id))}>
                            {ACTIONS.approve.button}
                          </Button>
                        )}
                        <Button size="sm" variant="danger" loading={busy === `reject:${p.id}`} onClick={() => openDialog("reject", p)}>
                          {ACTIONS.reject.button}
                        </Button>
                        {!own && (
                          <Button size="sm" loading={busy === `editApprove:${p.id}`} onClick={() => openDialog("editApprove", p)}>
                            {ACTIONS.editApprove.button}
                          </Button>
                        )}
                      </>
                    )
                  }
                />
                <div className="strata-proposal__detail strata-stack">
                  <DataTable label={`Proposed events of ${p.title}`} toolbar={false} className="strata-kv" columns={eventColumns} rows={p.events.map((e, i) => ({ ...e, i }))} getRowId={(e) => String(e.i)} />
                  <SectionHeading>{`Evidence (${ids.length})`}</SectionHeading>
                  {ids.length === 0 ? (
                    <div>
                      <Badge tone="warning">No evidence</Badge>
                    </div>
                  ) : (
                    <ol className="strata-list strata-stack">
                      {ids.map((id) => {
                        const e = evidenceById.get(id);
                        return <li key={id}>{e ? <EvidenceQuote evidence={toEvidence(e)} /> : <span className="strata-muted">{ev.loading ? "Loading evidence" : `Evidence ${id}`}</span>}</li>;
                      })}
                    </ol>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog ? ACTIONS[dialog.kind].button : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant={dialog?.kind === "reject" ? "danger" : "primary"} onClick={submitDialog}>
              {dialog ? ACTIONS[dialog.kind].button : ""}
            </Button>
          </>
        }
      >
        <div className="strata-stack">
          <p className="strata-muted">{dialog?.proposal.title}</p>
          {dialog?.kind === "reject" ? (
            <TextArea label="Reason" rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} error={formError} />
          ) : (
            <TextArea
              label="Events (JSON)"
              hint="Change the values. The original evidence stays with the events."
              code
              rows={12}
              value={eventsText}
              onChange={(e) => setEventsText(e.target.value)}
              error={formError}
            />
          )}
        </div>
      </Modal>
    </ModuleRoot>
  );
}
