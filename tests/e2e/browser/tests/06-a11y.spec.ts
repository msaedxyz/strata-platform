// docs/07 quality floor 3 on the real stack: axe finds no violation in the four workspaces with real data.
// The Infora baseline (audit/a11y.md) does not exist yet, so the test asks for zero violations (like apps/web).
// The results of each scan go to test-results/e2e/a11y-<workspace>.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { REPO_ROOT, login, moduleReady, openWorkspace } from "../support/stack";

const OUT = process.env.E2E_RESULTS_DIR ?? join(REPO_ROOT, "test-results", "e2e");
const WORKSPACES = { origination: "priority-list", relationships: "kanban", monitoring: "tier0-alerts", review: "approval-queue" };

test("axe: the four workspaces have no violations with the data of the stack", async ({ page }) => {
  await login(page, "admin", "origination");
  const found: Record<string, unknown> = {};
  for (const [ws, module] of Object.entries(WORKSPACES)) {
    await openWorkspace(page, ws);
    await moduleReady(page, module);
    await expect(page.locator('[data-module-state="loading"]')).toHaveCount(0, { timeout: 30_000 });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
    const violations = results.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) }));
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `a11y-${ws}.json`), JSON.stringify({ workspace: ws, violations, passes: results.passes.length }, null, 2));
    found[ws] = violations;
  }
  expect(found).toEqual({ origination: [], relationships: [], monitoring: [], review: [] });
});
