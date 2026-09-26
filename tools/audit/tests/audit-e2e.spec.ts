// End-to-end test: run the whole audit with one command against the local mock site, then check
// the outputs and the safety guarantees (docs/01-audit.md criteria 1 to 7, and access and safety rules).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { validateDtcg, type Group } from '../src/dtcg.js';
import { fakeCredentials, listFiles, secretForms } from './helpers.js';
import { startMockServer, type MockServer } from './mock-site/server.js';

const TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSX = path.join(TOOL, 'node_modules', '.bin', 'tsx');

function run(script: string, env: Record<string, string>): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(TSX, [path.join(TOOL, 'src', script)], { cwd: TOOL, env: { ...process.env, ...env } });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (code) => resolve({ code: code ?? -1, output }));
  });
}

test.describe.serial('full audit against the mock site', () => {
  const creds = fakeCredentials();
  let server: MockServer;
  let out: string;
  let env: Record<string, string>;
  let result: { code: number; output: string };
  const outputs: string[] = [];
  const read = (rel: string) => fs.readFileSync(path.join(out, rel), 'utf8');
  const exists = (rel: string) => fs.existsSync(path.join(out, rel));

  test.beforeAll(async () => {
    test.setTimeout(15 * 60 * 1000);
    server = await startMockServer(creds);
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-audit-e2e-'));
    env = {
      INFORA_URL: `${server.url}/dashboard`,
      INFORA_USERNAME: creds.username,
      INFORA_PASSWORD: creds.password,
      AUDIT_OUT_DIR: out,
      AUDIT_REQUIRE_GITLEAKS: '0',
      // Shorter waits for the test. The production values are in config/audit.config.json.
      AUDIT_CONFIG_OVERRIDES: JSON.stringify({ behaviour: { observeMs: 6000, gChordLetters: 'dmx' }, crawl: { settleMs: 1000 } }),
    };
    result = await run('run-all.ts', env);
    outputs.push(result.output);
  });

  test.afterAll(async () => {
    await server.close();
    if (out && !process.env.KEEP_AUDIT_OUTPUT) fs.rmSync(out, { recursive: true, force: true });
  });

  test('the one-command audit finishes with exit code 0', () => {
    expect(result.output).toContain('Audit finished');
    expect(result.code, result.output).toBe(0);
    const summary = JSON.parse(read('summary.json')) as { criteria: Record<string, { status: string }> };
    for (const [k, v] of Object.entries(summary.criteria)) {
      if (k.startsWith('5') || k.startsWith('8')) continue;
      expect(v.status, k).toBe('pass');
    }
  });

  test('the crawler never clicks Save or Delete', () => {
    expect(server.probes).not.toContain('save-clicked');
    expect(server.probes).not.toContain('delete-clicked');
    expect(server.requests.some((r) => ['/api/save', '/api/delete', '/api/command'].includes(r.path))).toBe(false);
  });

  test('only the login request (and the final log out) changes data; other non-GET requests are blocked', () => {
    const writes = server.requests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD');
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(['/api/login', '/api/logout']).toContain(w.path);
    expect(writes.filter((w) => w.path === '/api/login')).toHaveLength(1);
    const net = read('network.md');
    expect(net).toContain('## Criterion 6: PASS');
    expect(net).toMatch(/POST \| http:\/\/127\.0\.0\.1:\d+\/api\/telemetry \| fetch \| blocked/);
    expect(net).toMatch(/POST \| http:\/\/127\.0\.0\.1:\d+\/api\/layout \| fetch \| blocked/);
    expect(net).toMatch(/POST \| http:\/\/127\.0\.0\.1:\d+\/api\/login \| fetch \| allowed-login/);
  });

  test('all outputs are written', () => {
    for (const f of [
      'views.md',
      'views.json',
      'tokens.json',
      'raw-values.json',
      'components.md',
      'layout-system.md',
      'behaviour.md',
      'stack.md',
      'network.md',
      'a11y.md',
      'a11y.json',
      'gaps.md',
      'check-tokens.json',
      'summary.md',
    ]) {
      expect(exists(f), f).toBe(true);
    }
    for (const view of ['dashboard', 'markets', 'news', 'reports']) {
      for (const vp of ['1920x1080', '1440x900', '1280x800']) expect(exists(`screenshots/${view}/${vp}.png`), `${view} ${vp}`).toBe(true);
    }
    for (const c of ['navigation', 'top-bar', 'search', 'ticker', 'panel-frame', 'panel-header-controls', 'data-table', 'chart', 'feed-item', 'badge', 'tabs', 'button', 'text-input']) {
      expect(exists(`components/${c}/default.png`), c).toBe(true);
      expect(exists(`components/${c}/hover.png`), c).toBe(true);
    }
    expect(exists('components/button/disabled.png')).toBe(true);
    expect(exists('components/button/focus.png')).toBe(true);
    expect(exists('components/text-input/error.png')).toBe(true);
    expect(exists('components/panel-frame/loading.png')).toBe(true);
    expect(exists('components/panel-frame/empty.png')).toBe(true);
    expect(exists('components/navigation/active.png')).toBe(true);
    for (const i of ['drag', 'snap', 'resize', 'collapse', 'maximise', 'add']) expect(exists(`layout/${i}/01.png`), i).toBe(true);
    expect(exists('layout/drag/04.png')).toBe(true);
  });

  test('each route is in views.md or gaps.md, and sensitive pages are recorded by name only', () => {
    const views = read('views.md');
    for (const v of ['## Dashboard', '## Markets', '## News', '## Reports']) expect(views).toContain(v);
    for (const v of ['## Billing', '## API keys', '## Profile']) expect(views).not.toContain(v);
    const gaps = read('gaps.md');
    expect(gaps).toMatch(/\| view-sensitive \| Billing \|/);
    expect(gaps).toMatch(/\| view-sensitive \| API keys \|/);
    expect(gaps).toMatch(/\| view-sensitive \| Profile \|/);
    expect(gaps).toMatch(/\| view-needs-write \| Create alert \|/);
    expect(gaps).not.toContain('/account/api-keys');
    expect(gaps).not.toContain('/billing');
    expect(gaps).toMatch(/\| layout-interaction \| close \|.*persists to the server/);
    expect(fs.existsSync(path.join(out, 'screenshots', 'billing'))).toBe(false);
  });

  test('tokens.json is valid DTCG and has the named tokens of the mock design', () => {
    const tokens = JSON.parse(read('tokens.json')) as Group;
    expect(validateDtcg(tokens)).toEqual([]);
    const at = (p: string) => p.split('.').reduce<any>((n, k) => n?.[k], tokens);
    expect(at('color.bg.base.$value.hex')).toBe('#0b0e11');
    expect(at('color.bg.surface-1.$value.hex')).toBe('#12161c');
    expect(at('color.text.primary.$value.hex')).toBe('#e6e9ef');
    expect(at('color.focus.ring.$value.hex')).toBe('#60a5fa');
    expect(at('color.state.positive.$value.hex')).toBe('#16c784');
    expect(at('color.state.negative.$value.hex')).toBe('#ea3943');
    expect(at('color.state.accent.$value.hex')).toBe('#3b82f6');
    expect(at('font.family.mono.$value')).toContain('ui-monospace');
    expect(at('font.numeric.$extensions')['io.strata.audit'].fontVariantNumeric).toBe('tabular-nums');
    expect(at('space.2.$value')).toEqual({ value: 8, unit: 'px' });
    expect(at('radius.md.$value')).toEqual({ value: 4, unit: 'px' });
    expect(at('z.dropdown.$value')).toBe(30);
    expect(at('z.modal.$value')).toBe(50);
    expect(at('motion.duration.fast.$value')).toEqual({ value: 120, unit: 'ms' });
  });

  test('check-tokens maps every collected value (criterion 2), and fails when a token is missing', async () => {
    const inRun = JSON.parse(read('check-tokens.json')) as { pass: boolean; checked: number; unmapped: unknown[] };
    expect(inRun.pass).toBe(true);
    expect(inRun.checked).toBeGreaterThan(20);
    expect(inRun.unmapped).toEqual([]);

    const ok = await run('check-tokens.ts', env);
    outputs.push(ok.output);
    expect(ok.code, ok.output).toBe(0);

    const tokens = JSON.parse(read('tokens.json')) as Record<string, unknown>;
    delete tokens.color;
    const broken = path.join(out, 'tokens-without-colours.json');
    fs.writeFileSync(broken, JSON.stringify(tokens));
    const bad = await run('check-tokens.ts', { ...env, AUDIT_TOKENS_FILE: broken });
    outputs.push(bad.output);
    expect(bad.code).toBe(1);
    const r = JSON.parse(read('check-tokens.json')) as { pass: boolean; unmapped: { kind: string }[] };
    expect(r.pass).toBe(false);
    expect(r.unmapped.some((u) => u.kind === 'color')).toBe(true);
    expect(r.unmapped.some((u) => u.kind !== 'color')).toBe(false);
  });

  test('components.md, layout-system.md and behaviour.md describe the observed behaviour', () => {
    const comp = read('components.md');
    for (const c of ['## navigation', '## ticker', '## panel-frame', '## data-table', '## modal']) expect(comp).toContain(c);
    const layout = read('layout-system.md');
    expect(layout).toContain('12 columns');
    expect(layout).toContain('mock-layout-v1:/dashboard');
    expect(layout).toContain('Placeholder during drag: yes');
    expect(layout).toContain('Snaps to the column grid: yes');
    const b = read('behaviour.md');
    for (const v of ['Dashboard', 'Markets', 'News', 'Reports']) {
      const section = b.split(`## View: ${v}`)[1]?.split('## View: ')[0] ?? '';
      expect(section, v).toContain('### Keyboard shortcuts');
      expect(section, v).toContain('### Command input and search');
      expect(section, v).toMatch(/### Focus order \(Tab\)\n\n1\. /);
    }
    expect(b).toContain('| / | moves focus to input "Search"');
    expect(b).toContain('opens dialog "Command palette"');
    expect(b).toContain('opens dialog "Keyboard shortcuts"');
    expect(b).toContain('Typed "help" (no Enter). Suggestions: HELP Show help');
    expect(b).toContain('Server-Sent Events (EventSource)');
    expect(b).toMatch(/\| flash-up \| \d+ \| \d+ \| [56]\d\d \| rgba\(22, 199, 132, 0\.2\)/);
    expect(b).toContain('Pauses on hover: yes');
    expect(b).toMatch(/Speed: -\d+(\.\d)? px\/s, direction right-to-left/);
    const a11y = JSON.parse(read('a11y.json')) as { views: unknown[] };
    expect(a11y.views).toHaveLength(4);
  });

  test('no credential appears in any output, log or state file, and the browser state is deleted', () => {
    const files = listFiles(out);
    expect(files.length).toBeGreaterThan(50);
    const forms = [...secretForms(creds.username), ...secretForms(creds.password)];
    for (const f of files) {
      const buf = fs.readFileSync(f);
      for (const s of forms) expect(buf.includes(s), `${path.relative(out, f)} contains a credential`).toBe(false);
    }
    for (const o of outputs) for (const s of forms) expect(o.includes(s), 'process output contains a credential').toBe(false);
    const summary = JSON.parse(read('summary.json')) as { safety: { stateDir: string; stateDeleted: boolean; loggedOut: boolean } };
    expect(summary.safety.stateDeleted).toBe(true);
    expect(summary.safety.loggedOut).toBe(true);
    expect(fs.existsSync(summary.safety.stateDir)).toBe(false);
    // The username is on the page (user menu). The text outputs must hold the redaction marker instead.
    expect(read('views.md') + read('behaviour.md') + read('components.md')).not.toContain(creds.username);
  });
});
