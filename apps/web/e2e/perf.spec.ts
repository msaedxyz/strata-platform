// docs/07 criteria 6 and 7, with the large fixture dataset (10 000 signals, 500 deals) at 1920x1080.
// The tests run against a production build with the test-only auth (playwright.config.ts, project "perf").
//
// Criterion 6, time to interactive: from the start of the navigation to the later of (a) the moment when every module
// in the workspace has its data (performance mark strata:module-ready:<id>) and (b) the end of the last long task
// before a quiet window of 1 second with no long task (the quiet window rule of the TTI metric).
// Criterion 7: during 50 live updates of the feed, the browser records no task longer than 200 ms.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { workspaces } from "../src/config/workspaces";
import { emitLive, expect, moduleReady, test } from "./harness";

const TTI_LIMIT_MS = 3000;
const TASK_LIMIT_MS = 200;
const QUIET_MS = 1000;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "test-results", "perf");

test.use({ dataset: "large", viewport: { width: 1920, height: 1080 } });
test.describe.configure({ mode: "serial" });

interface Task {
  start: number;
  duration: number;
}

/** Record long tasks from the first script of the page. */
async function observeLongTasks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: Array<{ start: number; duration: number }> };
    w.__longTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__longTasks.push({ start: e.startTime, duration: e.duration });
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // No longtask support. The test then fails on the missing entries check below.
    }
  });
}

const longTasks = (page: Page) => page.evaluate(() => (window as unknown as { __longTasks: Task[] }).__longTasks);

/** Wait until no long task starts for QUIET_MS. Returns the end of the last long task. */
async function quietWindow(page: Page, from: number): Promise<number> {
  let lastEnd = from;
  for (let i = 0; i < 20; i++) {
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
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(data, null, 2));
}

for (const ws of ["monitoring", "origination", "relationships", "review"]) {
  test(`criterion 6: the ${ws} workspace is interactive in 3 s or less with 10 000 signals and 500 deals`, async ({ page, mock }) => {
    expect(mock.data.signals).toHaveLength(10000);
    expect(mock.data.deals).toHaveLength(500);
    await observeLongTasks(page);
    // A cold visit: a new browser context with an empty cache.
    await page.goto(`/w/${ws}`);
    const ids = workspaces.find((w) => w.id === ws)!.defaultPanels.map((p) => p.i);
    await expect(page.locator('[data-module-state="loading"]')).toHaveCount(0, { timeout: 15_000 });
    for (const id of ids) await moduleReady(page, id);
    const marks = await page.evaluate(() => performance.getEntriesByType("mark").filter((m) => m.name.startsWith("strata:module-ready:")).map((m) => ({ name: m.name, at: m.startTime })));
    // The first mark of each module is the moment it first had its data.
    const firstMark = new Map<string, number>();
    for (const m of marks) {
      const id = m.name.replace("strata:module-ready:", "");
      if (!firstMark.has(id)) firstMark.set(id, m.at);
    }
    expect([...firstMark.keys()].sort()).toEqual([...ids].sort());
    const ready = Math.max(...firstMark.values());
    const lastLongTaskEnd = await quietWindow(page, ready);
    const tti = Math.max(ready, lastLongTaskEnd);
    const tasks = await longTasks(page);
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      return { domContentLoaded: n?.domContentLoadedEventEnd ?? null, fcp: fcp?.startTime ?? null };
    });
    // The page answers input at once after TTI: a click on a panel control has an effect in the next frame.
    const t0 = Date.now();
    await page.getByRole("button", { name: "Add panel" }).first().click();
    await expect(page.getByRole("dialog", { name: "Add panel" })).toBeVisible();
    const inputDelay = Date.now() - t0;
    save(`tti-${ws}`, { workspace: ws, signals: 10000, deals: 500, ttiMs: Math.round(tti), readyMs: Math.round(ready), marks, longTasks: tasks, inputDelayMs: inputDelay, ...nav });
    expect(tti, `time to interactive of ${ws}: ${Math.round(tti)} ms`).toBeLessThanOrEqual(TTI_LIMIT_MS);
  });
}

test("criterion 7: during 50 live updates of the feed, no task is longer than 200 ms", async ({ page, mock }) => {
  await observeLongTasks(page);
  await page.goto("/w/monitoring");
  await expect(page.locator('[data-module-state="loading"]')).toHaveCount(0, { timeout: 15_000 });
  await moduleReady(page, "signal-feed");
  await quietWindow(page, await page.evaluate(() => performance.now()));
  const start = await page.evaluate(() => performance.now());
  const base = mock.data.signals[0]!;
  for (let i = 0; i < 50; i++) {
    const now = new Date().toISOString();
    const s = { ...base, id: `sig-live-${i}`, title: `LIVE ${i}: new item at a watched site`, tier: i % 10 === 0 ? 0 : 2, published_at: now, recorded_at: now };
    mock.data.signals.unshift(s);
    const alert = i % 10 === 0 ? [{ type: "AlertRaised", data: { id: `evt-a-${i}`, stream_type: "alert", stream_id: `alert-live-${i}`, event_type: "AlertRaised" } }] : [];
    if (alert.length) mock.data.alerts.push({ ...mock.data.alerts[0]!, id: `alert-live-${i}`, title: s.title, raised_at: now, status: "unconfirmed" });
    await emitLive(page, [{ type: "SignalScored", data: { id: `evt-s-${i}`, stream_type: "signal", stream_id: s.id, event_type: "SignalScored" } }, ...alert]);
    await page.waitForTimeout(60);
  }
  await expect(page.locator('[data-module="signal-feed"] [data-signal-id="sig-live-49"]')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-module="signal-feed"] [data-signal-total]')).toHaveText("250 of 10,050");
  await quietWindow(page, await page.evaluate(() => performance.now()));
  const tasks = (await longTasks(page)).filter((t) => t.start >= start);
  const longest = Math.max(0, ...tasks.map((t) => t.duration));
  save("long-tasks-live", { updates: 50, longTasks: tasks, longestMs: longest });
  expect(longest, `longest task during the live updates: ${Math.round(longest)} ms`).toBeLessThanOrEqual(TASK_LIMIT_MS);
});

test("the feed renders only the items in view: 10 000 signals give a small number of items in the document", async ({ page }) => {
  await page.goto("/w/monitoring");
  const feed = await moduleReady(page, "signal-feed");
  await expect(feed.locator("[data-signal-total]")).toHaveText("200 of 10,000");
  const count = await feed.locator("article").count();
  expect(count).toBeGreaterThan(3);
  expect(count).toBeLessThan(60);
  // Scrolling to the end loads the next page.
  await feed.locator(".sds-virtual-list").evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(feed.locator("[data-signal-total]")).toHaveText("400 of 10,000");
  await page.goto("/w/origination");
  const pl = await moduleReady(page, "priority-list");
  await expect(pl.getByRole("table")).toHaveAttribute("aria-rowcount", /\d{3}/);
  expect(await pl.locator("tbody tr[data-row-id]").count()).toBeLessThan(100);
});
