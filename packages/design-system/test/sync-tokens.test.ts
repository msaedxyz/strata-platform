// pnpm tokens:sync: reads audit/tokens.json, validates DTCG, copies it and removes the provisional flag.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validate, valueToCss } from "../scripts/dtcg.mjs";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(pkg, "scripts", "sync-tokens.mjs");

function run(args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

describe("tokens:sync", () => {
  it("copies a valid audit file and removes the provisional flag", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokens-"));
    const audit = JSON.parse(readFileSync(join(pkg, "tokens", "infora.tokens.json"), "utf8"));
    const from = join(dir, "tokens.json");
    const to = join(dir, "out.tokens.json");
    writeFileSync(from, JSON.stringify(audit));
    const res = run(["--from", from, "--to", to, "--no-build"]);
    expect(res.status, res.stderr).toBe(0);
    const out = JSON.parse(readFileSync(to, "utf8"));
    expect(out.$extensions.strata.provisional).toBeUndefined();
    expect(out.$extensions.strata.reason).toBeUndefined();
    expect(out.$extensions.strata.source).toBe("tokens.json");
    expect(out.color.bg.base).toEqual(audit.color.bg.base);
  });

  it("rejects a file that is not valid DTCG", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokens-"));
    const from = join(dir, "tokens.json");
    writeFileSync(from, JSON.stringify({ color: { $type: "colour", bg: { base: { $value: "{color.missing}" } } } }));
    const res = run(["--from", from, "--to", join(dir, "out.json"), "--no-build"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("unknown $type colour");
    expect(res.stderr).toContain("does not resolve");
  });

  it("reports token names that the components use and the audit does not have", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokens-"));
    const from = join(dir, "tokens.json");
    writeFileSync(from, JSON.stringify({ color: { $type: "color", bg: { base: { $value: "#000000" } } } }));
    const res = run(["--from", from, "--to", join(dir, "out.json"), "--no-build"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("color.text.primary");
  });

  it("fails with a clear message when the audit file does not exist", () => {
    const res = run(["--from", join(tmpdir(), "no-such-audit", "tokens.json"), "--no-build"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Run the Infora audit first");
  });
});

describe("DTCG helpers", () => {
  it("accepts the older string values", () => {
    const { errors } = validate({ space: { $type: "dimension", 1: { $value: "4px" } }, c: { $type: "color", a: { $value: "#fff" } } });
    expect(errors).toEqual([]);
  });

  it("converts values to CSS", () => {
    const ref = (p: string) => `var(--${p})`;
    expect(valueToCss("dimension", { value: 4, unit: "px" }, ref)).toBe("4px");
    expect(valueToCss("color", { colorSpace: "srgb", components: [0, 0, 0], alpha: 0.5 }, ref)).toBe("rgb(0 0 0 / 0.5)");
    expect(valueToCss("cubicBezier", [0.2, 0, 0, 1], ref)).toBe("cubic-bezier(0.2, 0, 0, 1)");
    expect(valueToCss("fontFamily", ["Segoe UI", "sans-serif"], ref)).toBe('"Segoe UI", sans-serif');
    expect(valueToCss("color", "{color.bg.base}", ref)).toBe("var(--color.bg.base)");
  });
});
