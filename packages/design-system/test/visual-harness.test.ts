// Unit tests for the visual parity harness (docs/07 criterion 2). The harness itself runs with Playwright.
import { existsSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { AUDIT_DIR, BLOCKED_MESSAGE, parseComponentsMarkdown, readAudit, slug } from "../visual/audit";
import { comparePng } from "../visual/compare";

function png(width: number, height: number, fill: [number, number, number]) {
  const img = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    img.data[i * 4] = fill[0];
    img.data[i * 4 + 1] = fill[1];
    img.data[i * 4 + 2] = fill[2];
    img.data[i * 4 + 3] = 255;
  }
  return img;
}

describe("visual harness", () => {
  it.runIf(!existsSync(AUDIT_DIR))("reports the blocked state when the audit does not exist", () => {
    const audit = readAudit();
    expect(audit.available).toBe(false);
    if (!audit.available) expect(audit.reason).toBe(BLOCKED_MESSAGE);
  });

  it("parses components.md with headings and States lines", () => {
    const md = "# Components\n\n## Button\n\n- States: default, hover, focus, disabled\n\n## Ticker strip\nStates: default, paused\n";
    expect(parseComponentsMarkdown(md)).toEqual([
      { component: "Button", states: ["default", "hover", "focus", "disabled"] },
      { component: "Ticker strip", states: ["default", "paused"] },
    ]);
  });

  it("parses components.md with a table", () => {
    const md = "| Component | Views | States |\n|---|---|---|\n| Data table | Dashboard | default, loading, empty |\n| `Badge` | All | default |\n";
    expect(parseComponentsMarkdown(md)).toEqual([
      { component: "Data table", states: ["default", "loading", "empty"] },
      { component: "Badge", states: ["default"] },
    ]);
  });

  it("makes story ids from names", () => {
    expect(slug("Ticker strip")).toBe("ticker-strip");
    expect(slug("DataTable")).toBe("data-table");
    expect(slug("pending approval")).toBe("pending-approval");
  });

  it("passes at 1 percent difference or less and fails above it", () => {
    const a = png(10, 10, [0, 0, 0]);
    const b = png(10, 10, [0, 0, 0]);
    b.data.set([255, 255, 255, 255], 0);
    expect(comparePng(PNG.sync.write(a), PNG.sync.write(b), []).ok).toBe(true);
    b.data.set([255, 255, 255, 255], 4);
    const res = comparePng(PNG.sync.write(a), PNG.sync.write(b), []);
    expect(res.diffPixels).toBe(2);
    expect(res.ok).toBe(false);
  });

  it("ignores masked live data", () => {
    const a = png(10, 10, [0, 0, 0]);
    const b = png(10, 10, [0, 0, 0]);
    for (let i = 0; i < 20; i++) b.data.set([255, 255, 255, 255], i * 4);
    const res = comparePng(PNG.sync.write(a), PNG.sync.write(b), [{ x: 0, y: 0, width: 10, height: 2 }]);
    expect(res.diffPixels).toBe(0);
    expect(res.ok).toBe(true);
  });

  it("fails when the sizes differ", () => {
    const res = comparePng(PNG.sync.write(png(10, 10, [0, 0, 0])), PNG.sync.write(png(10, 12, [0, 0, 0])), []);
    expect(res.ok).toBe(false);
    expect(res.message).toContain("size differs");
  });
});
