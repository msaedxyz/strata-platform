// Log in with the credentials from the environment, keep the browser state in a temporary
// directory outside the repository, log out at the end and delete the state (docs/01-audit.md, access 1, 8, 9).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { findRepoRoot, loadConfig, type Credentials } from './config.js';
import { NetworkGuard } from './guard.js';
import { registerSecret } from './redact.js';
import { classifyControl, type ControlDescriptor } from './safety.js';
import { errorText, inPage, log, sleep } from './util.js';

const USERNAME_SELECTORS = [
  'input[autocomplete="username"]',
  'input[type="email"]',
  'input[name*="user" i]',
  'input[name*="email" i]',
  'input[name*="login" i]',
  'input[id*="user" i]',
  'input[id*="email" i]',
  'input[id*="login" i]',
  'input[type="text"]',
  'input:not([type])',
];
const SUBMIT_TEXT = /^(log\s*-?\s*in|sign\s*-?\s*in|continue|next|submit|enter|go)$/i;

async function firstVisible(scope: Page | Locator, selectors: string[]): Promise<Locator | undefined> {
  for (const s of selectors) {
    const loc = scope.locator(s);
    const n = await loc.count();
    for (let i = 0; i < n; i++) {
      const item = loc.nth(i);
      if (await item.isVisible().catch(() => false)) return item;
    }
  }
  return undefined;
}

async function visiblePassword(page: Page): Promise<Locator | undefined> {
  return firstVisible(page, ['input[type="password"]']);
}

async function findSubmit(page: Page, near: Locator | undefined): Promise<Locator | undefined> {
  const form = near ? near.locator('xpath=ancestor::form[1]') : undefined;
  if (form && (await form.count())) {
    const inForm = await firstVisible(form, ['button[type="submit"]', 'input[type="submit"]', 'button:not([type])']);
    if (inForm) return inForm;
  }
  const buttons = page.locator('button, [role="button"], input[type="submit"]');
  const n = await buttons.count();
  for (let i = 0; i < n; i++) {
    const b = buttons.nth(i);
    if (!(await b.isVisible().catch(() => false))) continue;
    const text = ((await b.innerText().catch(() => '')) || (await b.getAttribute('value')) || '').trim();
    if (SUBMIT_TEXT.test(text)) return b;
  }
  return undefined;
}

export async function login(page: Page, guard: NetworkGuard, creds: Credentials): Promise<void> {
  const cfg = loadConfig();
  guard.setPhase('login');
  guard.setActivity('login');
  await page.goto(creds.url, { waitUntil: 'domcontentloaded', timeout: cfg.crawl.navTimeoutMs });
  await page.waitForLoadState('load', { timeout: cfg.crawl.navTimeoutMs }).catch(() => undefined);
  await sleep(500);

  let password = await visiblePassword(page);
  let username = await firstVisible(page, USERNAME_SELECTORS);
  if (!password && !username) {
    // Wait for a client-side login form to render.
    await page.locator('input[type="password"], input[type="email"], input[autocomplete="username"]').first().waitFor({ timeout: 10000 }).catch(() => undefined);
    password = await visiblePassword(page);
    username = await firstVisible(page, USERNAME_SELECTORS);
  }
  if (!password && !username) {
    throw new Error('Login form not found: no username or password field is visible');
  }
  if (username) await username.fill(creds.username);
  if (!password) {
    // Two-step login: the password field appears after "Next".
    const next = await findSubmit(page, username);
    if (!next) throw new Error('Login form not found: no password field and no Next button');
    await next.click();
    await page.locator('input[type="password"]').first().waitFor({ state: 'visible', timeout: 15000 });
    password = await visiblePassword(page);
  }
  if (!password) throw new Error('Login form not found: the password field did not appear');
  await password.fill(creds.password);
  const submit = await findSubmit(page, password);
  const before = page.url();
  if (submit) await submit.click();
  else await password.press('Enter');

  const deadline = Date.now() + cfg.crawl.navTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(250);
    const still = await visiblePassword(page);
    if (!still && page.url() !== before) break;
    if (!still && Date.now() - (deadline - cfg.crawl.navTimeoutMs) > 3000) break;
  }
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await sleep(cfg.crawl.settleMs);
  if (await visiblePassword(page)) throw new Error('Login failed: the password field is still visible after submit');
  guard.setPhase('audit');
  guard.setActivity('post-login');
}

export async function logout(page: Page, guard: NetworkGuard): Promise<{ done: boolean; method: string }> {
  const cfg = loadConfig();
  guard.setPhase('logout');
  guard.setActivity('logout');
  try {
    const tryClickLogout = async (): Promise<boolean> => {
      const controls = await inPage<(ControlDescriptor & { id: string })[]>(page, 'controls', { onlyVisible: true });
      for (const c of controls) {
        if (classifyControl(c, 'logout').allowed) {
          await page.locator(`[data-sa-id="${c.id}"]`).click({ timeout: 5000 });
          await page.waitForLoadState('domcontentloaded').catch(() => undefined);
          await sleep(cfg.crawl.settleMs);
          return true;
        }
      }
      return false;
    };
    if (await tryClickLogout()) return { done: true, method: 'log out control' };
    // Open the user or account menus, then look again.
    const openers = (await inPage<(ControlDescriptor & { id: string })[]>(page, 'controls', { onlyVisible: true })).filter(
      (c) => classifyControl(c, 'menu').allowed,
    );
    for (const o of openers.reverse()) {
      const loc = page.locator(`[data-sa-id="${o.id}"]`);
      await loc.hover({ timeout: 3000 }).catch(() => undefined);
      await sleep(cfg.crawl.menuSettleMs);
      if (await tryClickLogout()) return { done: true, method: 'log out control in a menu (hover)' };
      await loc.click({ timeout: 3000 }).catch(() => undefined);
      await sleep(cfg.crawl.menuSettleMs);
      if (await tryClickLogout()) return { done: true, method: 'log out control in a menu' };
      await page.keyboard.press('Escape').catch(() => undefined);
    }
    await page.context().clearCookies();
    return { done: false, method: 'no log out control found: cookies cleared in the browser only' };
  } catch (e) {
    await page.context().clearCookies().catch(() => undefined);
    return { done: false, method: `log out failed (${errorText(e)}): cookies cleared in the browser only` };
  } finally {
    guard.setPhase('closed');
  }
}

export interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  guard: NetworkGuard;
  stateDir: string;
  creds: Credentials;
}

/** The init script adds a passive React DevTools style hook so that stack.ts can read the renderer version. */
const INIT_SCRIPT = `
(() => {
  try {
    window.__saRenderers = [];
    if (!window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
      const renderers = new Map();
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        renderers, supportsFiber: true, isDisabled: false, hasUnsupportedRendererAttached: false,
        inject(r) { window.__saRenderers.push({ version: r && r.version, pkg: r && r.rendererPackageName }); const id = renderers.size + 1; renderers.set(id, r); return id; },
        onCommitFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {}, on() {}, off() {}, emit() {}, sub() { return () => {}; }
      };
    }
  } catch (e) {}
})();
`;

export async function openSession(creds: Credentials): Promise<Session> {
  const cfg = loadConfig();
  registerSecret(creds.username);
  registerSecret(creds.password);
  try {
    const u = new URL(creds.url);
    registerSecret(decodeURIComponent(u.password));
  } catch {
    // Not a URL: login fails later with a clear message.
  }
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-audit-state-'));
  const repo = path.resolve(findRepoRoot());
  if (path.resolve(stateDir).startsWith(repo + path.sep)) {
    fs.rmSync(stateDir, { recursive: true, force: true });
    throw new Error('The temporary directory is inside the repository. Set TMPDIR to a directory outside it.');
  }
  const browser = await chromium.launch({ headless: process.env.AUDIT_HEADED !== '1' });
  const context = await browser.newContext({
    viewport: cfg.primaryViewport,
    serviceWorkers: 'block',
    acceptDownloads: false,
    reducedMotion: 'no-preference',
  });
  await context.addInitScript({ content: INIT_SCRIPT });
  const guard = new NetworkGuard({ username: creds.username, password: creds.password });
  await guard.attach(context);
  const page = await context.newPage();
  page.setDefaultTimeout(cfg.crawl.navTimeoutMs);
  // Never accept a confirm() or prompt() dialog. Never follow a popup window (window.open).
  page.on('dialog', (d) => void d.dismiss().catch(() => undefined));
  page.on('popup', (p) => void p.close().catch(() => undefined));
  const session: Session = { browser, context, page, guard, stateDir, creds };
  try {
    await login(page, guard, creds);
    await context.storageState({ path: path.join(stateDir, 'state.json') });
  } catch (e) {
    await closeSession(session, { skipLogout: true });
    throw e;
  }
  return session;
}

export interface CloseResult {
  loggedOut: boolean;
  logoutMethod: string;
  stateDir: string;
  stateDeleted: boolean;
}

export async function closeSession(s: Session, opts: { skipLogout?: boolean } = {}): Promise<CloseResult> {
  let loggedOut = false;
  let logoutMethod = 'skipped';
  if (!opts.skipLogout) {
    const r = await logout(s.page, s.guard).catch((e) => ({ done: false, method: errorText(e) }));
    loggedOut = r.done;
    logoutMethod = r.method;
  }
  await s.context.close().catch(() => undefined);
  await s.browser.close().catch(() => undefined);
  fs.rmSync(s.stateDir, { recursive: true, force: true });
  const stateDeleted = !fs.existsSync(s.stateDir);
  log(`Browser state deleted: ${stateDeleted}`);
  return { loggedOut, logoutMethod, stateDir: s.stateDir, stateDeleted };
}
