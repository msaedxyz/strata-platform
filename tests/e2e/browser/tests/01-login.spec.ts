// Stop condition 2: a user logs in on the real Keycloak login page and the Strata dashboard loads with live data.
// Each workspace shows its modules with data from the real API, and no module is in the error state.
import { expect, test } from "@playwright/test";
import { apiGet, login, moduleReady, openWorkspace } from "../support/stack";

const WORKSPACES: Record<string, string[]> = {
  origination: ["priority-list", "procurement-calendar", "project-pipeline", "deal-map"],
  relationships: ["kanban", "relationship-panel", "next-actions"],
  monitoring: ["ticker", "tier0-alerts", "demand-drivers", "signal-feed", "site-watch-list", "source-health"],
  review: ["approval-queue", "quarantine", "alert-telemetry"],
};

test("an analyst logs in on the Keycloak login page and each workspace loads its modules from the real API", async ({ page }) => {
  const apiErrors: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 400) apiErrors.push(`${r.status()} ${r.url()}`);
  });
  await login(page, "analyst", "origination");
  // The live connection is open (the SSE request of the app).
  for (const [ws, modules] of Object.entries(WORKSPACES)) {
    await openWorkspace(page, ws);
    for (const id of modules) {
      const m = await moduleReady(page, id);
      await expect(m).not.toHaveAttribute("data-module-state", "error");
    }
  }
  // The data is real: the monitoring workspace shows the Tier 0 alerts that the API gives.
  const alerts = await apiGet<{ items: Array<{ id: string }> }>("/api/alerts?tier=0");
  expect(alerts.items.length).toBeGreaterThan(0);
  await openWorkspace(page, "monitoring");
  const m = await moduleReady(page, "tier0-alerts");
  await expect(m.locator(`[data-alert-id="${alerts.items[0]!.id}"]`)).toBeVisible();
  expect(apiErrors).toEqual([]);
});

test("a viewer logs in and sees no write controls", async ({ page }) => {
  await login(page, "viewer", "monitoring");
  const alerts = await moduleReady(page, "tier0-alerts");
  await expect(alerts.locator("[data-alert-id]").first()).toBeVisible();
  await expect(alerts.getByRole("button", { name: /Acknowledge|Confirm|Dismiss/ })).toHaveCount(0);
  await openWorkspace(page, "relationships");
  const k = await moduleReady(page, "kanban");
  await expect(k.locator('[draggable="true"]')).toHaveCount(0);
});
