// docs/07 quality floor 3: axe finds no issue that the Infora baseline does not have. The Infora baseline
// (audit/a11y.md) does not exist yet, so the test asks for zero violations and records the full results.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, openWorkspace, test } from "./harness";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "test-results", "a11y");

async function scan(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
  mkdirSync(OUT, { recursive: true });
  const summary = {
    view: name,
    url: page.url(),
    violations: results.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => n.target.join(" ")) })),
    passes: results.passes.length,
    incomplete: results.incomplete.map((v) => v.id),
  };
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(summary, null, 2));
  return summary;
}

test.describe("quality floor: accessibility of the shell (axe)", () => {
  for (const ws of ["origination", "relationships", "monitoring", "review"]) {
    test(`axe: the ${ws} workspace has no violations`, async ({ page }) => {
      await openWorkspace(page, ws);
      const s = await scan(page, `workspace-${ws}`);
      expect(s.violations, JSON.stringify(s.violations, null, 2)).toEqual([]);
    });
  }

  test("axe: the command input has no violations", async ({ page }) => {
    await openWorkspace(page);
    await page.keyboard.press("/");
    await expect(page.getByRole("dialog", { name: "Command input" })).toBeVisible();
    const s = await scan(page, "command-input");
    expect(s.violations, JSON.stringify(s.violations, null, 2)).toEqual([]);
  });

  test("axe: the shortcut help and the panel picker have no violations", async ({ page }) => {
    await openWorkspace(page);
    await page.keyboard.press("?");
    const help = await scan(page, "shortcut-help");
    expect(help.violations, JSON.stringify(help.violations, null, 2)).toEqual([]);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Add panel" }).first().click();
    const picker = await scan(page, "panel-picker");
    expect(picker.violations, JSON.stringify(picker.violations, null, 2)).toEqual([]);
  });

  test("focus is visible on each control (focus ring token)", async ({ page }) => {
    await openWorkspace(page);
    const seen: string[] = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const ring = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
        const shadow = s.boxShadow !== "none";
        const within = el.closest(".sds-input, .sds-select");
        const wrapperRing = within ? getComputedStyle(within).outlineStyle !== "none" : false;
        return { name: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? el.tagName, visible: ring || shadow || wrapperRing };
      });
      if (!info) continue;
      seen.push(info.name);
      expect(info.visible, `focus ring on "${info.name}"`).toBe(true);
    }
    expect(seen.length).toBeGreaterThan(10);
  });

  test("reduced motion: durations become zero", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openWorkspace(page);
    const d = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--motion-duration-normal").trim());
    expect(d).toBe("0ms");
  });
});
