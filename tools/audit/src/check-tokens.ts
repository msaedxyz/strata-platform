// Criterion 2: collect all computed colour, font size and spacing values from the audited views again,
// and check that each value maps to a token in tokens.json (exact match after normalisation to rgb/px).
// Run alone: pnpm --filter @strata/audit check-tokens   (exit code 1 when a value does not map)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromDtcgColor } from './color.js';
import { outputDir, readCredentials } from './config.js';
import { gotoView } from './crawl.js';
import { dimensionToPx, walkTokens, type Group } from './dtcg.js';
import { closeSession, openSession, type Session } from './login.js';
import { collectRaw, emptyRaw, mergeRaw, type RawValues } from './tokens.js';
import { errorText, log, mdTable, Output } from './util.js';

export interface TokenIndex {
  colors: Set<string>;
  fontSizes: Set<string>;
  spacing: Set<string>;
}

export function indexTokens(doc: Group): TokenIndex {
  const idx: TokenIndex = { colors: new Set(), fontSizes: new Set(), spacing: new Set() };
  walkTokens(doc, (p, token, type) => {
    if (type === 'color') {
      const c = fromDtcgColor(token.$value);
      if (c) idx.colors.add(c);
    }
    if (type === 'dimension' && p.startsWith('font.size.')) {
      const v = dimensionToPx(token.$value);
      if (v) idx.fontSizes.add(v);
    }
    if (type === 'dimension' && p.startsWith('space.')) {
      const v = dimensionToPx(token.$value);
      if (v) idx.spacing.add(v);
    }
  });
  return idx;
}

export interface Unmapped {
  kind: 'color' | 'font-size' | 'spacing';
  value: string;
  count: number;
  where: string[];
}

export function compareRaw(raw: RawValues, idx: TokenIndex): { checked: number; unmapped: Unmapped[] } {
  const unmapped: Unmapped[] = [];
  let checked = 0;
  for (const [k, v] of Object.entries(raw.colors)) {
    checked++;
    if (!idx.colors.has(k)) unmapped.push({ kind: 'color', value: k, count: v.count, where: Object.keys(v.props) });
  }
  for (const [k, v] of Object.entries(raw.fontSizes)) {
    checked++;
    if (!idx.fontSizes.has(k)) unmapped.push({ kind: 'font-size', value: k, count: v.count, where: [] });
  }
  for (const [k, v] of Object.entries(raw.spacing)) {
    checked++;
    if (!idx.spacing.has(k)) unmapped.push({ kind: 'spacing', value: k, count: v.count, where: Object.keys(v.props) });
  }
  return { checked, unmapped };
}

export interface CheckResult {
  pass: boolean;
  checked: number;
  unmapped: Unmapped[];
  views: string[];
}

export async function checkTokensInSession(
  s: Session,
  out: Output,
  views: { name: string; url: string }[],
  tokensFile: string,
): Promise<CheckResult> {
  const doc = JSON.parse(fs.readFileSync(tokensFile, 'utf8')) as Group;
  const idx = indexTokens(doc);
  const raw = emptyRaw();
  for (const v of views) {
    try {
      s.guard.setActivity(`check-tokens ${v.name}`);
      await gotoView(s.page, v.url);
      mergeRaw(raw, await collectRaw(s.page), v.name);
    } catch (e) {
      log(`check-tokens: view ${v.name} failed: ${errorText(e)}`);
    }
  }
  const { checked, unmapped } = compareRaw(raw, idx);
  const result: CheckResult = { pass: unmapped.length === 0 && views.length > 0, checked, unmapped, views: views.map((v) => v.name) };
  writeCheckResult(out, result, tokensFile);
  return result;
}

export function writeCheckResult(out: Output, r: CheckResult, tokensFile: string): void {
  out.writeJson('check-tokens.json', r);
  const lines = [
    '# Token check (criterion 2)',
    '',
    `- Token file: ${path.basename(tokensFile)}`,
    `- Views: ${r.views.join(', ')}`,
    `- Values checked: ${r.checked}`,
    `- Values with no token: ${r.unmapped.length}`,
    `- Result: ${r.pass ? 'PASS' : 'FAIL'}`,
    '',
  ];
  if (r.unmapped.length) lines.push(mdTable(['Kind', 'Value', 'Count', 'Properties'], r.unmapped.map((u) => [u.kind, u.value, u.count, u.where.join(', ')])));
  out.writeText('check-tokens.md', lines.join('\n'));
}

async function main(): Promise<number> {
  const creds = readCredentials();
  if ('missing' in creds) {
    log(`check-tokens: missing environment variables: ${creds.missing.join(', ')}`);
    return 2;
  }
  const out = new Output(outputDir());
  const tokensFile = path.resolve(process.env.AUDIT_TOKENS_FILE ?? out.path('tokens.json'));
  const views = out.readJson<{ name: string; url: string }[]>('views.json');
  if (!views || !fs.existsSync(tokensFile)) {
    log('check-tokens: run the audit first (views.json or tokens.json is missing)');
    return 2;
  }
  const s = await openSession(creds);
  let result: CheckResult;
  try {
    result = await checkTokensInSession(s, out, views, tokensFile);
  } finally {
    await closeSession(s);
  }
  log(`check-tokens: ${result.checked} values checked, ${result.unmapped.length} with no token: ${result.pass ? 'PASS' : 'FAIL'}`);
  for (const u of result.unmapped.slice(0, 50)) log(`  unmapped ${u.kind} ${u.value} (${u.count})`);
  return result.pass ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      log(`check-tokens failed: ${errorText(e)}`);
      process.exit(2);
    },
  );
}
