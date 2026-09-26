// Component inventory with states (docs/01-audit.md, "Components", criterion 3).

import type { Page } from '@playwright/test';
import { loadConfig } from './config.js';
import { gotoView, settle, type View } from './crawl.js';
import type { Gaps } from './gaps.js';
import type { Session } from './login.js';
import { screenshotMasks } from './mask.js';
import { classifyControl, type ControlDescriptor } from './safety.js';
import { errorText, inPage, mdTable, sleep, type Output } from './util.js';

export const STATES = ['default', 'hover', 'focus', 'active', 'disabled', 'loading', 'empty', 'error'] as const;
export type State = (typeof STATES)[number];

interface ScanEntry {
  count: number;
  visibleCount: number;
  instances: { mark: string; rect: { x: number; y: number; width: number; height: number }; focusable: boolean }[];
  variants: Record<string, number>;
  outline: string;
  states: Record<string, string>;
}

export interface ComponentRecord {
  name: string;
  views: string[];
  instances: number;
  variants: Record<string, number>;
  outline: string;
  states: Partial<Record<State, { file: string; view: string; note?: string }>>;
}

export class ComponentInventory {
  readonly records = new Map<string, ComponentRecord>();
  get(name: string): ComponentRecord {
    let r = this.records.get(name);
    if (!r) {
      r = { name, views: [], instances: 0, variants: {}, outline: '', states: {} };
      this.records.set(name, r);
    }
    return r;
  }
}

const PRIORITY = ['data-table', 'chart', 'map', 'feed-item', 'ticker', 'search', 'badge', 'tabs', 'modal', 'drawer', 'toast', 'panel-frame', 'button'];

async function shot(s: Session, out: Output, selector: string, rel: string): Promise<string | undefined> {
  const cfg = loadConfig();
  const loc = s.page.locator(selector).first();
  if (!(await loc.count())) return undefined;
  await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => undefined);
  const box = await loc.boundingBox();
  if (!box || box.width < 1 || box.height < 1) return undefined;
  const vp = s.page.viewportSize() ?? cfg.primaryViewport;
  const pad = cfg.components.screenshotPadding;
  const x = Math.max(0, Math.floor(box.x - pad));
  const y = Math.max(0, Math.floor(box.y - pad));
  const w = Math.min(vp.width - x, Math.ceil(box.width + 2 * pad));
  const h = Math.min(vp.height - y, Math.ceil(box.height + 2 * pad));
  if (w < 1 || h < 1) return undefined;
  const file = out.path(rel);
  await s.page.screenshot({ path: file, clip: { x, y, width: w, height: h }, mask: screenshotMasks(s.page, s.creds.username), animations: 'disabled' });
  return out.rel(file);
}

async function resetPointer(page: Page): Promise<void> {
  await page.mouse.move(1, 1).catch(() => undefined);
  await page.evaluate('document.activeElement && document.activeElement.blur && document.activeElement.blur()').catch(() => undefined);
}

async function scan(page: Page): Promise<Record<string, ScanEntry>> {
  const c = loadConfig().components;
  return inPage<Record<string, ScanEntry>>(page, 'components-scan', {
    definitions: c.definitions,
    stateSelectors: c.stateSelectors,
    emptyTextPatterns: c.emptyTextPatterns,
    stateContainers: c.stateContainers,
    maxInstances: c.maxInstancesPerComponent,
  });
}

export async function captureComponents(s: Session, out: Output, gaps: Gaps, view: View, inv: ComponentInventory): Promise<void> {
  const cfg = loadConfig();
  const { page } = s;
  s.guard.setActivity(`components ${view.name}`);

  // Loading state: watch the view while it loads.
  try {
    await page.goto(view.url, { waitUntil: 'commit' });
    const until = Date.now() + cfg.components.loadingWatchMs;
    while (Date.now() < until) {
      const r = await inPage<{ component: string } | null>(page, 'loading-find', {
        loading: cfg.components.stateSelectors.loading,
        definitions: cfg.components.definitions,
        priority: PRIORITY,
      }).catch(() => null);
      if (r) {
        const rec = inv.get(r.component);
        if (!rec.states.loading) {
          const file = await shot(s, out, '[data-sa-loading]', `components/${r.component}/loading.png`).catch(() => undefined);
          if (file) rec.states.loading = { file, view: view.name, note: 'seen while the view loads' };
        }
        break;
      }
      await sleep(100);
    }
  } catch (e) {
    gaps.add('component-state', `loading (${view.name})`, `load watch failed: ${errorText(e)}`);
  }
  await settle(page);

  const entries = await scan(page);
  const needActive: string[] = [];
  for (const [name, e] of Object.entries(entries)) {
    const rec = inv.get(name);
    if (e.visibleCount === 0) continue;
    if (!rec.views.includes(view.name)) rec.views.push(view.name);
    rec.instances += e.visibleCount;
    for (const [k, n] of Object.entries(e.variants)) rec.variants[k] = (rec.variants[k] ?? 0) + n;
    if (!rec.outline) rec.outline = e.outline;
    const first = `[data-sa-comp~="${name}-0"]`;
    // Each state has its own try, so that one failure (for example a toast that hides) does not stop the others.
    const attempt = async (state: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        gaps.add('component-state', `${name}: ${state} (${view.name})`, `capture failed: ${errorText(err)}`);
        await resetPointer(page);
      }
    };
    await attempt('default', async () => {
      if (rec.states.default) return;
      const f = await shot(s, out, first, `components/${name}/default.png`);
      if (f) rec.states.default = { file: f, view: view.name };
    });
    await attempt('hover', async () => {
      if (rec.states.hover) return;
      await page.locator(first).first().hover({ timeout: 3000, force: true });
      await sleep(250);
      const f = await shot(s, out, first, `components/${name}/hover.png`);
      if (f) rec.states.hover = { file: f, view: view.name, note: 'pointer over the centre of the component' };
      await resetPointer(page);
    });
    await attempt('focus', async () => {
      if (rec.states.focus || !e.instances[0]?.focusable) return;
      const target = page.locator(`${first}, ${first} a[href], ${first} button:not([disabled]), ${first} input:not([disabled]), ${first} [tabindex]:not([tabindex="-1"])`);
      const count = Math.min(await target.count(), 10);
      for (let i = 0; i < count; i++) {
        const t = target.nth(i);
        const ok = await t.evaluate((el) => (el as HTMLElement).tabIndex >= 0 && !(el as HTMLButtonElement).disabled).catch(() => false);
        if (!ok || !(await t.isVisible())) continue;
        await t.focus({ timeout: 2000 });
        await page.keyboard.press('Shift').catch(() => undefined); // makes :focus-visible match in Chromium
        await sleep(150);
        const f = await shot(s, out, first, `components/${name}/focus.png`);
        if (f) rec.states.focus = { file: f, view: view.name, note: 'keyboard focus on the first focusable element' };
        break;
      }
      await resetPointer(page);
    });
    for (const state of ['disabled', 'empty', 'error'] as const) {
      await attempt(state, async () => {
        if (rec.states[state] || !e.states[state]) return;
        const f = await shot(s, out, `[data-sa-state~="${e.states[state]}"]`, `components/${name}/${state}.png`);
        if (f) rec.states[state] = { file: f, view: view.name };
      });
    }
    if (!rec.states.active) needActive.push(name);
  }

  // Active state: mouse button down on a safe control, screenshot, then reload the view before the
  // button goes up. The mouseup lands on a new document, so no click event fires.
  for (const name of needActive) {
    try {
      const fresh = await scan(page);
      if (!fresh[name]?.instances.length) continue;
      const controls = await inPage<(ControlDescriptor & { id: string })[]>(page, 'controls', { within: `[data-sa-comp~="${name}-0"]`, onlyVisible: true });
      const safe = controls.find((c) => classifyControl(c, 'active-state').allowed);
      if (!safe) continue;
      const loc = page.locator(`[data-sa-id="${safe.id}"]`);
      const box = await loc.boundingBox();
      if (!box) continue;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await sleep(150);
      const f = await shot(s, out, `[data-sa-comp~="${name}-0"]`, `components/${name}/active.png`);
      await gotoView(page, view.url);
      await page.mouse.up();
      if (f) inv.get(name).states.active = { file: f, view: view.name, note: `mouse down on "${(safe.text || safe.ariaLabel || safe.tag).slice(0, 40)}" without release` };
    } catch (err) {
      await page.mouse.up().catch(() => undefined);
      gaps.add('component-state', `${name} active (${view.name})`, `capture failed: ${errorText(err)}`);
      await gotoView(page, view.url).catch(() => undefined);
    }
  }
}

export function writeComponents(out: Output, inv: ComponentInventory, gaps: Gaps): void {
  const cfg = loadConfig();
  const lines = [
    '# Components',
    '',
    'Components found by DOM heuristics and ARIA roles. Each state lists the screenshot when the audit observed it.',
    'The audit hovers, focuses and presses (without release) safe controls only. It does not click controls that change data,',
    'so states that need such a click (for example an open modal or a toast after a save) can be missing. gaps.md lists them.',
    '',
    mdTable(
      ['Component', 'Views', 'Instances', 'Observed states'],
      Object.keys(cfg.components.definitions).map((name) => {
        const r = inv.records.get(name);
        return [name, r?.views.join(', ') || '(not found)', r?.instances ?? 0, r ? Object.keys(r.states).join(', ') || '(none)' : '(none)'];
      }),
    ),
  ];
  for (const name of Object.keys(cfg.components.definitions)) {
    const r = inv.records.get(name);
    lines.push(`## ${name}`, '');
    if (!r || !r.views.length) {
      lines.push('Not found in the audited views.', '');
      gaps.add('component-missing', name, 'no element matched the heuristics in the audited views');
      continue;
    }
    lines.push(`- Views: ${r.views.join(', ')}`, `- Instances: ${r.instances}`, '');
    lines.push('### Variants', '', mdTable(['DOM signature', 'Count'], Object.entries(r.variants).sort((a, b) => b[1] - a[1]).slice(0, 10)));
    lines.push('### DOM structure (first instance)', '', '```', r.outline || '(empty)', '```', '');
    lines.push(
      '### States',
      '',
      mdTable(
        ['State', 'Observed', 'Screenshot', 'Note'],
        STATES.map((st) => {
          const v = r.states[st];
          return [st, v ? `yes (${v.view})` : 'no', v ? `[${v.file}](${v.file})` : '', v?.note ?? ''];
        }),
      ),
    );
    for (const st of STATES) if (!r.states[st]) gaps.add('component-state', `${name}: ${st}`, 'state not observable with read-only actions in the audited views');
  }
  out.writeText('components.md', lines.join('\n'));
  out.writeJson('components.json', [...inv.records.values()]);
}
