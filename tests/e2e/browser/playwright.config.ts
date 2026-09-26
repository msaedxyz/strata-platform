// Browser end to end tests on the running local stack: nginx with the web build, the real API, the real Keycloak
// login page and the live stream. Start the stack first (make e2e does it). See tests/e2e/README.md.
// The Python suite (tests/e2e/python) runs first. It activates the acceptance brief and waits for the collectors.
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync("/opt/pw-browsers")) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = "/opt/pw-browsers";
}

const WEB_URL = process.env.E2E_WEB_URL ?? "http://localhost:8088";
const OUT = process.env.E2E_RESULTS_DIR ?? "../../../test-results/e2e";
// The Makefile runs the project "stack", then the project "perf", each with its own report name.
const REPORT = process.env.E2E_BROWSER_REPORT ?? "browser";

export default defineConfig({
  testDir: "tests",
  outputDir: `${OUT}/browser-artifacts`,
  // The tests share one stack and one database. They run one at a time, in file order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [
    ["list"],
    ["junit", { outputFile: `${OUT}/${REPORT}.xml` }],
    ["json", { outputFile: `${OUT}/${REPORT}.json` }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: WEB_URL,
    viewport: { width: 1920, height: 1080 },
    // No trace: a trace holds the login form and the bearer tokens (CLAUDE.md rule 5).
    trace: "off",
    screenshot: "only-on-failure",
    // The stack is on localhost. A proxy of the host must not see these requests.
    launchOptions: { args: ["--no-proxy-server"] },
  },
  projects: [
    { name: "stack", testIgnore: /perf\.spec\.ts/ },
    // docs/07 criteria 6 and 7 seed 10 000 signals and 500 deals. Run them last, after the scenarios
    // (make e2e-browser runs this project in a second command, also when a scenario fails).
    { name: "perf", testMatch: /perf\.spec\.ts/ },
  ],
});
