// Visual parity test (docs/07 criterion 2). Run: pnpm --filter @strata/design-system test:visual
// The test needs the Infora audit (audit/components.md and audit/components/). Without it, the test is skipped
// with the message "blocked: no Infora audit (beta.infora.io unreachable)". It never passes without the audit.
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { readAudit } from "./audit";

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/opt/pw-browsers")) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";
}

const PORT = Number(process.env.STORYBOOK_PORT ?? 6007);
const audit = readAudit();

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  outputDir: "../test-results/visual",
  reporter: [["list"], ["json", { outputFile: "../test-results/visual/results.json" }]],
  use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${PORT}` },
  webServer: audit.available
    ? {
        command: `pnpm build:storybook && node visual/serve-static.mjs storybook-static ${PORT}`,
        cwd: "..",
        url: `http://127.0.0.1:${PORT}/iframe.html`,
        reuseExistingServer: true,
        timeout: 600_000,
      }
    : undefined,
});
