// @vitest-environment node
// The test-only auth bypass is compiled in only when VITE_E2E_AUTH=mock, never in the production build.
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const vite = join(app, "node_modules", ".bin", "vite");

function build(env: Record<string, string>) {
  const out = mkdtempSync(join(tmpdir(), "strata-web-"));
  const res = spawnSync(vite, ["build", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], {
    cwd: app,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  expect(res.status, res.stderr).toBe(0);
  return spawnSync(process.execPath, [join(app, "scripts", "check-no-mock-auth.mjs"), relative(app, out)], { cwd: app, encoding: "utf8" });
}

describe("test-only auth", () => {
  it("is not in the production build", () => {
    const check = build({ VITE_E2E_AUTH: "" });
    expect(check.status, check.stderr).toBe(0);
  }, 120_000);

  it("is in a build with VITE_E2E_AUTH=mock, so the check can find it", () => {
    const check = build({ VITE_E2E_AUTH: "mock" });
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("the test-only auth is in the build");
  }, 120_000);
});
