// Screenshots of each workspace with the fixture data for the M6 report (reports/M6-screenshots/).
// Run with: SCREENSHOTS=1 pnpm --filter @strata/web exec playwright test e2e/screenshots.spec.ts --project=e2e
// The normal test run skips this file.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, moduleReady, openWorkspace, test } from "./harness";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "reports", "M6-screenshots");
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
];

test.skip(!process.env.SCREENSHOTS, "Set SCREENSHOTS=1 to write the report screenshots.");
test.use({ role: "approver" });

async function settle(page: Page) {
  await expect(page.locator('[data-module-state="loading"]')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(1200);
}

for (const size of SIZES) {
  const tag = `${size.width}x${size.height}`;
  test(`workspaces at ${tag}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const ws of ["origination", "monitoring", "review"]) {
      await openWorkspace(page, ws);
      await settle(page);
      await page.screenshot({ path: join(OUT, `strata-${ws}-${tag}.png`) });
    }
    // Relationships with a selected opportunity, so the relationship panel shows its tabs.
    await openWorkspace(page, "relationships");
    const rel = await moduleReady(page, "relationship-panel");
    await rel.getByLabel("Opportunity").selectOption("deal-0006");
    await settle(page);
    await page.screenshot({ path: join(OUT, `strata-relationships-${tag}.png`) });
  });
}

test("overlays at 1920x1080: evidence, priority breakdown, forecast window", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openWorkspace(page, "origination");
  await settle(page);
  const pl = page.locator('[data-module="priority-list"]');
  await pl.getByRole("button", { name: /Show evidence for/ }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, "strata-evidence-drawer-1920x1080.png") });
  await page.keyboard.press("Escape");
  await pl.locator("tbody tr[data-row-id]").first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, "strata-priority-breakdown-1920x1080.png") });
  await page.keyboard.press("Escape");
  await page.locator('[data-module="procurement-calendar"] button.sds-timeline__range').first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT, "strata-forecast-window-1920x1080.png") });
});
