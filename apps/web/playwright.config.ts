// End to end tests of the Strata shell (docs/07 criterion 3 and the quality floor).
// The dev server runs with the test-only mock auth (VITE_E2E_AUTH=mock). Tests intercept /api with Playwright.
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/opt/pw-browsers")) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";
}

const PORT = Number(process.env.E2E_PORT ?? 5174);

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e/results.json" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1920, height: 1080 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm --filter @strata/design-system tokens:build && pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    env: { VITE_E2E_AUTH: "mock" },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
