// docs/07 criteria 6 and 7 on the real stack at 1920x1080, with 10 000 signals and 500 deals in the database.
// tests/e2e/seed_volume.py writes the volume data through the governance service in the api container.
//
// Criterion 6, time to interactive: after the real login, the browser cache is cleared and the page opens the
// workspace. The time runs from the start of the navigation to the later of (a) the moment when every module of the
// workspace has its data (performance mark strata:module-ready:<id>) and (b) the end of the last long task before a
// quiet window of 1 s. This is the method of apps/web/e2e/perf.spec.ts, with the real API in place of the mock.
// Criterion 7: the seeding script commits 50 new signals, 60 ms apart, while the monitoring workspace is open. The
// browser records no task longer than 200 ms.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { REPO_ROOT, apiGet, login, moduleReady } from "../support/stack";

const TTI_LIMIT_MS = 3000;
const TASK_LIMIT_MS = 200;
const QUIET_MS = 1000;
const SIGNALS = 10000;
const DEALS = 500;
const OUT = process.env.E2E_RESULTS_DIR ?? join(REPO_ROOT, "test-results", "e2e");
const COMPOSE = (process.env.E2E_COMPOSE ?? "docker compose -f docker-compose.yml -f tests/e2e/compose.e2e.yml --profile test").split(" ");
const WORKSPACE_MODULES: Record<string, string[]> = {
  monitoring: ["ticker", "tier0-alerts", "demand-drivers", "signal-feed", "site-watch-list", "source-health"],
  origination: ["priority-list", "procurement-calendar", "project-pipeline", "deal-map"],
  relationships: ["kanban", "relationship-panel", "next-actions"],
  review: ["approval-queue", "quarantine", "alert-telemetry"],
};

test.describe.configure({ mode: "serial" });

function seed(signals: number, deals: number, delayMs = 0): string {
  const script = readFileSync(join(REPO_ROOT, "tests", "e2e", "seed_volume.py"));
  const args = [...COMPOSE.slice(1), "exec", "-T", "api", "python", "-", "--signals", String(signals), "--deals", String(deals)];
  if (delayMs) args.push("--delay-ms", String(delayMs));
  return execFileSync(COMPOSE[0]!, args, { cwd: REPO_ROOT, input: script, encoding: "utf8", timeout: 900_000 });
}

interface Task { start: number; duration: number }

async function observeLongTasks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: Array<{ start: number; duration: number }> };
    w.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: true });
  });
}

const longTasks = (page: Page) => page.evaluate(() => (window as unknown as { __longTasks: Task[] }).__longTasks);

async function quietWindow(page: Page, from: number): Promise<number> {
  let lastEnd = from;
  for (let i = 0; i < 30; i++) {
    const tasks = await longTasks(page);
    lastEnd = Math.max(from, ...tasks.map((t) => t.start + t.duration));
    const now = await page.evaluate(() => performance.now());
    if (now - lastEnd >= QUIET_MS) return lastEnd;
    await page.waitForTimeout(QUIET_MS - (now - lastEnd) + 50);
  }
  return lastEnd;
}

function save(name: string, data: unknown) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `perf-${name}.json`), JSON.stringify(data, null, 2));
}

test.beforeAll(() => {
  const out = seed(SIGNALS, DEALS);
  save("seed", JSON.parse(out.trim().split("\n").pop()!));
});

for (const ws of Object.keys(WORKSPACE_MODULES)) {
  test(`criterion 6 (stack): the ${ws} workspace is interactive in 3 s or less with 10 000 signals and 500 deals`, async ({ page }) => {
    const signals = await apiGet<{ total: number }>("/api/signals?limit=1");
    expect(signals.total).toBeGreaterThanOrEqual(SIGNALS);
    expect((await apiGet<{ items: unknown[] }>("/api/deals")).items.length).toBeGreaterThanOrEqual(DEALS);
    await observeLongTasks(page);
    await login(page, "analyst", ws);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.clearBrowserCache");
    await page.goto(`/w/${ws}`);
    const ids = WORKSPACE_MODULES[ws]!;
    await expect(page.locator('[data-module-state="loading"]')).toHaveCount(0, { timeout: 30_000 });
    for (const id of ids) await moduleReady(page, id);
    const marks = await page.evaluate(() => performance.getEntriesByType("mark").filter((m) => m.name.startsWith("strata:module-ready:")).map((m) => ({ name: m.name, at: m.startTime })));
    const first = new Map<string, number>();
    for (const m of marks) {
      const id = m.name.replace("strata:module-ready:", "");
      if (!first.has(id)) first.set(id, m.at);
    }
    expect([...first.keys()].sort()).toEqual([...ids].sort());
    const ready = Math.max(...first.values());
    const tti = Math.max(ready, await quietWindow(page, ready));
    save(`tti-${ws}`, { workspace: ws, ttiMs: Math.round(tti), readyMs: Math.round(ready), marks, longTasks: await longTasks(page) });
    expect(tti, `time to interactive of ${ws}: ${Math.round(tti)} ms`).toBeLessThanOrEqual(TTI_LIMIT_MS);
  });
}

test("criterion 7 (stack): during 50 live signals, the browser records no task longer than 200 ms", async ({ page }) => {
  await observeLongTasks(page);
  await login(page, "analyst", "monitoring");
  await expect(page.locator('[data-module-state="loading"]')).toHaveCount(0, { timeout: 30_000 });
  const feed = await moduleReady(page, "signal-feed");
  await quietWindow(page, await page.evaluate(() => performance.now()));
  const start = await page.evaluate(() => performance.now());
  const before = (await apiGet<{ total: number }>("/api/signals?limit=1")).total;
  const have = Number(JSON.parse(seed(0, 0).trim().split("\n").pop()!).volume_sources);
  seed(have + 50, 0, 60);
  await expect.poll(async () => (await apiGet<{ total: number }>("/api/signals?limit=1")).total).toBe(before + 50);
  // The live patch puts the newest item at the top of the feed.
  const last = `Volume item ${String(have + 49).padStart(5, "0")}`;
  await expect(feed.locator("[data-signal-id]", { hasText: last })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await quietWindow(page, await page.evaluate(() => performance.now()));
  const tasks = (await longTasks(page)).filter((t) => t.start >= start);
  const longest = Math.max(0, ...tasks.map((t) => t.duration));
  save("long-tasks-live", { updates: 50, longTasks: tasks, longestMs: longest });
  expect(longest, `longest task during the live updates: ${Math.round(longest)} ms`).toBeLessThanOrEqual(TASK_LIMIT_MS);
});
