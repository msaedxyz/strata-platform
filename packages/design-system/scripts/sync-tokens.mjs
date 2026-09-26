#!/usr/bin/env node
// pnpm tokens:sync
// Read audit/tokens.json (from the Infora audit), validate it as DTCG, copy it to tokens/infora.tokens.json,
// remove the provisional flag and generate src/tokens.css and src/tokens.ts again.
//
// Options:
//   --from <file>      audit token file (default: <repo>/audit/tokens.json)
//   --to <file>        target token file (default: tokens/infora.tokens.json)
//   --allow-missing    continue when a token name that the components use is missing
//   --no-build         do not generate the CSS and TS files
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { flatten, validate } from "./dtcg.mjs";
import { REQUIRED_TOKENS } from "./required-tokens.mjs";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(pkg, "..", "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : fallback;
}

const from = arg("--from", join(repo, "audit", "tokens.json"));
const to = arg("--to", join(pkg, "tokens", "infora.tokens.json"));
const allowMissing = process.argv.includes("--allow-missing");
const noBuild = process.argv.includes("--no-build");

function fail(message) {
  console.error(`tokens:sync: ${message}`);
  process.exit(1);
}

if (!existsSync(from)) {
  fail(`${from} does not exist. Run the Infora audit first (docs/01-audit.md).`);
}

let tree;
try {
  tree = JSON.parse(readFileSync(from, "utf8"));
} catch (err) {
  fail(`${from} is not valid JSON: ${err instanceof Error ? err.message : err}`);
}

const { errors, warnings } = validate(tree);
for (const w of warnings) console.warn(`tokens:sync: warning: ${w}`);
if (errors.length) fail(`${from} is not a valid DTCG file:\n  ${errors.join("\n  ")}`);

const present = new Set(flatten(tree).map((t) => t.path));
const missing = REQUIRED_TOKENS.filter((p) => !present.has(p));
if (missing.length && !allowMissing) {
  fail(
    `the audit has no token for these names that the components use:\n  ${missing.join("\n  ")}\n` +
      "Map the audit names to these names, or use --allow-missing and update the components.",
  );
}

const ext = { ...(tree.$extensions ?? {}) };
const strata = { ...(ext.strata ?? {}) };
delete strata.provisional;
delete strata.reason;
strata.source = relative(dirname(to), from);
strata.syncedAt = new Date().toISOString();
ext.strata = strata;
tree.$extensions = ext;

writeFileSync(to, JSON.stringify(tree, null, 2) + "\n");
console.log(`tokens:sync: wrote ${relative(process.cwd(), to)} from ${relative(process.cwd(), from)}`);

const { build, BASE_FILE } = await import("./build-tokens.mjs");
if (!noBuild && resolve(to) === resolve(BASE_FILE)) {
  const data = build();
  console.log(`tokens:sync: generated ${data.list.length} tokens`);
}
