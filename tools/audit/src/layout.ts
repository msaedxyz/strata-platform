// Layout system (docs/01-audit.md, "Layout system", criterion 4).
// Interactions are recorded only when they do not persist to the server. The guard blocks each non-GET request;
// an interaction that tries one is reported in gaps.md and its screenshots are removed.
// localStorage and sessionStorage are restored after each interaction.

import type { Page } from '@playwright/test';
import { loadConfig, viewportName } from './config.js';
import { gotoView, type View } from './crawl.js';
import type { Gaps } from './gaps.js';
import type { NetworkGuard } from './guard.js';
import type { Session } from './login.js';
import { screenshotMasks } from './mask.js';
import { classifyControl, labelOf, matchesAny, type ControlDescriptor } from './safety.js';
import { errorText, inPage, mdTable, sleep, type Output } from './util.js';

interface Item {
  index: number;
  title: string;
  left: number;
  top: number;
  width: number;
  height: number;
  transform: string;
  position: string;
  className: string;
  resizeHandles: string[];
  dragHandle: string | null;
  draggable: boolean;
}

export interface LayoutScan {
  container: { selector: string; className: string; width: number; height: number; itemSelector: string | null } | null;
  items: Item[];
  cssGrids: { element: string; columns: number; templateColumns: string; templateRows: string; autoRows: string; rowGap: string; columnGap: string; children: number }[];
  placeholder: boolean;
}

export interface GridEstimate {
  cols?: number;
  colWidth?: number;
  rowHeight?: number;
  marginX?: number;
  marginY?: number;
  paddingX?: number;
  paddingY?: number;
  fitError?: number;
  colsCandidates?: number[];
  rowHeightCandidates?: number[];
}

export interface InteractionResult {
  name: string;
  view: string;
  recorded: boolean;
  files: string[];
  observation: string;
  localStorageKeysChanged: string[];
  sessionStorageKeysChanged: string[];
  indexedDbBefore: string[];
  indexedDbAfter: string[];
  serverRequests: string[];
}

export interface LayoutReport {
  perView: { view: string; scan: LayoutScan; estimate: GridEstimate; perViewport: { viewport: string; containerWidth: number; estimate: GridEstimate }[] }[];
  interactions: InteractionResult[];
  bundleHints: Record<string, string[]>;
  mediaQueries: Record<string, number>;
}

async function scanLayout(page: Page): Promise<LayoutScan> {
  const c = loadConfig().layout;
  return inPage<LayoutScan>(page, 'layout-scan', {
    gridSelectors: c.gridSelectors,
    itemSelectors: c.itemSelectors,
    dragHandleSelectors: c.dragHandleSelectors,
    resizeHandleSelectors: c.resizeHandleSelectors,
    placeholderSelectors: c.placeholderSelectors,
  });
}

function minPositive(xs: number[]): number | undefined {
  const p = xs.filter((x) => x > 0.5);
  return p.length ? Math.min(...p) : undefined;
}

/** Estimate columns, row height and margins from item geometry (react-grid-layout arithmetic). */
export function estimateGrid(containerWidth: number, items: Pick<Item, 'left' | 'top' | 'width' | 'height'>[]): GridEstimate {
  const cfg = loadConfig().layout;
  if (items.length < 1 || containerWidth <= 0) return {};
  const hGaps: number[] = [];
  const vGaps: number[] = [];
  for (const a of items) {
    for (const b of items) {
      if (a === b) continue;
      const vOverlap = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top) > 0;
      const hOverlap = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left) > 0;
      if (vOverlap && b.left >= a.left + a.width) hGaps.push(b.left - (a.left + a.width));
      if (hOverlap && b.top >= a.top + a.height) vGaps.push(b.top - (a.top + a.height));
    }
  }
  const mx = minPositive(hGaps) ?? Math.max(0, Math.min(...items.map((i) => i.left)));
  const my = minPositive(vGaps) ?? mx;
  const padX = Math.max(0, Math.min(...items.map((i) => i.left)));
  const padY = Math.max(0, Math.min(...items.map((i) => i.top)));
  const frac = (v: number) => Math.abs(v - Math.round(v));
  let best: GridEstimate = {};
  let bestErr = Infinity;
  const colErrs: { cols: number; e: number }[] = [];
  for (const cols of cfg.candidateColumns) {
    const colW = (containerWidth - 2 * padX - mx * (cols - 1)) / cols;
    if (colW <= 4) continue;
    let err = 0;
    for (const it of items) {
      err += frac((it.left - padX) / (colW + mx));
      err += frac((it.width + mx) / (colW + mx));
    }
    err /= items.length * 2;
    colErrs.push({ cols, e: err });
    if (err < bestErr - 0.01) {
      bestErr = err;
      best = { cols, colWidth: Math.round(colW * 100) / 100, marginX: mx, paddingX: padX };
    }
  }
  best.colsCandidates = colErrs.filter((x) => x.e <= bestErr + 0.01).map((x) => x.cols).sort((a, b) => a - b);
  let bestR: number | undefined;
  let bestRErr = Infinity;
  const [rMin, rMax] = cfg.rowHeightRange;
  const errs: { r: number; e: number }[] = [];
  for (let r = rMin; r <= rMax; r++) {
    let err = 0;
    for (const it of items) {
      err += frac((it.top - padY) / (r + my));
      err += frac((it.height + my) / (r + my));
    }
    err /= items.length * 2;
    errs.push({ r, e: err });
    if (err < bestRErr) bestRErr = err;
  }
  // Many row heights fit when all heights are multiples of one unit. Geometry alone cannot decide between them,
  // so the report lists all candidates. The guess is the smallest candidate at or above rowHeightGuessMin.
  const rowCandidates = errs.filter((x) => x.e <= bestRErr + 0.005).map((x) => x.r).sort((a, b) => a - b);
  bestR = rowCandidates.find((r) => r >= cfg.rowHeightGuessMin) ?? rowCandidates[0];
  return { ...best, rowHeight: bestR, rowHeightCandidates: rowCandidates.slice(0, 12), marginY: my, paddingY: padY, fitError: Math.round(bestErr * 1000) / 1000 };
}

function bundleHints(guard: NetworkGuard): { hints: Record<string, string[]>; media: Record<string, number> } {
  const hints: Record<string, string[]> = { rowHeight: [], cols: [], breakpoints: [], margin: [], containerPadding: [], compactType: [], draggableHandle: [] };
  const add = (k: string, v: string) => {
    const list = hints[k] as string[];
    if (!list.includes(v) && list.length < 10) list.push(v);
  };
  for (const body of guard.scriptBodies.values()) {
    if (!/react-grid-layout|react-grid-item|rowHeight|breakpoints/.test(body)) continue;
    for (const m of body.matchAll(/rowHeight\s*:\s*(\d+)/g)) add('rowHeight', m[1] as string);
    for (const m of body.matchAll(/\bcols\s*:\s*(\{[^{}]{1,200}\}|\d+)/g)) add('cols', m[1] as string);
    for (const m of body.matchAll(/breakpoints\s*:\s*(\{[^{}]{1,200}\})/g)) add('breakpoints', m[1] as string);
    for (const m of body.matchAll(/\bmargin\s*:\s*(\[\s*\d+\s*,\s*\d+\s*\])/g)) add('margin', m[1] as string);
    for (const m of body.matchAll(/containerPadding\s*:\s*(\[\s*\d+\s*,\s*\d+\s*\])/g)) add('containerPadding', m[1] as string);
    for (const m of body.matchAll(/compactType\s*:\s*("[a-z]+"|null)/g)) add('compactType', m[1] as string);
    for (const m of body.matchAll(/draggableHandle\s*:\s*("[^"]{1,60}")/g)) add('draggableHandle', m[1] as string);
  }
  const media: Record<string, number> = {};
  const bodies = [...guard.styleBodies.values(), ...guard.scriptBodies.values()];
  for (const body of bodies) {
    for (const m of body.matchAll(/@media[^{]{0,120}?\((min|max)-width:\s*(\d+(?:\.\d+)?)(px|em|rem)\)/g)) {
      const k = `${m[1]}-width: ${m[2]}${m[3]}`;
      media[k] = (media[k] ?? 0) + 1;
    }
  }
  return { hints, media };
}

async function storageSnapshot(page: Page): Promise<{ local: Record<string, string>; session: Record<string, string>; idb: string[] }> {
  return (await page.evaluate(`(async () => {
    const dump = (s) => { const o = {}; try { for (let i = 0; i < s.length; i++) { const k = s.key(i); o[k] = s.getItem(k); } } catch (e) {} return o; };
    let idb = [];
    try { idb = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name + '@' + d.version) : []; } catch (e) {}
    return { local: dump(localStorage), session: dump(sessionStorage), idb };
  })()`)) as { local: Record<string, string>; session: Record<string, string>; idb: string[] };
}

async function storageRestore(page: Page, snap: { local: Record<string, string>; session: Record<string, string> }): Promise<void> {
  await page.evaluate(`((snap) => {
    try { localStorage.clear(); for (const [k, v] of Object.entries(snap.local)) localStorage.setItem(k, v); } catch (e) {}
    try { sessionStorage.clear(); for (const [k, v] of Object.entries(snap.session)) sessionStorage.setItem(k, v); } catch (e) {}
  })(${JSON.stringify(snap)})`);
}

function diffKeys(a: Record<string, string>, b: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]);
}

/** A point inside the element that is not over a control, for drag starts. */
async function grabPoint(page: Page, selector: string): Promise<{ x: number; y: number } | null> {
  return (await page.evaluate(`((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85, 0.05]) {
      for (const fy of [0.5, 0.3, 0.7]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (!hit || !el.contains(hit)) continue;
        if (hit.closest('button, a, input, select, textarea, [role="button"], [role="tab"], [contenteditable="true"]')) continue;
        return { x, y };
      }
    }
    return null;
  })(${JSON.stringify(selector)})`)) as { x: number; y: number } | null;
}

export async function auditLayout(s: Session, out: Output, gaps: Gaps, views: View[]): Promise<LayoutReport> {
  const cfg = loadConfig();
  const { page, guard } = s;
  const report: LayoutReport = { perView: [], interactions: [], bundleHints: {}, mediaQueries: {} };
  let interactionView: View | undefined;
  for (const v of views) {
    try {
      guard.setActivity(`layout ${v.name}`);
      await gotoView(page, v.url);
      const scan = await scanLayout(page);
      const estimate = scan.container ? estimateGrid(scan.container.width, scan.items) : {};
      const perViewport: LayoutReport['perView'][number]['perViewport'] = [];
      if (scan.container) {
        for (const vp of cfg.viewports) {
          await page.setViewportSize(vp);
          await sleep(600);
          const sv = await scanLayout(page);
          if (sv.container) perViewport.push({ viewport: viewportName(vp), containerWidth: sv.container.width, estimate: estimateGrid(sv.container.width, sv.items) });
        }
        await page.setViewportSize(cfg.primaryViewport);
        if (!interactionView && scan.items.length) interactionView = v;
      }
      report.perView.push({ view: v.name, scan, estimate, perViewport });
    } catch (e) {
      gaps.add('layout-interaction', `layout scan (${v.name})`, errorText(e));
    }
  }
  const hints = bundleHints(guard);
  report.bundleHints = hints.hints;
  report.mediaQueries = hints.media;

  if (!interactionView) {
    for (const n of ['drag', 'resize', 'snap', 'collapse', 'maximise', 'close', 'add']) gaps.add('layout-interaction', n, 'no panel grid found in the audited views');
    return report;
  }
  const v = interactionView;
  const est = report.perView.find((p) => p.view === v.name)?.estimate ?? {};
  const stepX = Math.round((est.colWidth ?? 90) + (est.marginX ?? 10)) * 2;
  const stepY = Math.round((est.rowHeight ?? 40) + (est.marginY ?? 10)) * 2;

  const run = async (name: string, body: (shot: (label?: string) => Promise<void>) => Promise<string>) => {
    await gotoView(page, v.url);
    guard.setActivity(`layout ${name}`);
    const before = await storageSnapshot(page);
    const t0 = guard.now();
    const files: string[] = [];
    let n = 0;
    const shot = async () => {
      n += 1;
      const f = out.path(`layout/${name}/${String(n).padStart(2, '0')}.png`);
      await page.screenshot({ path: f, mask: screenshotMasks(page, s.creds.username) });
      files.push(out.rel(f));
    };
    let observation = '';
    let failed = false;
    try {
      observation = await body(shot);
    } catch (e) {
      failed = true;
      observation = `failed: ${errorText(e)}`;
    }
    await page.mouse.up().catch(() => undefined);
    await sleep(cfg.layout.interactionSettleMs);
    const after = await storageSnapshot(page).catch(() => ({ local: {}, session: {}, idb: [] }));
    const server = guard.entries.filter((e) => e.t >= t0 && !cfg.safety.allowedMethods.includes(e.method)).map((e) => `${e.method} ${e.endpoint} (${e.outcome})`);
    const wsBlocked = guard.websockets.reduce((k, w) => k + w.blockedSent.filter((b) => b.t >= t0).length, 0);
    if (wsBlocked) server.push(`${wsBlocked} WebSocket frame(s) blocked`);
    await storageRestore(page, before).catch(() => undefined);
    await gotoView(page, v.url);
    const result: InteractionResult = {
      name,
      view: v.name,
      recorded: !failed && server.length === 0 && files.length > 0,
      files,
      observation,
      localStorageKeysChanged: diffKeys(before.local, after.local),
      sessionStorageKeysChanged: diffKeys(before.session, after.session),
      indexedDbBefore: before.idb,
      indexedDbAfter: after.idb,
      serverRequests: server,
    };
    if (server.length) {
      out.remove(`layout/${name}`);
      result.files = [];
      gaps.add('layout-interaction', name, `the interaction sends ${server.join('; ')}. The guard blocked it. The interaction persists to the server, so it is not recorded`);
    } else if (failed || !files.length) {
      out.remove(`layout/${name}`);
      result.files = [];
      gaps.add('layout-interaction', name, observation || 'the control was not found');
    }
    report.interactions.push(result);
    return result;
  };

  const itemSel = (i: number) => `[data-sa-item="${i}"]`;
  const first = async () => {
    const scan = await scanLayout(page);
    const item = scan.items[0];
    if (!item) throw new Error('no panel item found');
    return { scan, item };
  };
  const geometry = async (i: number) => (await scanLayout(page)).items.find((x) => x.index === i);
  const onGrid = (left: number) => (est.colWidth ? Math.abs((left - (est.paddingX ?? 0)) / (est.colWidth + (est.marginX ?? 0)) - Math.round((left - (est.paddingX ?? 0)) / (est.colWidth + (est.marginX ?? 0)))) < 0.05 : false);

  const dragBy = async (from: { x: number; y: number }, dx: number, dy: number, shot: () => Promise<void>) => {
    await page.mouse.move(from.x, from.y);
    await shot();
    await page.mouse.down();
    const steps = cfg.layout.dragSteps;
    let placeholder = false;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
      await sleep(30);
      if (i === Math.floor(steps / 2)) {
        placeholder = (await scanLayout(page)).placeholder;
        await shot();
      }
    }
    await page.mouse.up();
    await shot();
    await sleep(cfg.layout.interactionSettleMs);
    await shot();
    return placeholder;
  };

  await run('drag', async (shot) => {
    const { item } = await first();
    const handleSel = item.dragHandle ? `${itemSel(item.index)} ${item.dragHandle}` : itemSel(item.index);
    const p = (await grabPoint(page, handleSel)) ?? (await grabPoint(page, itemSel(item.index)));
    if (!p) throw new Error('no drag point found in the panel header');
    const placeholder = await dragBy(p, stepX, stepY, shot);
    const g = await geometry(item.index);
    const moved = g && (g.left !== item.left || g.top !== item.top);
    return `Drag from the panel header by (${stepX}px, ${stepY}px). Panel "${item.title}" moved: ${moved ? 'yes' : 'no'} (from ${item.left},${item.top} to ${g?.left},${g?.top}). Placeholder during drag: ${placeholder ? 'yes' : 'no'}.`;
  });

  await run('snap', async (shot) => {
    const { item } = await first();
    const handleSel = item.dragHandle ? `${itemSel(item.index)} ${item.dragHandle}` : itemSel(item.index);
    const p = (await grabPoint(page, handleSel)) ?? (await grabPoint(page, itemSel(item.index)));
    if (!p) throw new Error('no drag point found in the panel header');
    // Move by a distance that is not a multiple of the column width, then check that the panel lands on the grid.
    const odd = Math.round(stepX * 0.37) + 7;
    await dragBy(p, odd, 0, shot);
    const g = await geometry(item.index);
    const snapped = g ? onGrid(g.left) && g.left !== item.left + odd : false;
    return `Drag by ${odd}px (not a column multiple). Final left ${g?.left}px. Snaps to the column grid: ${snapped ? 'yes' : 'no or unknown'}.`;
  });

  await run('resize', async (shot) => {
    const { scan } = await first();
    const item = scan.items.find((i) => i.resizeHandles.length) ?? scan.items[0];
    if (!item) throw new Error('no panel item found');
    const handle = page.locator(`${itemSel(item.index)} :is(${cfg.layout.resizeHandleSelectors.join(', ')})`).first();
    if (!(await handle.count())) throw new Error('no resize handle found');
    await handle.scrollIntoViewIfNeeded().catch(() => undefined);
    const box = await handle.boundingBox();
    if (!box) throw new Error('resize handle has no box');
    await dragBy({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, Math.round(stepX / 2), Math.round(stepY / 2), shot);
    const g = await geometry(item.index);
    return `Resize from the handle "${item.resizeHandles[0] ?? ''}" by (${Math.round(stepX / 2)}px, ${Math.round(stepY / 2)}px). Size from ${item.width}x${item.height} to ${g?.width}x${g?.height}.`;
  });

  for (const name of ['collapse', 'maximise', 'close', 'add'] as const) {
    await run(name, async (shot) => {
      const pattern = cfg.layout.interactions[name] as string;
      const within = name === 'add' ? undefined : '[data-sa-item]';
      await scanLayout(page);
      const controls = await inPage<(ControlDescriptor & { id: string })[]>(page, 'controls', { within, onlyVisible: true });
      const scoped = name === 'add' ? controls : controls.filter((c) => c.inPanelHeader);
      const ctl = scoped.find((c) => classifyControl(c, 'layout').allowed && new RegExp(pattern, 'i').test((c.ariaLabel || c.text || c.title || '').trim()));
      if (!ctl) throw new Error(`no ${name} control found`);
      const label = (ctl.ariaLabel || ctl.text || ctl.title || '').trim();
      const before = await scanLayout(page);
      await shot();
      await page.locator(`[data-sa-id="${ctl.id}"]`).click({ timeout: 3000 });
      await sleep(cfg.layout.interactionSettleMs);
      await shot();
      let extra = '';
      if (name === 'add') {
        // Pick the first option in the panel picker whose label passes the deny list.
        const opts = await inPage<(ControlDescriptor & { id: string })[]>(page, 'controls', {
          selector: '[role="menuitem"], [role="option"], [role="dialog"] button, [role="menu"] button, [class*="picker" i] button, [class*="menu" i] button',
          onlyVisible: true,
        });
        const opt = opts.find((o) => o.id !== ctl.id && !matchesAny(labelOf(o), cfg.safety.denyPatterns) && !matchesAny(labelOf(o), cfg.safety.logoutPatterns) && o.tag !== 'input');
        if (opt) {
          await page.locator(`[data-sa-id="${opt.id}"]`).click({ timeout: 3000 });
          await sleep(cfg.layout.interactionSettleMs);
          await shot();
          extra = ` Picked the option "${(opt.text || opt.ariaLabel || '').slice(0, 40)}".`;
        } else extra = ' No safe option found in the picker.';
      }
      const afterScan = await scanLayout(page);
      const firstBefore = before.items[0];
      const firstAfter = afterScan.items[0];
      return `Click "${label}".${extra} Panels before: ${before.items.length}, after: ${afterScan.items.length}. First panel size before ${firstBefore?.width}x${firstBefore?.height}, after ${firstAfter?.width}x${firstAfter?.height}.`;
    });
  }
  return report;
}

export function writeLayout(out: Output, r: LayoutReport): void {
  const lines = ['# Layout system', ''];
  const withGrid = r.perView.filter((p) => p.scan.container);
  lines.push('## Grid system', '');
  if (!withGrid.length) lines.push('No panel grid container was found (react-grid-layout classes or the configured grid selectors).', '');
  for (const p of withGrid) {
    const c = p.scan.container!;
    const e = p.estimate;
    lines.push(`### ${p.view}`, '');
    lines.push(`- Container: \`${c.selector}\` (class "${c.className}"), ${c.width}x${c.height}px, item selector \`${c.itemSelector}\``);
    lines.push(
      `- Estimate from geometry: ${e.cols ?? '?'} columns, column width ${e.colWidth ?? '?'}px, row height ${e.rowHeight ?? '?'}px, gutter ${e.marginX ?? '?'}px x ${e.marginY ?? '?'}px, container padding ${e.paddingX ?? '?'}px x ${e.paddingY ?? '?'}px (fit error ${e.fitError ?? '?'}). This is an estimate.`,
    );
    lines.push(`- Column counts that fit the geometry: ${e.colsCandidates?.join(', ') || '?'}. Row heights that fit: ${e.rowHeightCandidates?.join(', ') || '?'} px. Confirm with the values in the bundles below or the Infora source.`);
    lines.push('', 'Default layout of the view:', '');
    lines.push(
      mdTable(
        ['Panel', 'Left', 'Top', 'Width', 'Height', 'Grid x', 'Grid w', 'Resize handles', 'Drag handle'],
        p.scan.items.map((it) => {
          const unit = e.colWidth !== undefined ? e.colWidth + (e.marginX ?? 0) : undefined;
          const gx = unit ? Math.round((it.left - (e.paddingX ?? 0)) / unit) : '';
          const gw = unit ? Math.round((it.width + (e.marginX ?? 0)) / unit) : '';
          return [it.title || `#${it.index}`, it.left, it.top, it.width, it.height, gx, gw, it.resizeHandles.join(' ') || 'none', it.dragHandle ?? 'none'];
        }),
      ),
    );
    if (p.perViewport.length) {
      lines.push('Breakpoint behaviour by viewport:', '');
      lines.push(mdTable(['Viewport', 'Container width', 'Columns (estimate)', 'Column width'], p.perViewport.map((x) => [x.viewport, x.containerWidth, x.estimate.cols ?? '?', x.estimate.colWidth ?? '?'])));
    }
  }
  const css = r.perView.flatMap((p) => p.scan.cssGrids.map((g) => ({ view: p.view, ...g })));
  if (css.length) {
    lines.push('## CSS grid containers', '');
    lines.push(mdTable(['View', 'Element', 'Columns', 'Template columns', 'Row gap', 'Column gap', 'Auto rows'], css.slice(0, 30).map((g) => [g.view, g.element, g.columns, g.templateColumns, g.rowGap, g.columnGap, g.autoRows])));
  }
  lines.push('## Values in the bundles', '');
  const hintRows = Object.entries(r.bundleHints).filter(([, v]) => v.length);
  lines.push(hintRows.length ? mdTable(['Setting', 'Values found'], hintRows.map(([k, v]) => [k, v.join('; ')])) : 'No grid settings found in the script bundles.\n');
  lines.push('## Breakpoints from media queries', '');
  const mq = Object.entries(r.mediaQueries).sort((a, b) => b[1] - a[1]);
  lines.push(mq.length ? mdTable(['Media query', 'Count'], mq.slice(0, 30)) : 'No width media query found.\n');

  lines.push('## Panel interactions', '');
  lines.push('Each interaction has a sequence of screenshots. The audit restores localStorage and sessionStorage and reloads the view after each one.', '');
  for (const i of r.interactions) {
    lines.push(`### ${i.name}`, '');
    lines.push(`- View: ${i.view}`);
    lines.push(`- Recorded: ${i.recorded ? 'yes' : 'no (see gaps.md)'}`);
    lines.push(`- Observation: ${i.observation}`);
    lines.push(`- localStorage keys changed: ${i.localStorageKeysChanged.join(', ') || 'none'}`);
    lines.push(`- sessionStorage keys changed: ${i.sessionStorageKeysChanged.join(', ') || 'none'}`);
    lines.push(`- Requests that change data: ${i.serverRequests.join('; ') || 'none'}`);
    if (i.files.length) {
      lines.push('- Screenshots:');
      for (const f of i.files) lines.push(`  - [${f}](${f})`);
    }
    lines.push('');
  }
  lines.push('## Layout persistence', '');
  const lsKeys = [...new Set(r.interactions.flatMap((i) => i.localStorageKeysChanged))];
  const ssKeys = [...new Set(r.interactions.flatMap((i) => i.sessionStorageKeysChanged))];
  const idb = [...new Set(r.interactions.flatMap((i) => [...i.indexedDbBefore, ...i.indexedDbAfter]))];
  const server = [...new Set(r.interactions.flatMap((i) => i.serverRequests))];
  lines.push(`- localStorage: ${lsKeys.length ? `keys ${lsKeys.map((k) => `\`${k}\``).join(', ')} change when the layout changes` : 'no key changed'}`);
  lines.push(`- sessionStorage: ${ssKeys.length ? ssKeys.map((k) => `\`${k}\``).join(', ') : 'no key changed'}`);
  lines.push(`- IndexedDB databases: ${idb.length ? idb.join(', ') : 'none'}`);
  lines.push(`- Server: ${server.length ? `the page tried ${server.join('; ')}` : 'no request that changes data was sent during the interactions'}`);
  lines.push('');
  out.writeText('layout-system.md', lines.join('\n'));
  out.writeJson('layout-system.json', r);
}
