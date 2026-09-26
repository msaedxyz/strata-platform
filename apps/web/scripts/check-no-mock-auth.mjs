#!/usr/bin/env node
// Fails the build when the test-only mock auth is in the production bundle (apps/web/src/auth/mockAuth.ts).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "E2E_MOCK_AUTH_MARKER_DO_NOT_SHIP";
const dist = join(dirname(fileURLToPath(import.meta.url)), "..", process.argv[2] ?? "dist");

if (!existsSync(dist)) {
  console.error(`check-no-mock-auth: ${dist} does not exist. Build first.`);
  process.exit(1);
}

const hits = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|mjs|html)$/.test(name) && readFileSync(p, "utf8").includes(MARKER)) hits.push(p);
  }
};
walk(dist);

if (hits.length) {
  console.error(`check-no-mock-auth: the test-only auth is in the build:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log("check-no-mock-auth: the production build has no test-only auth.");
