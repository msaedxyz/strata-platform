// docs/07 criterion 2: for each component state in the audit, compare the Storybook story with the audit
// screenshot at 1920x1080 and 1440x900. The pixel difference must be 1 percent or less. Live data is masked.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import { readAudit } from "./audit";
import { comparePng, type Rect } from "./compare";

const VIEWPORTS = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1440x900", width: 1440, height: 900 },
];

/** Elements that show live data. Components mark them with data-live. Tests can add more with data-mask. */
const LIVE_SELECTOR = "[data-live], [data-mask], time";

const audit = readAudit();

test.describe("criterion 2: visual parity with the Infora audit", () => {
  if (!audit.available) {
    test("criterion 2: visual parity for each audited component state", () => {
      test.skip(true, audit.reason);
    });
    return;
  }

  for (const s of audit.states) {
    for (const vp of VIEWPORTS) {
      test(`criterion 2: ${s.component} / ${s.state} at ${vp.name}`, async ({ page }, info) => {
        const expectedPath = s.screenshot(vp.name);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.emulateMedia({ reducedMotion: "reduce" });
        const response = await page.goto(`/iframe.html?id=${s.storyId}&viewMode=story`);
        expect(response?.ok()).toBe(true);
        await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
        const root = page.locator("#storybook-root");
        await expect(root, `Strata story ${s.storyId} for Infora ${s.component} / ${s.state}`).not.toBeEmpty();
        await page.waitForLoadState("networkidle");

        // The audit crops each component, so the test takes the first element of the story, not the whole canvas.
        const target = root.locator(":scope > *").first();
        const rootBox = await target.boundingBox();
        const masks: Rect[] = [];
        for (const box of await page.locator(LIVE_SELECTOR).evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
          }),
        )) {
          masks.push({ x: box.x - (rootBox?.x ?? 0), y: box.y - (rootBox?.y ?? 0), width: box.width, height: box.height });
        }
        if (existsSync(s.maskFile)) masks.push(...(JSON.parse(readFileSync(s.maskFile, "utf8")) as Rect[]));

        const actual = await target.screenshot({ animations: "disabled" });
        const outDir = info.outputPath();
        mkdirSync(outDir, { recursive: true });
        writeFileSync(join(outDir, "strata.png"), actual);
        expect(expectedPath, `audit screenshot for ${s.component} / ${s.state} at ${vp.name}`).not.toBeNull();
        const expected = readFileSync(expectedPath!);
        const result = comparePng(actual, expected, masks);
        if (result.diff) {
          const diffFile = join(outDir, "diff.png");
          mkdirSync(dirname(diffFile), { recursive: true });
          writeFileSync(diffFile, PNG.sync.write(result.diff));
        }
        info.annotations.push({ type: "pixel-diff", description: result.message });
        expect(result.ok, `${s.component} / ${s.state} at ${vp.name}: ${result.message}`).toBe(true);
      });
    }
  }
});
