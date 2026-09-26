// Tier 0 alerts: the alert feed with the status badge. Acknowledge (analyst), Confirm and Dismiss (approver). Live.
// A Tier 0 alert appears as Unconfirmed before any approval (docs/06).
import { Button, Checkbox, FeedItem, Modal, TextArea } from "@strata/design-system";
import type { PanelProps } from "@strata/panel-framework";
import { useState } from "react";
import type { Alert } from "../api/types";
import { acknowledgeAlert, confirmAlert, dismissAlert } from "../api/writes";
import { useCan } from "../auth/RequireRole";
import { moduleConfig } from "../config/modules";
import { useResource } from "../data/resource";
import { ACTIONS, useAction } from "./common/actions";
import { evidenceIds, useApi } from "./common/api";
import { formatDateTime, humanise, tierBadge } from "./common/format";
import { ModuleRoot, resourceState } from "./common/ui";

const cfg = moduleConfig["tier0-alerts"];

type Decision = { kind: "confirm" | "dismiss"; alert: Alert } | null;

export function AlertsModule(_: PanelProps) {
  const { reads, http } = useApi();
  const canAck = useCan("analyst");
  const canDecide = useCan("approver");
  const { run, busy } = useAction();
  const r = useResource<{ items: Alert[] }>(`alerts:tier=${cfg.tier}`, () => reads.alerts({ tier: cfg.tier, limit: cfg.limit }), {
    live: cfg.live.events,
    batchMs: cfg.live.batchMs,
  });
  const [decision, setDecision] = useState<Decision>(null);
  const [reason, setReason] = useState("");
  const [falsePositive, setFalsePositive] = useState(false);
  const items = r.data?.items ?? [];
  const s = resourceState(r, { label: "alerts", empty: items.length === 0, emptyTitle: "No Tier 0 alerts", emptyDescription: "A new Tier 0 alert shows here at once, as Unconfirmed." });

  const openDecision = (kind: "confirm" | "dismiss", alert: Alert) => {
    setDecision({ kind, alert });
    setReason("");
    setFalsePositive(false);
  };

  const submitDecision = async () => {
    if (!decision) return;
    const { kind, alert } = decision;
    setDecision(null);
    const ok =
      kind === "confirm"
        ? await run("confirm", () => confirmAlert(http, alert.id, reason), { busyKey: `confirm:${alert.id}`, description: alert.title })
        : await run("dismiss", () => dismissAlert(http, alert.id, reason, falsePositive), { busyKey: `dismiss:${alert.id}`, description: alert.title });
    if (ok) void r.reload();
  };

  const acknowledge = async (alert: Alert) => {
    const ok = await run("acknowledge", () => acknowledgeAlert(http, alert.id), { busyKey: `ack:${alert.id}`, description: alert.title });
    if (ok) void r.reload();
  };

  return (
    <ModuleRoot id="tier0-alerts" state={s.state}>
      {s.node ?? (
        <div className="strata-module__fill" role="feed" aria-label="Tier 0 alerts" aria-busy={r.refreshing || undefined}>
          {items.map((a) => {
            const open = a.status === "unconfirmed";
            const actions = (
              <>
                {canAck && !a.acknowledged_at && (
                  <Button size="sm" loading={busy === `ack:${a.id}`} onClick={() => void acknowledge(a)}>
                    {ACTIONS.acknowledge.button}
                  </Button>
                )}
                {canDecide && open && (
                  <>
                    <Button size="sm" variant="primary" loading={busy === `confirm:${a.id}`} onClick={() => openDecision("confirm", a)}>
                      {ACTIONS.confirm.button}
                    </Button>
                    <Button size="sm" variant="ghost" loading={busy === `dismiss:${a.id}`} onClick={() => openDecision("dismiss", a)}>
                      {ACTIONS.dismiss.button}
                    </Button>
                  </>
                )}
              </>
            );
            return (
              <FeedItem
                key={a.id}
                data-alert-id={a.id}
                title={a.title}
                source={a.publisher ?? humanise(a.tier_rule)}
                time={formatDateTime(a.raised_at)}
                dateTime={a.raised_at}
                tier={tierBadge(a.tier)}
                status={a.status}
                evidenceIds={evidenceIds(a.evidence_ids) ?? undefined}
                tags={[humanise(a.tier_rule), ...(a.acknowledged_at ? [`Acknowledged ${formatDateTime(a.acknowledged_at)}`] : [])]}
                summary={a.decision_reason ? `Reason: ${a.decision_reason}` : undefined}
                actions={actions}
              />
            );
          })}
        </div>
      )}
      <Modal
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision?.kind === "confirm" ? `${ACTIONS.confirm.button} alert` : `${ACTIONS.dismiss.button} alert`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecision(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void submitDecision()}>
              {decision?.kind === "confirm" ? ACTIONS.confirm.button : ACTIONS.dismiss.button}
            </Button>
          </>
        }
      >
        <div className="strata-stack">
          <p className="strata-muted">{decision?.alert.title}</p>
          <TextArea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          {decision?.kind === "dismiss" && <Checkbox label="False positive" checked={falsePositive} onChange={(e) => setFalsePositive(e.target.checked)} />}
        </div>
      </Modal>
    </ModuleRoot>
  );
}
