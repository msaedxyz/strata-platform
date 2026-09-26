// Relationship panel: for the selected opportunity, the buyer roles, contacts, touchpoints, next action and
// prequalification status (GET /api/deals/{id}/relationship). Analysts add contacts, log touchpoints, set the next
// action and the prequalification status (M4 write endpoints). Live.
// Engagement rows are human events. The team is the source, so they have no evidence (docs/03).
import { Button, type Column, DataTable, DatePicker, EmptyState, Modal, Select, StatusBadge, Tabs, TextArea, TextInput } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import type { Engagement, Relationship, RelationshipResponse } from "../api/types";
import { addContact, logTouchpoint, type PrequalificationStatus, setNextAction, setPrequalification, type TouchpointKind } from "../api/writes";
import { useSession } from "../auth/AuthContext";
import { useCan } from "../auth/RequireRole";
import { moduleConfig } from "../config/modules";
import { useResource } from "../data/resource";
import { ACTIONS, type ActionKey, useAction } from "./common/actions";
import { useApi, useStages } from "./common/api";
import { certaintyStatus, formatDate, formatDateTime, humanise, nameOf, todayIso } from "./common/format";
import { KeyValues } from "./common/KeyValues";
import { useSelection } from "./common/selection";
import { DealStageText, FactValue, ModuleRoot, resourceState } from "./common/ui";
import { useDeals } from "./KanbanModule";

const cfg = moduleConfig["relationship-panel"];

const TOUCHPOINT_KINDS: TouchpointKind[] = ["call", "meeting", "email", "site_visit"];
const PREQUAL: PrequalificationStatus[] = ["not_started", "submitted", "approved", "rejected"];

type FormKind = "addContact" | "logTouchpoint" | "setNextAction" | "prequalification";

const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

/** The personal fields of a contact. After an erasure they are gone and the row shows "Erased" (docs/06). */
function contactName(e: Engagement): string {
  const p = (e.data.personal ?? {}) as Record<string, unknown>;
  return str(p.name ?? e.data.name) || "Erased";
}

export function RelationshipPanelModule(_: PanelProps) {
  const { reads, http } = useApi();
  const session = useSession();
  const stages = useStages();
  const deals = useDeals();
  const canWrite = useCan("analyst");
  const { run, busy } = useAction();
  const { deal: selected, select } = useSelection();
  const [form, setForm] = useState<FormKind | null>(null);
  const dealId = selected?.id ?? null;
  const r = useResource<RelationshipResponse>(dealId ? `relationship:${dealId}` : null, () => reads.relationship(dealId!), {
    live: cfg.live.events,
    batchMs: cfg.live.batchMs,
    liveFilter: (e) => !e.stream_id || e.stream_id === dealId || e.stream_type !== "deal",
  });
  const stageName = (c: string) => nameOf(stages.data?.deal_stages, c);

  const dealOptions = useMemo(
    () => [{ value: "", label: "Choose an opportunity" }, ...(deals.data?.items ?? []).map((d) => ({ value: d.id, label: d.title }))],
    [deals.data],
  );

  const picker = (
    <Select
      label="Opportunity"
      hideLabel
      value={dealId ?? ""}
      options={dealOptions}
      onChange={(e) => {
        const d = deals.data?.items.find((x) => x.id === e.target.value);
        if (d) select({ kind: "deal", id: d.id, label: d.title });
      }}
    />
  );

  if (!dealId) {
    return (
      <ModuleRoot id="relationship-panel" state="empty">
        <div className="strata-module__toolbar">{picker}</div>
        <EmptyState title="No opportunity selected" description="Select an opportunity on the Kanban board, the priority list or the next actions." icon="users" />
      </ModuleRoot>
    );
  }

  const s = resourceState(r, { label: "relationship" });
  const d = r.data;
  const buyers = d?.buyer_roles ?? [];

  const submit = async (action: ActionKey, fn: () => Promise<unknown>) => {
    const ok = await run(action, fn, { description: d?.deal.title });
    if (ok) {
      setForm(null);
      void r.reload();
    }
  };

  const buyerColumns: Column<Relationship>[] = [
    { id: "role", header: "Buyer role", value: (x) => humanise(x.predicate.replace(/^buyer_role_/, "")) },
    {
      id: "org",
      header: "Organisation",
      value: (x) => x.organisation_name ?? x.object_id,
      cell: (x) => (
        <FactValue ids={x.evidence_ids} label={`${humanise(x.predicate.replace(/^buyer_role_/, ""))}: ${x.organisation_name ?? x.object_id}`}>
          {x.organisation_name ?? x.object_id}
        </FactValue>
      ),
    },
    { id: "certainty", header: "Certainty", value: (x) => x.certainty ?? "", cell: (x) => (certaintyStatus(x.certainty) ? <StatusBadge status={certaintyStatus(x.certainty)!} /> : humanise(x.certainty)) },
  ];
  const contactColumns: Column<Engagement>[] = [
    { id: "name", header: "Name", value: contactName },
    { id: "role", header: "Role", value: (x) => str(x.data.role) },
    { id: "org", header: "Organisation", value: (x) => buyers.find((b) => b.object_id === x.data.organisation_id)?.organisation_name ?? str(x.data.organisation_id) },
    { id: "via", header: "Found via", value: (x) => str(x.data.found_via) },
    { id: "added", header: "Added", value: (x) => x.recorded_at, cell: (x) => formatDate(x.recorded_at) },
  ];
  const touchColumns: Column<Engagement>[] = [
    { id: "date", header: "Date", value: (x) => str(x.data.date), cell: (x) => formatDate(str(x.data.date)) },
    { id: "kind", header: "Kind", value: (x) => humanise(str(x.data.kind)) },
    { id: "note", header: "Note", value: (x) => str(x.data.note) },
    { id: "by", header: "Logged by", value: (x) => x.actor_id },
  ];
  const prequalColumns: Column<Engagement>[] = [
    { id: "buyer", header: "Buyer", value: (x) => buyers.find((b) => b.object_id === x.data.buyer_id)?.organisation_name ?? str(x.data.buyer_id) },
    { id: "status", header: "Status", value: (x) => humanise(str(x.data.status)) },
    { id: "at", header: "Changed", value: (x) => x.recorded_at, cell: (x) => formatDateTime(x.recorded_at) },
  ];

  const next = d?.next_action;
  const actionButton = (kind: FormKind) =>
    canWrite && (
      <Button size="sm" icon="add" loading={busy === kind} onClick={() => setForm(kind)}>
        {ACTIONS[kind].button}
      </Button>
    );

  return (
    <ModuleRoot id="relationship-panel" state={s.state}>
      <div className="strata-module__toolbar">
        {picker}
        {d && <DealStageText stage={d.deal.stage} pending={d.deal.stage_pending} names={stageName} />}
      </div>
      {s.node ??
        (d && (
          <Tabs
            label="Relationship"
            className="strata-tabs"
            items={[
              {
                id: "buyers",
                label: "Buyer roles",
                count: buyers.length,
                content: <DataTable label="Buyer roles" toolbar={false} columns={buyerColumns} rows={buyers} getRowId={(x) => x.event_id} emptyTitle="No buyer roles yet" />,
              },
              {
                id: "contacts",
                label: "Contacts",
                count: d.contacts.length,
                content: (
                  <div className="strata-stack">
                    <div className="strata-inline">{actionButton("addContact")}</div>
                    <DataTable label="Contacts" toolbar={false} columns={contactColumns} rows={d.contacts} getRowId={(x) => x.event_id} emptyTitle="No contact found" />
                  </div>
                ),
              },
              {
                id: "touchpoints",
                label: "Touchpoints",
                count: d.touchpoints.length,
                content: (
                  <div className="strata-stack">
                    <div className="strata-inline">{actionButton("logTouchpoint")}</div>
                    <DataTable label="Touchpoints" toolbar={false} columns={touchColumns} rows={d.touchpoints} getRowId={(x) => x.event_id} emptyTitle="No touchpoints" />
                  </div>
                ),
              },
              {
                id: "next",
                label: "Next action",
                content: (
                  <div className="strata-stack" data-next-action>
                    <div className="strata-inline">{actionButton("setNextAction")}</div>
                    {next ? (
                      <KeyValues
                        label="Next action"
                        rows={[
                          { id: "action", label: "Action", value: str(next.data.action) },
                          { id: "owner", label: "Owner", value: str(next.data.owner_user_id) },
                          { id: "due", label: "Due", value: formatDate(str(next.data.due_date)) },
                          { id: "set", label: "Set", value: `${formatDateTime(next.recorded_at)} by ${next.actor_id}` },
                        ]}
                      />
                    ) : (
                      <EmptyState title="No next action" />
                    )}
                  </div>
                ),
              },
              {
                id: "prequal",
                label: "Prequalification",
                count: d.prequalification.length,
                content: (
                  <div className="strata-stack">
                    <div className="strata-inline">{actionButton("prequalification")}</div>
                    <DataTable label="Prequalification status" toolbar={false} columns={prequalColumns} rows={d.prequalification} getRowId={(x) => x.event_id} emptyTitle="Not started" />
                  </div>
                ),
              },
            ]}
          />
        ))}
      {d && (
        <EngagementForm
          kind={form}
          onClose={() => setForm(null)}
          buyers={buyers}
          contacts={d.contacts}
          userId={session.user.id}
          onSubmit={(kind, body) => {
            if (kind === "addContact") return submit(kind, () => addContact(http, dealId, body as never));
            if (kind === "logTouchpoint") return submit(kind, () => logTouchpoint(http, dealId, body as never));
            if (kind === "setNextAction") return submit(kind, () => setNextAction(http, dealId, body as never));
            return submit(kind, () => setPrequalification(http, dealId, body as never));
          }}
        />
      )}
    </ModuleRoot>
  );
}

interface FormProps {
  kind: FormKind | null;
  onClose: () => void;
  buyers: Relationship[];
  contacts: Engagement[];
  userId: string;
  onSubmit: (kind: FormKind, body: Record<string, unknown>) => Promise<void>;
}

/** One modal for the four engagement forms. Each field that the API needs is required here too. */
function EngagementForm({ kind, onClose, buyers, contacts, userId, onSubmit }: FormProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastKind, setLastKind] = useState<FormKind | null>(null);
  if (kind !== lastKind) {
    setLastKind(kind);
    setValues(kind === "logTouchpoint" ? { kind: "call", date: todayIso() } : kind === "setNextAction" ? { owner_user_id: userId } : kind === "prequalification" ? { status: "submitted", buyer_id: buyers[0]?.object_id ?? "" } : {});
    setErrors({});
  }
  const v = (k: string) => values[k] ?? "";
  const set = (k: string) => (e: { target: { value: string } }) => setValues((x) => ({ ...x, [k]: e.target.value }));
  const setDate = (k: string) => (value: string) => setValues((x) => ({ ...x, [k]: value }));
  const buyerOptions = buyers.map((b) => ({ value: b.object_id, label: `${b.organisation_name ?? b.object_id} (${humanise(b.predicate.replace(/^buyer_role_/, ""))})` }));

  const required: Record<FormKind, string[]> = {
    addContact: ["name", "role", "found_via"],
    logTouchpoint: ["kind", "date", "note"],
    setNextAction: ["action", "owner_user_id", "due_date"],
    prequalification: ["buyer_id", "status"],
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!kind) return;
    const missing = Object.fromEntries(required[kind].filter((k) => !v(k).trim()).map((k) => [k, "Give a value"]));
    setErrors(missing);
    if (Object.keys(missing).length) return;
    const body: Record<string, unknown> =
      kind === "addContact"
        ? { name: v("name"), role: v("role"), organisation_id: v("organisation_id") || null, email: v("email") || undefined, phone: v("phone") || undefined, found_via: v("found_via") }
        : kind === "logTouchpoint"
          ? { kind: v("kind"), date: v("date"), note: v("note"), contact_id: v("contact_id") || null }
          : kind === "setNextAction"
            ? { action: v("action"), owner_user_id: v("owner_user_id"), due_date: v("due_date") }
            : { buyer_id: v("buyer_id"), status: v("status") };
    await onSubmit(kind, body);
  };

  let fields: ReactNode = null;
  if (kind === "addContact")
    fields = (
      <>
        <TextInput label="Name" value={v("name")} onChange={set("name")} error={errors.name} required />
        <TextInput label="Role" value={v("role")} onChange={set("role")} error={errors.role} required hint="For example procurement manager" />
        <Select label="Organisation" value={v("organisation_id")} onChange={set("organisation_id")} options={buyerOptions} placeholder="No organisation" />
        <TextInput label="Business email" type="email" value={v("email")} onChange={set("email")} />
        <TextInput label="Business phone" type="tel" value={v("phone")} onChange={set("phone")} />
        <TextInput label="Found via" value={v("found_via")} onChange={set("found_via")} error={errors.found_via} required hint="For example a supplier day or a referral" />
      </>
    );
  else if (kind === "logTouchpoint")
    fields = (
      <>
        <Select label="Kind" value={v("kind")} onChange={set("kind")} options={TOUCHPOINT_KINDS.map((k) => ({ value: k, label: humanise(k) }))} />
        <DatePicker label="Date" value={v("date")} onChange={setDate("date")} error={errors.date} required />
        <Select label="Contact" value={v("contact_id")} onChange={set("contact_id")} placeholder="No contact" options={contacts.map((c) => ({ value: str(c.data.contact_id) || c.event_id, label: contactName(c) }))} />
        <TextArea label="Note" rows={3} maxLength={2000} value={v("note")} onChange={set("note")} error={errors.note} required />
      </>
    );
  else if (kind === "setNextAction")
    fields = (
      <>
        <TextInput label="Action" value={v("action")} onChange={set("action")} error={errors.action} required />
        <TextInput label="Owner (user id)" value={v("owner_user_id")} onChange={set("owner_user_id")} error={errors.owner_user_id} required />
        <DatePicker label="Due date" value={v("due_date")} onChange={setDate("due_date")} error={errors.due_date} required />
      </>
    );
  else if (kind === "prequalification")
    fields = (
      <>
        <Select label="Buyer" value={v("buyer_id")} onChange={set("buyer_id")} options={buyerOptions} error={errors.buyer_id} placeholder="Choose a buyer" />
        <Select label="Status" value={v("status")} onChange={set("status")} options={PREQUAL.map((p) => ({ value: p, label: humanise(p) }))} />
      </>
    );

  const title = kind ? ACTIONS[kind].button : "";
  return (
    <Modal
      open={kind !== null}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="strata-engagement-form">
            {title}
          </Button>
        </>
      }
    >
      <form id="strata-engagement-form" className="strata-form" onSubmit={(e) => void submit(e)} noValidate>
        {fields}
      </form>
    </Modal>
  );
}
