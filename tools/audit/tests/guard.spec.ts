// Browser tests of the safety guards with the real session code and the mock site:
// the login request passes, every other non-GET request is blocked, the classifier refuses the
// Save, Delete and Log out controls, and the browser state is deleted at the end.

import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { closeSession, openSession, type Session } from '../src/login.js';
import { classifyControl, type ControlDescriptor, type Purpose } from '../src/safety.js';
import { inPage, sleep } from '../src/util.js';
import { fakeCredentials } from './helpers.js';
import { startMockServer, type MockServer } from './mock-site/server.js';

const PURPOSES: Purpose[] = ['navigate', 'menu', 'tab', 'panel-view', 'layout', 'active-state'];

test.describe.serial('network guard and click guard', () => {
  const creds = fakeCredentials();
  let server: MockServer;
  let s: Session | undefined;

  test.beforeAll(async () => {
    server = await startMockServer(creds);
  });
  test.afterAll(async () => {
    if (s) await closeSession(s, { skipLogout: true }).catch(() => undefined);
    await server.close();
  });

  test('login passes the guard, and the state is stored outside the repository', async () => {
    s = await openSession({ url: `${server.url}/dashboard`, ...creds });
    expect(s.page.url()).toContain('/dashboard');
    const logins = server.requests.filter((r) => r.method === 'POST' && r.path === '/api/login');
    expect(logins).toHaveLength(1);
    expect(s.guard.entries.filter((e) => e.outcome === 'allowed-login')).toHaveLength(1);
    expect(fs.existsSync(`${s.stateDir}/state.json`)).toBe(true);
    expect(s.stateDir.startsWith(process.cwd())).toBe(false);
  });

  test('a non-GET request after login is blocked in the browser', async () => {
    const page = s!.page;
    const result = await page.evaluate(`fetch('/api/save', { method: 'POST', body: 'x' }).then(() => 'sent', () => 'blocked')`);
    expect(result).toBe('blocked');
    const del = await page.evaluate(`fetch('/api/delete', { method: 'DELETE' }).then(() => 'sent', () => 'blocked')`);
    expect(del).toBe('blocked');
    const get = await page.evaluate(`fetch('/api/quotes').then((r) => r.status, () => 'blocked')`);
    expect(get).toBe(200);
    expect(server.requests.some((r) => r.method !== 'GET' && r.path !== '/api/login')).toBe(false);
    const blocked = s!.guard.entries.filter((e) => e.outcome === 'blocked').map((e) => `${e.method} ${new URL(e.endpoint).pathname}`);
    expect(blocked).toEqual(expect.arrayContaining(['POST /api/save', 'DELETE /api/delete']));
  });

  test('during the login phase, only a login request passes', async () => {
    const g = s!.guard;
    g.setPhase('login');
    try {
      const r = await s!.page.evaluate(`fetch('/api/telemetry', { method: 'POST', body: '{}' }).then(() => 'sent', () => 'blocked')`);
      expect(r).toBe('blocked');
    } finally {
      g.setPhase('audit');
    }
    expect(server.requests.some((r) => r.path === '/api/telemetry')).toBe(false);
  });

  test('the click guard refuses Save, Delete, disabled and Log out controls, and allows navigation', async () => {
    const page = s!.page;
    await sleep(1200); // the panel bodies render after the loading skeleton
    const controls = await inPage<(ControlDescriptor & { id: string })[]>(page, 'controls', {});
    const byText = (t: string) => controls.find((c) => (c.text ?? '').trim() === t || c.ariaLabel === t);
    for (const t of ['Save', 'Delete', 'Submit order', 'Log out', 'Details']) {
      const c = byText(t);
      expect(c, t).toBeTruthy();
      for (const p of PURPOSES) expect(classifyControl(c!, p).allowed, `${t} / ${p}`).toBe(false);
    }
    // The Log out item is in a closed menu here. The final log out opens the menu first.
    expect(classifyControl({ ...byText('Log out')!, visible: true }, 'logout').allowed).toBe(true);
    expect(classifyControl(byText('Markets')!, 'navigate').allowed).toBe(true);
    expect(classifyControl(byText('Create alert')!, 'navigate').allowed).toBe(false);
    expect(classifyControl(byText('Maximise panel')!, 'panel-view').allowed).toBe(true);
    expect(classifyControl(byText('Close panel')!, 'layout').allowed).toBe(true);
    expect(classifyControl(byText('Close panel')!, 'panel-view').allowed).toBe(false);
    expect(classifyControl(byText('Latest')!, 'tab').allowed).toBe(true);
    expect(server.probes).toEqual([]);
  });

  test('log out at the end and delete the stored browser state', async () => {
    const r = await closeSession(s!);
    const stateDir = s!.stateDir;
    s = undefined;
    expect(r.loggedOut).toBe(true);
    expect(r.stateDeleted).toBe(true);
    expect(fs.existsSync(stateDir)).toBe(false);
    expect(server.requests.some((q) => q.method === 'POST' && q.path === '/api/logout')).toBe(true);
    expect(server.probes).toEqual([]);
  });
});
