// Run the whole Infora audit with one command:
//   INFORA_URL=... INFORA_USERNAME=... INFORA_PASSWORD=... pnpm --filter @strata/audit audit
// Output: <repo>/audit (or AUDIT_OUT_DIR). Exit code 0 when criteria 1 to 7 of docs/01-audit.md pass,
// 1 when a criterion fails, 2 when the audit cannot start (missing variables, login failure),
// 3 when the output directory is not ignored by git.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditA11y, writeA11y } from './a11y.js';
import { auditBehaviour, writeBehaviour, type BehaviourReport } from './behaviour.js';
import { checkTokensInSession, type CheckResult } from './check-tokens.js';
import { ComponentInventory, captureComponents, writeComponents } from './components.js';
import { findRepoRoot, loadConfig, outputDir, readCredentials } from './config.js';
import { crawl, gotoView, type View } from './crawl.js';
import { validateDtcg } from './dtcg.js';
import { Gaps } from './gaps.js';
import { runGitleaks, type GitleaksResult } from './gitleaks.js';
import { auditLayout, writeLayout, type LayoutReport } from './layout.js';
import { closeSession, openSession, type CloseResult, type Session } from './login.js';
import { writeNetwork } from './network.js';
import { auditStack, writeStack } from './stack.js';
import { collectFontsIcons, collectRaw, emptyRaw, mergeRaw, summariseFonts, summariseIcons, writeTokens, type FontsIcons } from './tokens.js';
import { errorText, log, mdTable, Output } from './util.js';

type Status = 'pass' | 'fail' | 'not-run' | 'manual';

interface Summary {
  started: string;
  finished?: string;
  outputDir: string;
  views: number;
  criteria: Record<string, { status: Status; detail: string }>;
  safety: { loggedOut: boolean; logoutMethod: string; stateDir: string; stateDeleted: boolean } | null;
  gitleaks?: GitleaksResult;
}

/** docs/01-audit.md, access and safety 3: /audit must be ignored by git before the first capture. */
function checkIgnored(dir: string): { ok: boolean; detail: string } {
  const repo = findRepoRoot();
  const rel = path.relative(repo, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { ok: true, detail: 'output directory is outside the repository' };
  const r = spawnSync('git', ['-C', repo, 'check-ignore', '-q', `${rel}/probe.png`], { encoding: 'utf8' });
  if (r.error) return { ok: false, detail: `git is not available: ${r.error.message}` };
  return r.status === 0 ? { ok: true, detail: 'ignored by .gitignore' } : { ok: false, detail: `${rel} is not ignored by git. Add "/${rel}" to .gitignore first` };
}

function writeSummary(out: Output, s: Summary): void {
  out.writeJson('summary.json', s);
  const lines = [
    '# Audit summary',
    '',
    `- Started: ${s.started}`,
    `- Finished: ${s.finished ?? 'not finished'}`,
    `- Views audited: ${s.views}`,
    `- Logged out: ${s.safety ? `${s.safety.loggedOut} (${s.safety.logoutMethod})` : 'n/a'}`,
    `- Browser state deleted: ${s.safety ? s.safety.stateDeleted : 'n/a'}`,
    '',
    mdTable(['Criterion (docs/01-audit.md)', 'Status', 'Detail'], Object.entries(s.criteria).map(([k, v]) => [k, v.status, v.detail])),
  ];
  out.writeText('summary.md', lines.join('\n'));
}

export async function runAudit(): Promise<number> {
  loadConfig();
  const dir = outputDir();
  const ignored = checkIgnored(dir);
  if (!ignored.ok) {
    log(`Audit stopped: ${ignored.detail}`);
    return 3;
  }
  const out = new Output(dir);
  const gaps = new Gaps();
  const summary: Summary = { started: new Date().toISOString(), outputDir: dir, views: 0, criteria: {}, safety: null };
  const creds = readCredentials();
  if ('missing' in creds) {
    gaps.add('tool', 'credentials', `missing environment variables: ${creds.missing.join(', ')}. The audit did not start`);
    gaps.write(out);
    summary.criteria['all'] = { status: 'not-run', detail: `missing ${creds.missing.join(', ')}` };
    writeSummary(out, summary);
    log(`Audit not started: missing ${creds.missing.join(', ')}`);
    return 2;
  }

  let s: Session;
  try {
    log('Log in');
    s = await openSession(creds);
  } catch (e) {
    gaps.add('tool', 'login', errorText(e));
    gaps.write(out);
    summary.criteria['all'] = { status: 'not-run', detail: `login failed: ${errorText(e)}` };
    writeSummary(out, summary);
    log(`Audit not started: ${errorText(e)}`);
    return 2;
  }
  const stateDir = s.stateDir;
  const cleanup = () => fs.rmSync(stateDir, { recursive: true, force: true });
  process.once('exit', cleanup);
  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  let views: View[] = [];
  let check: CheckResult | undefined;
  let dtcgErrors: string[] = ['tokens.json not written'];
  let layout: LayoutReport | undefined;
  let behaviour: BehaviourReport | undefined;
  let close: CloseResult | undefined;
  try {
    log('Crawl the navigation');
    views = await crawl(s, out, gaps);
    summary.views = views.length;
    const raw = emptyRaw();
    const fonts: FontsIcons[] = [];
    const inv = new ComponentInventory();
    for (const v of views) {
      log(`Tokens and components: ${v.name}`);
      try {
        s.guard.setActivity(`tokens ${v.name}`);
        await gotoView(s.page, v.url);
        mergeRaw(raw, await collectRaw(s.page), v.name);
        fonts.push(await collectFontsIcons(s.page));
        await captureComponents(s, out, gaps, v, inv);
      } catch (e) {
        gaps.add('tokens', v.name, errorText(e));
      }
    }
    log('Layout system');
    layout = await auditLayout(s, out, gaps, views);
    writeLayout(out, layout);
    log('Behaviour');
    behaviour = await auditBehaviour(s, out, gaps, views);
    writeBehaviour(out, behaviour);
    raw.focusRing = behaviour.focusRingColors;
    for (const [c, n] of Object.entries(behaviour.flashColors)) {
      const t = raw.colors[c] ?? (raw.colors[c] = { count: 0, props: {}, area: 0, textLen: 0, disabledText: 0, overlay: 0, raw: {}, samples: [] });
      t.count += n;
      t.props.flash = (t.props.flash ?? 0) + n;
    }
    // A second sample of each view catches values that live updates show.
    for (const v of views) {
      try {
        s.guard.setActivity(`tokens (second sample) ${v.name}`);
        await gotoView(s.page, v.url);
        mergeRaw(raw, await collectRaw(s.page));
      } catch (e) {
        gaps.add('tokens', `${v.name} (second sample)`, errorText(e));
      }
    }
    log('Stack');
    if (views[0]) await gotoView(s.page, views[0].url);
    writeStack(out, await auditStack(s.page, s.guard, gaps, ((behaviour.live as { protocols?: string[] }).protocols ?? []) as string[]));
    log('Accessibility');
    writeA11y(out, await auditA11y(s, gaps, views));
    writeComponents(out, inv, gaps);
    log('Tokens');
    const built = writeTokens(out, raw, summariseFonts(fonts, s.guard), summariseIcons(fonts));
    dtcgErrors = validateDtcg(built.tokens);
    if (dtcgErrors.length) gaps.add('tokens', 'tokens.json', `DTCG validation errors: ${dtcgErrors.slice(0, 5).join('; ')}`);
    log('Check tokens (criterion 2)');
    check = await checkTokensInSession(s, out, views, out.path('tokens.json'));
  } catch (e) {
    gaps.add('tool', 'audit run', errorText(e));
    log(`Audit error: ${errorText(e)}`);
  } finally {
    log('Log out and delete the browser state');
    close = await closeSession(s);
  }
  const net = writeNetwork(out, s.guard);
  summary.safety = { loggedOut: close.loggedOut, logoutMethod: close.logoutMethod, stateDir: close.stateDir, stateDeleted: close.stateDeleted };
  if (!close.loggedOut) gaps.add('tool', 'log out', close.logoutMethod);
  gaps.write(out);

  // ----- criteria -----
  const c = summary.criteria;
  c['1 routes in views.md or gaps.md'] = views.length
    ? { status: 'pass', detail: `${views.length} view(s) in views.md, ${gaps.items.filter((g) => g.category.startsWith('view-')).length} route(s) in gaps.md` }
    : { status: 'fail', detail: 'no view was captured' };
  c['2 each computed value maps to a token'] =
    check && check.pass && !dtcgErrors.length
      ? { status: 'pass', detail: `${check.checked} values checked, all map to tokens. tokens.json is valid DTCG` }
      : { status: 'fail', detail: check ? `${check.unmapped.length} unmapped value(s); ${dtcgErrors.length} DTCG error(s)` : 'check-tokens did not run' };
  c['3 components.md with observed states'] = out.exists('components.md') ? { status: 'pass', detail: 'components.md written' } : { status: 'fail', detail: 'components.md missing' };
  const inter = layout?.interactions ?? [];
  const unexplained = inter.filter((i) => !i.recorded && !i.serverRequests.length);
  c['4 panel interactions with screenshots'] =
    inter.length && !unexplained.length
      ? { status: 'pass', detail: `${inter.filter((i) => i.recorded).length} recorded, ${inter.filter((i) => i.serverRequests.length).length} persist to the server (in gaps.md)` }
      : { status: 'fail', detail: inter.length ? `not recorded: ${unexplained.map((i) => i.name).join(', ')}` : 'no panel grid found' };
  const bv = behaviour?.views ?? [];
  const bOk = views.length > 0 && bv.length === views.length && bv.every((v) => v.keys.length > 0 && v.focusOrder.length > 0);
  c['7 keyboard, command input and focus order for each view'] = bOk
    ? { status: 'pass', detail: `${bv.length} view(s) in behaviour.md` }
    : { status: 'fail', detail: 'a view has no keyboard result or no focus order' };
  c['6 no request changes data other than login'] = net.pass ? { status: 'pass', detail: 'see network.md' } : { status: 'fail', detail: net.offending.map((e) => `${e.method} ${e.endpoint}`).join('; ') };
  c['8 M0 progress report'] = { status: 'manual', detail: 'reports/m0.md summarises this run and gaps.md' };
  c['safety: browser state deleted, logged out'] = {
    status: close.stateDeleted ? 'pass' : 'fail',
    detail: `state deleted: ${close.stateDeleted}; logged out: ${close.loggedOut}`,
  };
  summary.finished = new Date().toISOString();
  c['5 gitleaks finds nothing in the audit directory'] = { status: 'not-run', detail: 'pending' };
  writeSummary(out, summary);

  // ----- criterion 5: scan everything that the run wrote -----
  if (process.env.AUDIT_GITLEAKS !== 'off') {
    log('gitleaks scan of the audit directory');
    const gl = runGitleaks(dir);
    summary.gitleaks = gl;
    c['5 gitleaks finds nothing in the audit directory'] = { status: gl.status, detail: gl.status === 'fail' ? `${gl.findings.length} finding(s): ${gl.findings.map((f) => `${f.rule} in ${f.file}`).join('; ')}` : `${gl.tool} ${gl.detail}`.trim() };
  } else {
    c['5 gitleaks finds nothing in the audit directory'] = { status: 'not-run', detail: 'AUDIT_GITLEAKS=off' };
  }
  writeSummary(out, summary);
  log(`Audit finished. Output: ${dir}`);
  for (const [k, v] of Object.entries(c)) log(`  ${v.status.toUpperCase().padEnd(7)} ${k}: ${v.detail}`);
  const requireGitleaks = process.env.AUDIT_REQUIRE_GITLEAKS !== '0';
  const failed = Object.entries(c).some(([k, v]) => v.status === 'fail' || (k.startsWith('5') && v.status === 'not-run' && requireGitleaks));
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runAudit().then(
    (code) => process.exit(code),
    (e) => {
      log(`Audit failed: ${errorText(e)}`);
      process.exit(1);
    },
  );
}
