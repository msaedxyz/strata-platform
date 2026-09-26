// Live updates on the real stack.
// 1. A new Tier 0 alert appears live in the Tier 0 alerts module with the status Unconfirmed (docs/06 criterion 4).
// 2. docs/07 criterion 5: a new event appears in its live module 2 s or less after the database commit.
//    a. Kanban: another analyst moves a card through the API. The time runs from the start of the request, which is
//       before the commit, to the moment when the card shows "Pending approval". This bound is above the true delay.
//    b. Tier 0 alert: an analyst uploads a document. The worker enriches it and commits the alert. The time runs from
//       raised_at (set in the transaction, before the commit) to the moment when the alert is in the module.
// The page records the time of each new element with a MutationObserver. The browser, the database and the API
// share the clock of the host.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { API_URL, REPO_ROOT, apiGet, apiPost, approvedDeal, login, moduleReady, token, waitFor, type Deal } from "../support/stack";

const LIMIT_MS = 2000;
const OUT = process.env.E2E_RESULTS_DIR ?? join(REPO_ROOT, "test-results", "e2e");

function record(name: string, data: unknown) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `live-${name}.json`), JSON.stringify(data, null, 2));
}

/** Record the time at which each element that matches `selector` first appears in `root`. */
async function watch(page: Page, root: string, selector: string, attr: string) {
  await page.evaluate(({ root, selector, attr }) => {
    const w = window as unknown as { __seen: Record<string, number> };
    w.__seen = {};
    const scan = () => {
      document.querySelectorAll(`${root} ${selector}`).forEach((el) => {
        const id = el.getAttribute(attr);
        if (id && !(id in w.__seen)) w.__seen[id] = Date.now();
      });
    };
    scan();
    // Elements that are there now are not new.
    Object.keys(w.__seen).forEach((k) => (w.__seen[k] = 0));
    new MutationObserver(scan).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  }, { root, selector, attr });
}

const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: Record<string, number> }).__seen);

test("criterion 5 (Kanban): a stage move by another analyst shows Pending approval on the card in 2 s or less", async ({ page }) => {
  const deal = await approvedDeal("deals/2026/09/kcm-sale-process-nchanga-diesel", "KCM starts sale process", "Fuel supply contract:");
  await login(page, "analyst", "relationships");
  const k = await moduleReady(page, "kanban");
  const card = k.locator(`[data-card-id="${deal.id}"]`);
  await expect(card).toBeVisible();
  await expect(card).not.toContainText("Pending approval");
  await page.evaluate((id) => {
    const w = window as unknown as { __pendingAt?: number };
    const check = () => {
      const el = document.querySelector(`[data-card-id="${id}"]`);
      if (!w.__pendingAt && el?.textContent?.includes("Pending approval")) w.__pendingAt = Date.now();
    };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
  }, deal.id);
  await token("analyst2");
  const next = deal.stage === "signal" ? "qualified" : "contact_found";
  const sentAt = Date.now();
  const r = await apiPost(`/api/deals/${deal.id}/stage`, "analyst2", { to_stage: next });
  expect(r.status).toBe(200);
  await expect(card).toContainText("Pending approval", { timeout: 10_000 });
  const shownAt = await page.evaluate(() => (window as unknown as { __pendingAt?: number }).__pendingAt!);
  const delay = shownAt - sentAt;
  record("kanban", { deal: deal.id, sent_at: sentAt, shown_at: shownAt, delay_ms: delay, limit_ms: LIMIT_MS });
  expect(delay).toBeLessThanOrEqual(LIMIT_MS);
});

test("a new Tier 0 alert appears live as Unconfirmed, 2 s or less after the commit (criterion 5)", async ({ page }) => {
  await login(page, "analyst", "monitoring");
  const m = await moduleReady(page, "tier0-alerts");
  await watch(page, '[data-module="tier0-alerts"]', "[data-alert-id]", "data-alert-id");
  const before = new Set((await apiGet<{ items: Array<{ id: string }> }>("/api/alerts?limit=500")).items.map((a) => a.id));
  // A new fuel shortage report (invented test data). Each run gives a new document.
  const run = new Date().toISOString();
  const text = [
    `Diesel shortage hits Kitwe and Chingola filling stations (${run})`,
    "",
    `Filling stations in Kitwe, Chingola and Chililabombwe ran out of diesel on ${run.slice(0, 10)} as tankers queued at the Ndola fuel terminal.`,
    `Report reference ${run}.`,
  ].join("\n");
  const form = new FormData();
  form.append("file", new Blob([text], { type: "text/plain" }), `fuel-shortage-${run.replace(/[:.]/g, "-")}.txt`);
  form.append("publisher", "E2E test wire (synthetic)");
  const res = await fetch(`${API_URL}/api/sources/manual`, { method: "POST", headers: { Authorization: `Bearer ${await token("analyst")}` }, body: form });
  expect(res.status).toBe(201);
  const upload = (await res.json()) as { source_id: string };
  const alert = await waitFor("a Tier 0 alert for the uploaded report", async () =>
    (await apiGet<{ items: Array<{ id: string; source_id: string; status: string; raised_at: string; tier: number }> }>("/api/alerts?tier=0&limit=500"))
      .items.find((a) => a.source_id === upload.source_id && !before.has(a.id)), 180_000);
  const item = m.locator(`[data-alert-id="${alert.id}"]`);
  await expect(item).toBeVisible({ timeout: 10_000 });
  await expect(item.locator('[data-status="unconfirmed"]')).toHaveText("Unconfirmed");
  const shownAt = (await seen(page))[alert.id]!;
  const committedBefore = Date.parse(alert.raised_at);
  const delay = shownAt - committedBefore;
  record("alert", { alert: alert.id, raised_at: alert.raised_at, shown_at: shownAt, delay_ms: delay, limit_ms: LIMIT_MS });
  expect(shownAt).toBeGreaterThan(0);
  expect(delay).toBeLessThanOrEqual(LIMIT_MS);
});

test.afterAll(async () => {
  // Leave no pending stage move of this file for the next run.
  const deals = await apiGet<{ items: Deal[] }>("/api/deals");
  for (const d of deals.items) {
    if (d.pending_proposal_id) await apiPost(`/api/proposals/${d.pending_proposal_id}/reject`, "approver", { reason: "E2E clean-up" });
  }
});
