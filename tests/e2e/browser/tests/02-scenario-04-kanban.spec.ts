// docs/09 scenario 4 (UI part) and stop condition 5 (an approver approves a proposal in the UI).
// An analyst drags a Kanban card to the next stage. The card shows "Pending approval". An approver approves the
// proposal in the approval queue. The card moves in the analyst's board by the live update. The timeline shows the
// event, and the deal evidence opens from it. The "as of" view for the previous day shows the old state.
// The deal is the prequalification opportunity of the Konkola Deep plan (mining wire). An approver approves its
// DealIdentified proposal through the API first.
import { expect, test } from "@playwright/test";
import { addPanel, apiGet, apiPost, approvedDeal, login, moduleReady, toast, type Deal } from "../support/stack";

const yesterdayUtc = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

test("scenario 4: a Kanban drag gives Pending approval, an approver approves in the queue, the timeline shows the event and as of the previous day shows the old stage", async ({ page, browser }) => {
  let deal = await approvedDeal("mining/2026/09/kcm-konkola-deep-plan", "Konkola Deep", "Prequalification:");
  // A run that stopped half way can leave a pending move. An approver rejects it, so the card starts clean.
  if (deal.pending_proposal_id) {
    await apiPost(`/api/proposals/${deal.pending_proposal_id}/reject`, "approver", { reason: "E2E: clean start" });
    deal = (await apiGet<{ items: Deal[] }>("/api/deals")).items.find((d) => d.id === deal.id)!;
  }
  const stages = (await apiGet<{ deal_stages: Array<{ code: string; name: string }> }>("/api/config/stages")).deal_stages;
  const from = stages.find((s) => s.code === deal.stage)!;
  const to = stages[stages.indexOf(from) + 1]!;
  await login(page, "analyst", "relationships");
  const k = await moduleReady(page, "kanban");
  const card = k.locator(`[data-card-id="${deal.id}"]`);
  await expect(k.locator(`[data-column-id="${from.code}"] [data-card-id="${deal.id}"]`)).toBeVisible();
  await expect(card).not.toContainText("Pending approval");

  await card.dragTo(k.locator(`[data-column-id="${to.code}"]`));
  await expect(toast(page, "Moved, pending approval")).toBeVisible();
  await expect(card).toContainText("Pending approval");
  await expect(k.locator(`[data-column-id="${from.code}"] [data-card-id="${deal.id}"]`)).toBeVisible();
  const pending = await apiGet<{ items: Deal[] }>("/api/deals");
  const proposalId = pending.items.find((d) => d.id === deal.id)!.pending_proposal_id!;
  expect(proposalId).toBeTruthy();

  // The approver approves in the approval queue (another browser context, a real login).
  const approverContext = await browser.newContext();
  const approver = await approverContext.newPage();
  await login(approver, "approver", "review");
  const queue = await moduleReady(approver, "approval-queue");
  const item = queue.locator(`[data-proposal-id="${proposalId}"]`);
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(toast(approver, "Approved")).toBeVisible();
  await expect(item).toHaveCount(0);
  await approverContext.close();

  // The analyst's board gets the change by the live update, with no reload.
  await expect(k.locator(`[data-column-id="${to.code}"] [data-card-id="${deal.id}"]`)).toBeVisible();
  await expect(card).not.toContainText("Pending approval");

  // The timeline shows the event. The deal evidence opens from the timeline.
  await card.click();
  await addPanel(page, "timeline");
  const t = await moduleReady(page, "timeline");
  await expect(t.locator("[data-timeline-state]")).toHaveAttribute("data-timeline-state", to.code);
  const change = t.locator(`[data-event-type="DealStageChanged"]`, { hasText: `Approved proposal ${proposalId}` });
  await expect(change).toContainText(from.name);
  await expect(change).toContainText(to.name);
  await expect(change).toContainText(`Approved proposal ${proposalId}`);
  const identified = t.locator('[data-event-type="DealIdentified"]').first();
  await identified.getByRole("button", { name: /Show evidence/ }).click();
  const drawer = page.getByRole("dialog", { name: /Evidence/ });
  await expect(drawer.locator("mark.sds-evidence__span")).toBeVisible();
  await expect(drawer.getByRole("link", { name: /Open source/ })).toHaveAttribute("href", /kcm-konkola-deep-plan/);
  await page.keyboard.press("Escape");

  // The "as of" view for the previous day: the stage change is not there, and the state is the old one. On a new
  // stack the deal did not exist the day before, so the old state is empty (assumption 163 and 200).
  await t.getByLabel("As of").fill(yesterdayUtc());
  await expect(t.locator('[data-event-type="DealStageChanged"]')).toHaveCount(0);
  const old = await t.locator("[data-timeline-state]").getAttribute("data-timeline-state");
  expect(["", "signal", from.code]).toContain(old);
  await t.getByRole("button", { name: "Show now" }).click();
  await expect(t.locator("[data-timeline-state]")).toHaveAttribute("data-timeline-state", to.code);
});
