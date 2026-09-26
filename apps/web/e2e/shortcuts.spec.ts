// docs/07 criterion 3: each keyboard shortcut has an end to end test. The shortcut map is
// src/config/shortcuts.ts (provisional until audit/behaviour.md exists). A test below fails when a shortcut
// in the map has no test.
import type { Page } from "@playwright/test";
import { shortcuts, WORKSPACE_SHORTCUTS } from "../src/config/shortcuts";
import { expect, openWorkspace, panel, test } from "./harness";

/** Press a binding with Playwright key names. */
function keyName(b: { key: string; ctrl?: boolean; meta?: boolean; shift?: boolean }): string {
  const mods = [b.ctrl && "Control", b.meta && "Meta", b.shift && "Shift"].filter(Boolean);
  return [...mods, b.key].join("+");
}

const palette = (page: Page) => page.getByRole("dialog", { name: "Command input" });
const help = (page: Page) => page.getByRole("dialog", { name: "Keyboard shortcuts" });

const checks: Record<string, (page: Page) => Promise<void>> = {
  "command.open": async (page) => {
    for (const b of shortcuts.find((s) => s.id === "command.open")!.bindings!) {
      await page.locator("body").click({ position: { x: 1900, y: 1070 } });
      await page.keyboard.press(keyName(b));
      await expect(palette(page), `binding ${keyName(b)}`).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Command input" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(palette(page)).toHaveCount(0);
    }
    // The command input runs a command.
    await page.keyboard.press("/");
    await page.keyboard.type("review");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/w\/review$/);
  },
  "help.open": async (page) => {
    await page.keyboard.press("?");
    await expect(help(page)).toBeVisible();
    for (const s of shortcuts) await expect(help(page).locator(`[data-shortcut-id="${s.id}"]`)).toBeVisible();
  },
  "workspace.1": (page) => workspaceSequence(page, "workspace.1"),
  "workspace.2": (page) => workspaceSequence(page, "workspace.2"),
  "workspace.3": (page) => workspaceSequence(page, "workspace.3"),
  "workspace.4": (page) => workspaceSequence(page, "workspace.4"),
  "overlay.close": async (page) => {
    // Command input.
    await page.keyboard.press("/");
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette(page)).toHaveCount(0);
    // Shortcut help.
    await page.keyboard.press("?");
    await expect(help(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(help(page)).toHaveCount(0);
    // Panel picker dialog.
    await page.getByRole("button", { name: "Add panel" }).first().click();
    await expect(page.getByRole("dialog", { name: "Add panel" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Add panel" })).toHaveCount(0);
    // Panel menu.
    await page.getByRole("button", { name: "Priority list panel menu" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Priority list panel menu" })).toBeFocused();
    // User menu.
    await page.getByRole("button", { name: /E2E Analyst/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    // Maximised panel.
    await page.getByRole("button", { name: "Maximise Priority list" }).click();
    await expect(page.locator("[data-maximised-id]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-maximised-id]")).toHaveCount(0);
  },
  "list.move": async (page) => {
    // Navigation rail.
    await page.locator('[data-nav-id="origination"]').focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator('[data-nav-id="relationships"]')).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.locator('[data-nav-id="origination"]')).toBeFocused();
    // Command input results.
    await page.keyboard.press("/");
    // Scope to the command input: the M6 modules have native select elements with options too.
    const options = page.getByRole("dialog", { name: "Command input" }).getByRole("option");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    // Menu items.
    await page.getByRole("button", { name: "Priority list panel menu" }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "Move left" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "Move right" })).toBeFocused();
    await page.keyboard.press("Escape");
    // Panel picker.
    await page.getByRole("button", { name: "Add panel" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add panel" });
    await dialog.locator('[data-module-id="ticker"]').focus();
    await page.keyboard.press("ArrowDown");
    await expect(dialog.locator('[data-module-id="tier0-alerts"]')).toBeFocused();
  },
};

async function workspaceSequence(page: Page, id: string) {
  const target = WORKSPACE_SHORTCUTS[id]!;
  const seq = shortcuts.find((s) => s.id === id)!.sequence!;
  // Start from another workspace, so that the shortcut must change it.
  const start = target === "review" ? "origination" : "review";
  await openWorkspace(page, start);
  for (const k of seq) await page.keyboard.press(k);
  await expect(page).toHaveURL(new RegExp(`/w/${target}$`));
  await expect(page.locator(`[data-nav-id="${target}"]`)).toHaveAttribute("aria-current", "page");
  await expect(page.locator(`[data-workspace-id="${target}"]`)).toBeVisible();
}

test.describe("criterion 3: keyboard shortcuts", () => {
  test("every shortcut in src/config/shortcuts.ts has an end to end test", () => {
    const missing = shortcuts.map((s) => s.id).filter((id) => !(id in checks));
    expect(missing).toEqual([]);
  });

  for (const s of shortcuts) {
    test(`shortcut ${s.id} (${s.display.join(", ")}): ${s.description}`, async ({ page }) => {
      await openWorkspace(page);
      await checks[s.id]!(page);
    });
  }

  test("shortcuts do not fire while the user types in a field", async ({ page }) => {
    await openWorkspace(page);
    await page.keyboard.press("/");
    await page.keyboard.type("g1?");
    await expect(page.getByRole("combobox", { name: "Command input" })).toHaveValue("g1?");
    await expect(help(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/w\/origination$/);
  });

  test("the search field in the top bar opens the command input with the typed text", async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole("searchbox", { name: "Search" }).focus();
    await page.keyboard.press("k");
    await expect(page.getByRole("combobox", { name: "Command input" })).toHaveValue("k");
    await page.keyboard.press("Escape");
    await expect(panel(page, "priority-list")).toBeVisible();
  });
});
