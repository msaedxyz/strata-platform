// docs/07 criterion 4: the lint rule for raw values. These tests prove that the rule catches
// a raw hex colour and a raw px size, and that token references pass.
import { RuleTester } from "eslint";
import stylelint from "stylelint";
import tseslint from "typescript-eslint";
import { afterAll, describe, expect, it } from "vitest";
import rule from "../src/no-raw-values.js";
import stylelintConfig from "../src/stylelint.config.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.afterAll = afterAll;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("criterion 4: strata/no-raw-values (ESLint)", () => {
  tester.run("no-raw-values", rule, {
    valid: [
      { code: `const s = { color: "var(--color-text-primary)", padding: "var(--space-4)" };` },
      { code: `const el = <div style={{ width: "var(--size-nav-rail)", flex: 1, zIndex: 3 }} />;` },
      { code: `const el = <div style={{ margin: 0 }} />;` },
      { code: `import x from "./file#abc";` },
      { code: `const el = <a href="#add">Add</a>;` },
      { code: `const text = "The red line runs to Ndola";` },
      { code: `const grid = { w: 4, h: 6 };` },
    ],
    invalid: [
      { code: `const s = { color: "#ff0000" };`, errors: [{ messageId: "rawColor" }] },
      { code: `const el = <div style={{ background: "#0b0d10" }} />;`, errors: [{ messageId: "rawColor" }] },
      { code: `const el = <div style={{ width: "12px" }} />;`, errors: [{ messageId: "rawSize" }] },
      { code: `const el = <div style={{ width: 12 }} />;`, errors: [{ messageId: "rawSize" }] },
      { code: `const el = <div style={{ marginTop: -4 }} />;`, errors: [{ messageId: "rawSize" }] },
      { code: `const s = { padding: "1.5rem" };`, errors: [{ messageId: "rawSize" }] },
      { code: "const s = `border: 1px solid ${x}`;", errors: [{ messageId: "rawSize" }] },
      { code: `const s = { color: "rgb(1, 2, 3)" };`, errors: [{ messageId: "rawColor" }] },
      { code: `const s = { borderColor: "hsl(10 20% 30%)" };`, errors: [{ messageId: "rawColor" }] },
      { code: `const s = { color: "red" };`, errors: [{ messageId: "rawColor" }] },
      { code: `const el = <svg><rect fill="white" /></svg>;`, errors: [{ messageId: "rawColor" }] },
      { code: `const el = <svg><rect fill="#fff" /></svg>;`, errors: [{ messageId: "rawColor" }] },
    ],
  });
});

describe("criterion 4: stylelint config for CSS outside the design system", () => {
  it("reports a raw hex colour and a raw px size in CSS", async () => {
    const result = await stylelint.lint({
      code: ".a { color: #ff0000; padding: 12px; }\n",
      config: stylelintConfig,
    });
    const rules = result.results[0]?.warnings.map((w) => w.rule) ?? [];
    expect(rules).toContain("color-no-hex");
    expect(rules).toContain("unit-disallowed-list");
  });

  it("reports named colours and colour functions", async () => {
    const result = await stylelint.lint({
      code: ".a { color: red; background: rgb(1 2 3); }\n",
      config: stylelintConfig,
    });
    const rules = result.results[0]?.warnings.map((w) => w.rule) ?? [];
    expect(rules).toContain("color-named");
    expect(rules).toContain("function-disallowed-list");
  });

  it("accepts token references", async () => {
    const result = await stylelint.lint({
      code: ".a { color: var(--color-text-primary); padding: var(--space-4); margin: 0; }\n",
      config: stylelintConfig,
    });
    expect(result.results[0]?.warnings ?? []).toEqual([]);
  });
});
