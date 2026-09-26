// docs/07 criterion 3: each panel behaviour has an end to end test. The behaviour is the provisional one in
// packages/panel-framework/BEHAVIOUR.md until audit/layout-system.md exists.
import { expect, grid, openWorkspace, panel, test } from "./harness";

const MARGIN_TOLERANCE = 1.5;

async function header(page: import("@playwright/test").Page, id: string) {
  return panel(page, id).locator(".sds-panel-header");
}

/** The box of an element after the grid transitions end: two reads in a row give the same box. */
async function stableBox(locator: import("@playwright/test").Locator) {
  let last = "";
  for (let i = 0; i < 40; i++) {
    const box = await locator.boundingBox();
    const key = JSON.stringify(box);
    if (box && key === last) return box;
    last = key;
    await locator.page().waitForTimeout(50);
  }
  throw new Error("the element did not stop moving");
}

/** Column width and row pitch of the grid in pixels, from the grid element and the grid settings. */
async function metrics(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const g = document.querySelector(".react-grid-layout") as HTMLElement;
    const item = document.querySelector('[data-panel-id="priority-list"]') as HTMLElement;
    const gRect = g.getBoundingClientRect();
    const iRect = item.getBoundingClientRect();
    return { gridLeft: gRect.left, gridTop: gRect.top, gridWidth: gRect.width, itemLeft: iRect.left, itemTop: iRect.top };
  });
}

test.describe("criterion 3: panel behaviour", () => {
  test("the four default workspaces open with their panels", async ({ page }) => {
    const expected: Record<string, string[]> = {
      origination: ["priority-list", "procurement-calendar", "project-pipeline", "deal-map"],
      relationships: ["kanban", "relationship-panel", "next-actions"],
      monitoring: ["ticker", "tier0-alerts", "demand-drivers", "signal-feed", "site-watch-list", "source-health"],
      review: ["approval-queue", "quarantine", "alert-telemetry"],
    };
    for (const [ws, ids] of Object.entries(expected)) {
      await openWorkspace(page, ws);
      for (const id of ids) await expect(panel(page, id)).toBeVisible();
      await expect(page.locator(".react-grid-item")).toHaveCount(ids.length);
    }
  });

  test("each panel shows its Strata module (M6 replaced the placeholders)", async ({ page }) => {
    await openWorkspace(page, "origination");
    for (const id of ["priority-list", "procurement-calendar", "project-pipeline", "deal-map"]) {
      await expect(panel(page, id).locator(`[data-module="${id}"]`)).toBeVisible();
    }
  });

  test("drag: a panel moves by its header to another grid position", async ({ page }) => {
    await openWorkspace(page);
    const before = await grid(page, "priority-list");
    const h = await stableBox(await header(page, "priority-list"));
    const m = await metrics(page);
    const colPitch = m.gridWidth / 12;
    await page.mouse.move(h!.x + 40, h!.y + h!.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(h!.x + 40 + (colPitch * 6 * i) / 10, h!.y + h!.height / 2);
    await page.mouse.up();
    await expect.poll(async () => (await grid(page, "priority-list")).x).toBe(6);
    expect(before.x).toBe(0);
  });

  test("snap: after a drag by a part of a column, the panel sits exactly on a grid cell", async ({ page }) => {
    await openWorkspace(page);
    const h = await stableBox(await header(page, "priority-list"));
    const m = await metrics(page);
    const colPitch = m.gridWidth / 12;
    await page.mouse.move(h!.x + 40, h!.y + 10);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(h!.x + 40 + (colPitch * 2.4 * i) / 10, h!.y + 10 + (i * 7) / 10);
    await page.mouse.up();
    await expect.poll(async () => (await grid(page, "priority-list")).x).toBe(2);
    const g = await grid(page, "priority-list");
    expect(Number.isInteger(g.x) && Number.isInteger(g.y)).toBe(true);
    // The item left edge is on the column line: padding + x * (column width + margin). Wait for the move transition.
    const offset = () =>
      page.evaluate((x) => {
        const gridEl = document.querySelector(".react-grid-layout") as HTMLElement;
        const item = document.querySelector('[data-panel-id="priority-list"]') as HTMLElement;
        const width = gridEl.getBoundingClientRect().width;
        const left = item.getBoundingClientRect().left - gridEl.getBoundingClientRect().left;
        const pad = 4;
        const margin = 4;
        const colWidth = (width - margin * 11 - pad * 2) / 12;
        return Math.abs(left - (pad + x * (colWidth + margin)));
      }, g.x);
    await expect.poll(offset).toBeLessThan(MARGIN_TOLERANCE);
  });

  test("resize: the corner handle changes the width and the height in whole cells", async ({ page }) => {
    await openWorkspace(page);
    const before = await grid(page, "priority-list");
    const handle = panel(page, "priority-list").locator(".react-resizable-handle-se");
    const box = await stableBox(handle);
    const m = await metrics(page);
    const colPitch = m.gridWidth / 12;
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box!.x + box!.width / 2 - (colPitch * 2 * i) / 10, box!.y + box!.height / 2 + (28 * 4 * i) / 10);
    await page.mouse.up();
    await expect.poll(async () => (await grid(page, "priority-list")).w).toBe(before.w - 2);
    expect((await grid(page, "priority-list")).h).toBe(before.h + 4);
  });

  test("resize: the right edge handle changes only the width", async ({ page }) => {
    await openWorkspace(page);
    const before = await grid(page, "deal-map");
    const handle = panel(page, "deal-map").locator(".react-resizable-handle-e");
    const box = await stableBox(handle);
    const m = await metrics(page);
    const colPitch = m.gridWidth / 12;
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box!.x + box!.width / 2 - (colPitch * 3 * i) / 10, box!.y + box!.height / 2);
    await page.mouse.up();
    await expect.poll(async () => (await grid(page, "deal-map")).w).toBe(before.w - 3);
    expect((await grid(page, "deal-map")).h).toBe(before.h);
  });

  test("collapse: the panel shows its header only, and expand gives back its height", async ({ page }) => {
    await openWorkspace(page);
    const before = await grid(page, "project-pipeline");
    await page.getByRole("button", { name: "Collapse Project pipeline" }).click();
    await expect(panel(page, "project-pipeline")).toHaveAttribute("data-collapsed", "true");
    await expect(panel(page, "project-pipeline").locator(".sds-panel__body")).toHaveCount(0);
    expect((await grid(page, "project-pipeline")).h).toBe(1);
    await page.getByRole("button", { name: "Expand Project pipeline" }).click();
    await expect.poll(async () => (await grid(page, "project-pipeline")).h).toBe(before.h);
  });

  test("maximise: the panel fills the grid area, and restore or Esc goes back", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("button", { name: "Maximise Procurement calendar" }).click();
    const max = page.locator('[data-maximised-id="procurement-calendar"]');
    await expect(max).toBeVisible();
    const area = await page.locator(".spf-grid-area").boundingBox();
    const box = await max.boundingBox();
    expect(Math.abs(box!.width - area!.width)).toBeLessThan(2);
    expect(Math.abs(box!.height - area!.height)).toBeLessThan(2);
    await expect(page.locator(".spf-grid")).toHaveAttribute("aria-hidden", "true");
    await page.getByRole("button", { name: "Restore Procurement calendar" }).click();
    await expect(max).toHaveCount(0);
    await page.getByRole("button", { name: "Maximise Procurement calendar" }).click();
    await expect(max).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(max).toHaveCount(0);
  });

  test("close: the panel goes out of the layout", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("button", { name: "Close Geographic deal map" }).click();
    await expect(panel(page, "deal-map")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Origination", level: 1 })).toBeFocused();
  });

  test("add: the panel picker adds a module at the bottom of the grid", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("button", { name: "Add panel" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add panel" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Priority list/ })).toBeDisabled();
    await dialog.getByRole("button", { name: /^Timeline/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(panel(page, "timeline")).toBeVisible();
    const t = await grid(page, "timeline");
    expect(t.x).toBe(0);
    expect(t.y).toBeGreaterThanOrEqual(34);
  });

  test("layout persistence: the layout is the same after a reload", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("button", { name: "Close Geographic deal map" }).click();
    await page.getByRole("button", { name: "Collapse Project pipeline" }).click();
    await page.getByRole("button", { name: "Priority list panel menu" }).click();
    await page.getByRole("menuitem", { name: "Make narrower" }).click();
    await expect.poll(async () => (await grid(page, "priority-list")).w).toBe(5);
    const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("strata.layout.v1.")));
    expect(stored).toContain("strata.layout.v1.e2e-analyst.origination");
    await page.reload();
    await expect(page.locator(".react-grid-item").first()).toBeVisible();
    await expect(panel(page, "deal-map")).toHaveCount(0);
    await expect(panel(page, "project-pipeline")).toHaveAttribute("data-collapsed", "true");
    expect((await grid(page, "priority-list")).w).toBe(5);
  });

  test("reset: Reset layout gives back the default layout", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("button", { name: "Close Geographic deal map" }).click();
    await page.getByRole("button", { name: "Collapse Project pipeline" }).click();
    await page.getByRole("button", { name: "Reset layout" }).click();
    await expect(panel(page, "deal-map")).toBeVisible();
    await expect(panel(page, "project-pipeline")).not.toHaveAttribute("data-collapsed", "true");
    expect(await grid(page, "deal-map")).toEqual({ x: 6, y: 18, w: 6, h: 16 });
    await page.reload();
    await expect(panel(page, "deal-map")).toBeVisible();
  });

  test("each workspace keeps its own layout", async ({ page }) => {
    await openWorkspace(page, "review");
    await page.getByRole("button", { name: "Close Quarantine" }).click();
    await openWorkspace(page, "origination");
    await expect(page.locator(".react-grid-item")).toHaveCount(4);
    await openWorkspace(page, "review");
    await expect(panel(page, "quarantine")).toHaveCount(0);
  });
});
