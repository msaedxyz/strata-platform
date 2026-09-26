// Shared flat ESLint configuration for the Strata TypeScript packages.
// rawValues: true turns on strata/no-raw-values. Every package outside packages/design-system sets it.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import strata from "./index.js";

const IGNORES = [
  "**/dist/**",
  "**/storybook-static/**",
  "**/node_modules/**",
  "**/coverage/**",
  "**/test-results/**",
  "**/playwright-report/**",
  "**/src/tokens.ts",
  "**/src/tokens.css",
];

/**
 * @param {{ rawValues?: boolean, react?: boolean }} [options]
 * @returns {import("eslint").Linter.Config[]}
 */
export function strataConfig(options = {}) {
  const { rawValues = true, react = true } = options;
  /** @type {import("eslint").Linter.Config[]} */
  const configs = [
    { ignores: IGNORES },
    js.configs.recommended,
    ...(/** @type {import("eslint").Linter.Config[]} */ (tseslint.configs.recommended)),
    {
      files: ["**/*.{js,mjs,cjs,ts,tsx,jsx}"],
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        globals: { ...globals.browser, ...globals.node },
      },
      rules: {
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      },
    },
  ];
  if (react) {
    configs.push({
      files: ["**/*.{ts,tsx,jsx}"],
      plugins: { "react-hooks": reactHooks },
      rules: {
        "react-hooks/rules-of-hooks": "error",
        "react-hooks/exhaustive-deps": "warn",
      },
    });
  }
  if (rawValues) {
    configs.push({
      files: ["**/*.{js,mjs,cjs,ts,tsx,jsx}"],
      plugins: { strata },
      rules: { "strata/no-raw-values": "error" },
    });
  }
  return configs;
}

export default strataConfig;
