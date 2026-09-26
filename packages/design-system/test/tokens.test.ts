// docs/07 criterion 1: packages/design-system contains every token in /audit/tokens.json.
// When the audit does not exist (beta.infora.io unreachable), the provisional test checks that every
// token in tokens/infora.tokens.json exists in the generated CSS and TS.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cssVarName, flatten, validate } from "../scripts/dtcg.mjs";
import { REQUIRED_TOKENS } from "../scripts/required-tokens.mjs";
import { tokenList, tokenMeta, tokens, tokenValues } from "../src/tokens";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT = join(pkg, "..", "..", "audit", "tokens.json");
const auditExists = existsSync(AUDIT);
const tokenFile = JSON.parse(readFileSync(join(pkg, "tokens", "infora.tokens.json"), "utf8"));
const css = readFileSync(join(pkg, "src", "tokens.css"), "utf8");
const generatedPaths = new Set<string>(tokenList.map((t) => t.path));

function lookup(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), obj);
}

describe("criterion 1: design tokens", () => {
  it.skipIf(!auditExists)("criterion 1: every token in audit/tokens.json exists in the design system", () => {
    const audit = JSON.parse(readFileSync(AUDIT, "utf8"));
    const auditPaths = flatten(audit).map((t: { path: string }) => t.path);
    expect(auditPaths.length).toBeGreaterThan(0);
    const missing = auditPaths.filter((p: string) => !generatedPaths.has(p) || !css.includes(`${cssVarName(p)}:`));
    expect(missing).toEqual([]);
  });

  it.runIf(!auditExists)(
    "criterion 1 (provisional, blocked: no Infora audit): every token in tokens/infora.tokens.json exists in the generated CSS and TS",
    () => {
      const paths = flatten(tokenFile).map((t: { path: string }) => t.path);
      expect(paths.length).toBeGreaterThan(50);
      for (const p of paths) {
        expect(css, `CSS variable for ${p}`).toContain(`${cssVarName(p)}:`);
        expect(generatedPaths.has(p), `TS token list has ${p}`).toBe(true);
        expect(lookup(tokens, p), `tokens.${p}`).toBe(`var(${cssVarName(p)})`);
        expect(typeof lookup(tokenValues, p), `tokenValues.${p}`).toBe("string");
      }
    },
  );

  it.runIf(!auditExists)("the provisional token file is marked provisional with the reason", () => {
    expect(tokenFile.$extensions.strata.provisional).toBe(true);
    expect(tokenFile.$extensions.strata.reason).toContain("beta.infora.io blocked");
    expect(tokenMeta.provisional).toBe(true);
  });

  it("the token file is valid DTCG", () => {
    const { errors } = validate(tokenFile);
    expect(errors).toEqual([]);
  });

  it("the token file has every token name that the components use", () => {
    const paths = new Set(flatten(tokenFile).map((t: { path: string }) => t.path));
    expect(REQUIRED_TOKENS.filter((p: string) => !paths.has(p))).toEqual([]);
  });

  it("aliases become CSS variable references", () => {
    expect(css).toContain("--color-border-subtle: var(--color-bg-surface-3);");
    expect(tokenValues.color.border.subtle).toBe(tokenValues.color.bg["surface-3"]);
  });

  it("reduced motion sets every duration to zero", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    for (const name of ["fast", "normal", "slow"]) expect(reduced).toContain(`--motion-duration-${name}: 0ms;`);
  });

  it("the palette stays small: few distinct raw colour values", () => {
    const colors = new Set(tokenList.filter((t) => t.type === "color").map((t) => t.value));
    expect(colors.size).toBeLessThanOrEqual(16);
  });
});
