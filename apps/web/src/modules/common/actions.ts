// One name for each action through the whole flow (docs/07 rule 5, docs/api-contract.md "Action names").
// The button text and the message after success come only from this table.
import { useToast } from "@strata/design-system";
import { useCallback, useState } from "react";

export const ACTIONS = {
  approve: { button: "Approve", done: "Approved" },
  reject: { button: "Reject", done: "Rejected" },
  editApprove: { button: "Edit and approve", done: "Edited and approved" },
  acknowledge: { button: "Acknowledge", done: "Acknowledged" },
  confirm: { button: "Confirm", done: "Confirmed" },
  dismiss: { button: "Dismiss", done: "Dismissed" },
  move: { button: "Move to stage", done: "Moved, pending approval" },
  addContact: { button: "Add contact", done: "Contact added" },
  logTouchpoint: { button: "Log touchpoint", done: "Touchpoint logged" },
  setNextAction: { button: "Set next action", done: "Next action set" },
  prequalification: { button: "Set prequalification status", done: "Prequalification status set" },
  activate: { button: "Activate", done: "Activated" },
  createVersion: { button: "Create version", done: "Version created" },
} as const;

export type ActionKey = keyof typeof ACTIONS;

/**
 * Run a write and show the result. It gives true after success. Success gives the message of the action. Failure gives the API message.
 * `busy` holds the key of the running action, so its button can show the loading state.
 */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async (action: ActionKey, fn: () => Promise<unknown>, opts: { busyKey?: string; description?: string } = {}): Promise<boolean> => {
      const key = opts.busyKey ?? action;
      setBusy(key);
      try {
        await fn();
        toast.show({ title: ACTIONS[action].done, description: opts.description, tone: "positive" });
        return true;
      } catch (err) {
        toast.show({ title: `${ACTIONS[action].button} did not complete`, description: err instanceof Error ? err.message : undefined, tone: "negative" });
        return false;
      } finally {
        setBusy((b) => (b === key ? null : b));
      }
    },
    [toast],
  );
  return { run, busy };
}
