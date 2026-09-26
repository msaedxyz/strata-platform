// End to end tests of the Strata shell and modules (docs/07 criteria 3, 5 to 8 and the quality floor).
// The dev server runs with the test-only mock auth (VITE_E2E_AUTH=mock). Tests intercept /api with Playwright.
// The performance tests (docs/07 criteria 6 and 7) run against a production build with the same mock auth,
// because the dev server and the React development build are slower than what users get.
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/opt/pw-browsers")) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";
}

const PORT = Number(process.env.E2E_PORT ?? 5174);
const PERF_PORT = Number(process.env.E2E_PERF_PORT ?? PORT + 1);
const PERF = /perf\.spec\.ts/;

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
  projects: [
    { name: "e2e", testIgnore: PERF },
    // After the other tests, one test at a time, so that no other test competes for the CPU during a measurement.
    { name: "perf", testMatch: PERF, fullyParallel: false, dependencies: ["e2e"], use: { baseURL: `http://localhost:${PERF_PORT}` } },
  ],
  workers: process.env.CI ? 2 : undefined,
  webServer: [
    {
      command: `pnpm --filter @strata/design-system tokens:build && pnpm exec vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      env: { VITE_E2E_AUTH: "mock" },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // A production build with the test-only auth, in its own folder. The release build (dist/) never has it.
      command: `pnpm --filter @strata/design-system tokens:build && pnpm exec vite build --outDir dist-e2e --emptyOutDir --logLevel warn && pnpm exec vite preview --outDir dist-e2e --port ${PERF_PORT} --strictPort`,
      url: `http://localhost:${PERF_PORT}`,
      env: { VITE_E2E_AUTH: "mock" },
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    },
  ],
});
