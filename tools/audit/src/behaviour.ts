// Keyboard, command input, focus order, search, live updates, value-change effects, formats and ticker
// (docs/01-audit.md, "Keyboard and command behaviour" and "Live behaviour", criterion 7).
// The audit presses only the safe keys from the configuration. It never presses Enter in an input.

import type { Page } from '@playwright/test';
import { normalizeColor } from './color.js';
import { loadConfig } from './config.js';
import { gotoView, routeKey, type View } from './crawl.js';
import type { Gaps } from './gaps.js';
import type { NetworkGuard } from './guard.js';
import type { Session } from './login.js';
import { redactUrl } from './redact.js';
import { errorText, inPage, mdTable, median, sleep, type Output } from './util.js';

interface UiState {
  url: string;
  title: string;
  active: { tag: string; role: string; name: string; editable: boolean } | null;
  overlays: { role: string; name: string }[];
  scrollY: number;
  selected: string;
  marker: boolean;
}

interface FocusStop {
  key: string;
  tag: string;
  role: string;
  name: string;
  focusVisible: boolean;
  indicator: string;
  outlineColor: string | null;
  boxShadow: string | null;
}

export interface KeyResult {
  key: string;
  effect: string;
  changed: boolean;
}

export interface CommandResult {
  trigger: string;
  input: string;
  queries: { query: string; suggestions: string[]; requests: string[]; firstRequestMs: number | null }[];
}

export interface ViewBehaviour {
  view: string;
  keys: KeyResult[];
  helpText: string[];
  command: CommandResult[];
  focusOrder: { name: string; role: string; indicator: string; focusVisible: boolean }[];
  formats: Record<string, unknown>;
}

export interface BehaviourReport {
  bundleShortcuts: { pattern: string; count: number }[];
  views: ViewBehaviour[];
  live: Record<string, unknown>;
  mutations: Record<string, unknown> | null;
  mutationView: string;
  ticker: Record<string, unknown> | null;
  focusRingColors: Record<string, number>;
  flashColors: Record<string, number>;
}

async function ui(page: Page): Promise<UiState> {
  // A key can start a navigation. Then the first read fails, so wait for the new page and read again.
  for (let i = 0; i < 3; i++) {
    try {
      return await inPage<UiState>(page, 'ui-state', {});
    } catch {
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      await sleep(400);
    }
  }
  return inPage<UiState>(page, 'ui-state', {});
}

async function blur(page: Page): Promise<void> {
  await page.evaluate('document.activeElement && document.activeElement.blur && document.activeElement.blur()').catch(() => undefined);
}

function describeEffect(before: UiState, after: UiState, viewUrl: string): { effect: string; changed: boolean } {
  const parts: string[] = [];
  if (routeKey(after.url) !== routeKey(before.url)) parts.push(`navigates to ${redactUrl(after.url)}`);
  else if (before.marker && !after.marker) parts.push('reloads the page');
  const newOverlays = after.overlays.filter((o) => !before.overlays.some((b) => b.role === o.role && b.name === o.name));
  if (newOverlays.length) parts.push(`opens ${newOverlays.map((o) => `${o.role}${o.name ? ` "${o.name}"` : ''}`).join(', ')}`);
  const closed = before.overlays.filter((o) => !after.overlays.some((b) => b.role === o.role && b.name === o.name));
  if (closed.length) parts.push(`closes ${closed.map((o) => o.role).join(', ')}`);
  const bA = before.active ? `${before.active.role || before.active.tag} "${before.active.name}"` : 'body';
  const aA = after.active ? `${after.active.role || after.active.tag} "${after.active.name}"` : 'body';
  if (aA !== bA) parts.push(`moves focus to ${aA}`);
  if (after.scrollY !== before.scrollY) parts.push(`scrolls by ${after.scrollY - before.scrollY}px`);
  if (after.selected !== before.selected) parts.push('changes the selected or active item');
  if (after.title !== before.title && !parts.length) parts.push(`changes the title to "${after.title}"`);
  void viewUrl;
  return { effect: parts.join('; ') || 'no visible effect', changed: parts.length > 0 };
}

function scanBundles(guard: NetworkGuard): { pattern: string; count: number }[] {
  const counts = new Map<string, number>();
  const add = (s: string) => counts.set(s, (counts.get(s) ?? 0) + 1);
  for (const body of guard.scriptBodies.values()) {
    if (!/keydown|keyup|keypress|hotkey|shortcut/i.test(body)) continue;
    for (const m of body.matchAll(/\.(?:key|code)\s*={2,3}\s*["']([^"'\\]{1,20})["']/g)) add(`key === "${m[1]}"`);
    for (const m of body.matchAll(/["']([^"'\\]{1,20})["']\s*={2,3}\s*\w+\.(?:key|code)\b/g)) add(`key === "${m[1]}"`);
    for (const m of body.matchAll(/["']((?:mod|ctrl|control|cmd|command|meta|shift|alt|option)\s*\+\s*(?:[a-z0-9/?.,\[\]\\`=-]|enter|escape|esc|space|tab|up|down|left|right|arrow\w+)(?:\s*\+\s*\w+)?)["']/gi)) add(`combo "${m[1]}"`);
    for (const m of body.matchAll(/(?:useHotkeys|hotkeys|Mousetrap\.bind|bindKey|registerShortcut|addShortcut|useKeyboardShortcut|tinykeys)\(\s*["']([^"'\\]{1,40})["']/g)) add(`binding "${m[1]}"`);
    for (const m of body.matchAll(/["']((?:g|G)\s+[a-z])["']/g)) add(`sequence "${m[1]}"`);
  }
  return [...counts.entries()].map(([pattern, count]) => ({ pattern, count })).sort((a, b) => b.count - a.count).slice(0, 60);
}

async function tryKeys(s: Session, view: View, out: ViewBehaviour, gaps: Gaps): Promise<void> {
  const cfg = loadConfig().behaviour;
  const { page } = s;
  const keys: string[][] = cfg.safeKeys.map((k) => [k]);
  for (const letter of cfg.gChordLetters) keys.push(['g', letter]);
  for (const combo of keys) {
    const label = combo.join(' then ');
    try {
      await blur(page);
      await page.evaluate('window.__saKeyMarker = true').catch(() => undefined);
      const before = await ui(page);
      for (const k of combo) {
        await page.keyboard.press(k);
        if (combo.length > 1) await sleep(60);
      }
      await sleep(cfg.keySettleMs);
      const after = await ui(page);
      const { effect, changed } = describeEffect(before, after, view.url);
      out.keys.push({ key: label, effect, changed });
      if (after.overlays.some((o) => o.role === 'dialog' || o.role === 'alertdialog')) {
        const help = await page
          .evaluate(
            `Array.from(document.querySelectorAll('[role="dialog"] kbd, dialog[open] kbd, [aria-modal="true"] kbd')).slice(0, 80).map((k) => { const row = k.closest('li, tr, div'); return (row ? row.innerText : k.innerText).replace(/\\s+/g, ' ').trim().slice(0, 100); })`,
          )
          .catch(() => [] as string[]);
        for (const h of help as string[]) if (!out.helpText.includes(h)) out.helpText.push(h);
      }
      if (changed) {
        await page.keyboard.press('Escape');
        await sleep(150);
        await blur(page);
        const now = await ui(page);
        if (routeKey(now.url) !== routeKey(view.url) || now.overlays.length > before.overlays.length) await gotoView(page, view.url);
      }
    } catch (e) {
      gaps.add('behaviour', `key ${label} (${view.name})`, errorText(e));
      await gotoView(page, view.url).catch(() => undefined);
    }
  }
}

async function commandInput(s: Session, view: View, out: ViewBehaviour, gaps: Gaps): Promise<void> {
  const cfg = loadConfig().behaviour;
  const { page, guard } = s;
  const triggers: { name: string; run: () => Promise<void> }[] = [
    { name: 'Control+k', run: () => page.keyboard.press('Control+k') },
    { name: 'Meta+k', run: () => page.keyboard.press('Meta+k') },
    { name: '/', run: () => page.keyboard.press('/') },
    {
      name: 'focus on the search or command field',
      run: async () => {
        const loc = page
          .locator(
            'input[type="search"], [role="combobox"], [role="searchbox"], input[placeholder*="search" i], input[placeholder*="command" i], input[placeholder*="type" i], input[placeholder*="go to" i], input[placeholder*="function" i], input[placeholder*="ticker" i]',
          )
          .filter({ visible: true })
          .first();
        if (await loc.count()) await loc.focus();
      },
    },
  ];
  const seenInputs = new Set<string>();
  for (const t of triggers) {
    try {
      await gotoView(page, view.url);
      await blur(page);
      await t.run();
      await sleep(cfg.keySettleMs);
      const st = await ui(page);
      if (!st.active?.editable) continue;
      const inputName = `${st.active.role || st.active.tag} "${st.active.name}"`;
      if (seenInputs.has(inputName)) {
        out.command.push({ trigger: t.name, input: `${inputName} (same input as above)`, queries: [] });
        continue;
      }
      seenInputs.add(inputName);
      const res: CommandResult = { trigger: t.name, input: inputName, queries: [] };
      for (const q of cfg.commandQueries) {
        const again = await ui(page);
        if (!again.active?.editable) break;
        const t0 = guard.now();
        await page.keyboard.type(q, { delay: 50 });
        const typedAt = guard.now();
        await sleep(1000);
        const suggestions = (await page
          .evaluate(
            `Array.from(document.querySelectorAll('[role="option"], [role="listbox"] li, [cmdk-item], [role="menuitem"], [class*="suggest" i] li, [class*="result" i] li, [class*="autocomplete" i] li')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; }).slice(0, 12).map((e) => (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80))`,
          )
          .catch(() => [])) as string[];
        // Requests that also ran just before the typing (for example polling) are not search requests.
        const isXhr = (e: { resourceType: string }) => e.resourceType === 'fetch' || e.resourceType === 'xhr';
        const baseline = new Set(guard.entries.filter((e) => e.t >= t0 - 3000 && e.t < t0 && isXhr(e)).map((e) => e.endpoint));
        const reqs = guard.entries.filter((e) => e.t >= t0 && isXhr(e) && !baseline.has(e.endpoint));
        const first = reqs.find((e) => e.t >= typedAt) ?? reqs[0];
        res.queries.push({
          query: q,
          suggestions: suggestions.filter(Boolean),
          requests: [...new Set(reqs.map((e) => `${e.method} ${e.endpoint}`))].slice(0, 5),
          firstRequestMs: first ? Math.round(first.t - typedAt) : null,
        });
        // Clear the field. Never press Enter.
        await page.keyboard.press('Control+a').catch(() => undefined);
        await page.keyboard.press('Backspace').catch(() => undefined);
        await sleep(200);
      }
      out.command.push(res);
      await page.keyboard.press('Escape');
      await blur(page);
    } catch (e) {
      gaps.add('behaviour', `command input via ${t.name} (${view.name})`, errorText(e));
    }
  }
  await gotoView(page, view.url).catch(() => undefined);
}

async function focusOrder(s: Session, view: View, out: ViewBehaviour, rings: Record<string, number>): Promise<void> {
  const cfg = loadConfig().behaviour;
  const { page } = s;
  await gotoView(page, view.url);
  await blur(page);
  const seen = new Set<string>();
  for (let i = 0; i < cfg.maxTabStops; i++) {
    await page.keyboard.press('Tab');
    await sleep(40);
    const f = await inPage<FocusStop | null>(page, 'focus-describe', {});
    if (!f) {
      if (i > 0) break;
      continue;
    }
    if (seen.has(f.key)) break;
    seen.add(f.key);
    out.focusOrder.push({ name: f.name, role: f.role, indicator: f.indicator, focusVisible: f.focusVisible });
    const colours: string[] = [];
    if (f.outlineColor) colours.push(f.outlineColor);
    if (f.boxShadow) colours.push(...(f.boxShadow.match(/rgba?\([^()]*\)/g) ?? []));
    for (const c of colours) {
      const n = normalizeColor(c);
      if (n && n !== 'transparent') rings[n] = (rings[n] ?? 0) + 1;
    }
    if (routeKey(page.url()) !== routeKey(view.url)) break;
  }
  await blur(page);
}

function liveSummary(guard: NetworkGuard, window: [number, number]): Record<string, unknown> {
  const cfg = loadConfig().behaviour;
  const ws = guard.websockets.map((w) => {
    const times = w.receivedTimes.filter((t) => t >= window[0] && t <= window[1]);
    const gaps = times.slice(1).map((t, i) => t - (times[i] as number));
    return {
      url: w.url,
      sent: w.sent,
      received: w.received,
      receivedInWindow: times.length,
      medianGapMs: gaps.length ? Math.round(median(gaps)) : null,
      sentShapes: w.sentActions,
      receivedShapes: Object.entries(w.receivedShapes).sort((a, b) => b[1] - a[1]).slice(0, 10),
      blockedSent: w.blockedSent.length,
    };
  });
  const sse = [...new Set(guard.entries.filter((e) => e.resourceType === 'eventsource').map((e) => e.endpoint))];
  const inWindow = guard.entries.filter((e) => e.t >= window[0] && e.t <= window[1] && (e.resourceType === 'fetch' || e.resourceType === 'xhr') && e.method === 'GET');
  const groups = new Map<string, number[]>();
  for (const e of inWindow) groups.set(e.endpoint, [...(groups.get(e.endpoint) ?? []), e.t]);
  const polling = [...groups.entries()]
    .filter(([, ts]) => ts.length >= cfg.pollingMinRepeats)
    .map(([endpoint, ts]) => {
      const gaps = ts.slice(1).map((t, i) => t - (ts[i] as number));
      return { endpoint, requests: ts.length, medianIntervalMs: Math.round(median(gaps)), minMs: Math.round(Math.min(...gaps)), maxMs: Math.round(Math.max(...gaps)) };
    })
    .sort((a, b) => b.requests - a.requests);
  const protocols: string[] = [];
  if (ws.length) protocols.push('WebSocket');
  if (sse.length) protocols.push('Server-Sent Events (EventSource)');
  if (polling.length) protocols.push('HTTP polling');
  return { protocols, websockets: ws, eventSource: sse, polling, windowMs: Math.round(window[1] - window[0]) };
}

export async function auditBehaviour(s: Session, out: Output, gaps: Gaps, views: View[]): Promise<BehaviourReport> {
  const cfg = loadConfig();
  const { page, guard } = s;
  const report: BehaviourReport = {
    bundleShortcuts: scanBundles(guard),
    views: [],
    live: {},
    mutations: null,
    mutationView: '',
    ticker: null,
    focusRingColors: {},
    flashColors: {},
  };
  for (const v of views) {
    const vb: ViewBehaviour = { view: v.name, keys: [], helpText: [], command: [], focusOrder: [], formats: {} };
    guard.setActivity(`behaviour ${v.name}`);
    try {
      await gotoView(page, v.url);
      vb.formats = await inPage(page, 'formats', {});
      await tryKeys(s, v, vb, gaps);
      await commandInput(s, v, vb, gaps);
      await focusOrder(s, v, vb, report.focusRingColors);
    } catch (e) {
      gaps.add('behaviour', v.name, `behaviour capture failed: ${errorText(e)}`);
    }
    report.views.push(vb);
  }
  const first = views[0];
  if (first) {
    guard.setActivity(`live ${first.name}`);
    try {
      await gotoView(page, first.url);
      // Keep the pointer away from the ticker, so that a hover pause does not stop it.
      const vp = page.viewportSize() ?? cfg.primaryViewport;
      await page.mouse.move(vp.width - 2, vp.height - 2);
      await sleep(300);
      await inPage(page, 'mutation-start', {});
      const w0 = guard.now();
      // Ticker first (it is part of the observation window), then wait for the rest of the window.
      const t = await inPage<Record<string, unknown>>(page, 'ticker-sample', { selectors: cfg.components.definitions.ticker, ms: cfg.behaviour.tickerSampleMs });
      if (t && t.found) {
        const rect = t.rect as { x: number; y: number; width: number; height: number };
        await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
        await sleep(200);
        const h = await inPage<Record<string, unknown>>(page, 'ticker-sample', { selectors: cfg.components.definitions.ticker, ms: cfg.behaviour.tickerHoverSampleMs });
        await page.mouse.move(vp.width - 2, vp.height - 2);
        const hoverSpeed = Number(h.pxPerSecond ?? 0);
        report.ticker = { ...t, hoverPxPerSecond: hoverSpeed, pausesOnHover: Math.abs(hoverSpeed) < Math.max(1, Math.abs(Number(t.pxPerSecond)) * 0.1) };
      } else {
        gaps.add('behaviour', 'ticker', 'no ticker strip found on the first view');
      }
      const remaining = cfg.behaviour.observeMs - (guard.now() - w0);
      if (remaining > 0) await sleep(remaining);
      report.mutations = await inPage<Record<string, unknown>>(page, 'mutation-read', {});
      report.mutationView = first.name;
      report.live = liveSummary(guard, [w0, guard.now()]);
      for (const f of (report.mutations?.flashes as { afterText: number; bg: [string, number][]; color: [string, number][] }[]) ?? []) {
        if (!f.afterText) continue;
        for (const [c, n] of [...f.bg, ...f.color]) {
          const norm = normalizeColor(c);
          if (norm && norm !== 'transparent') report.flashColors[norm] = (report.flashColors[norm] ?? 0) + n;
        }
      }
    } catch (e) {
      gaps.add('behaviour', 'live updates', `observation failed: ${errorText(e)}`);
    }
  }
  return report;
}

export function writeBehaviour(out: Output, r: BehaviourReport): void {
  const lines = ['# Behaviour', ''];
  lines.push('## Keyboard handlers found in the script bundles', '');
  lines.push(r.bundleShortcuts.length ? mdTable(['Pattern', 'Count'], r.bundleShortcuts.map((b) => [b.pattern, b.count])) : 'No key handler pattern found in the bundles.\n');

  lines.push('## Live update protocol', '');
  const live = r.live as { protocols?: string[]; websockets?: unknown[]; eventSource?: string[]; polling?: { endpoint: string; requests: number; medianIntervalMs: number; minMs: number; maxMs: number }[]; windowMs?: number };
  lines.push(`- Observation window: ${live.windowMs ?? 0} ms on the view "${r.mutationView}"`);
  lines.push(`- Protocols seen: ${live.protocols?.length ? live.protocols.join(', ') : 'none in the window'}`);
  if (live.eventSource?.length) lines.push(`- EventSource endpoints: ${live.eventSource.join(', ')}`);
  for (const w of (live.websockets ?? []) as { url: string; sent: number; received: number; receivedInWindow: number; medianGapMs: number | null; receivedShapes: [string, number][]; blockedSent: number }[]) {
    lines.push(`- WebSocket ${w.url}: ${w.received} frames received (${w.receivedInWindow} in the window, median gap ${w.medianGapMs ?? '?'} ms), ${w.sent} sent, ${w.blockedSent} blocked. Frame shapes: ${w.receivedShapes.map(([k, n]) => `${k} x${n}`).join('; ')}`);
  }
  if (live.polling?.length) {
    lines.push('', mdTable(['Polled endpoint', 'Requests', 'Median interval (ms)', 'Min', 'Max'], live.polling.map((p) => [p.endpoint, p.requests, p.medianIntervalMs, p.minMs, p.maxMs])));
  }
  lines.push('');

  lines.push('## Visual effect when a value changes', '');
  const m = r.mutations as { durationMs: number; textChanges: number; flashes: { token: string; count: number; afterText: number; medianDurationMs: number | null; bg: [string, number][]; color: [string, number][]; targets: [string, number][]; transition: [string, number][] }[]; styleProps: [string, number][]; animations: [string, number][]; transitions: [string, number][] } | null;
  if (!m) lines.push('Not observed.', '');
  else {
    lines.push(`- MutationObserver ran for ${m.durationMs} ms. Text changes: ${m.textChanges}.`);
    const flashAfterText = m.flashes.filter((f) => f.afterText > 0);
    if (flashAfterText.length) {
      lines.push('- Classes added right after a text change (the value-change effect):', '');
      lines.push(
        mdTable(
          ['Class', 'Times added', 'After a text change', 'Median time until removed (ms)', 'Background at the change', 'Text colour at the change', 'Transition', 'Elements'],
          flashAfterText.map((f) => [f.token, f.count, f.afterText, f.medianDurationMs ?? 'not removed', f.bg.map((x) => x[0]).join(', '), f.color.map((x) => x[0]).join(', '), f.transition.map((x) => x[0]).join(', '), f.targets.map((x) => x[0]).join(', ')]),
        ),
      );
    } else lines.push('- No class change followed a text change in the window.');
    if (m.styleProps.length) lines.push(`- Inline style properties that changed: ${m.styleProps.map(([k, n]) => `${k} (${n})`).join(', ')}`);
    if (m.animations.length) lines.push(`- CSS animations started: ${m.animations.map(([k, n]) => `${k} (${n})`).join(', ')}`);
    if (m.transitions.length) lines.push(`- CSS transitions started: ${m.transitions.map(([k, n]) => `${k} (${n})`).join(', ')}`);
    lines.push('');
  }

  lines.push('## Ticker strip', '');
  if (!r.ticker) lines.push('No ticker strip measured.', '');
  else {
    const t = r.ticker as Record<string, unknown>;
    lines.push(`- Element that moves: ${String(t.mover)}; method: ${String(t.method)}`);
    lines.push(`- Speed: ${String(t.pxPerSecond)} px/s, direction ${String(t.direction)}`);
    if (t.animation) lines.push(`- CSS animation: ${JSON.stringify(t.animation)}`);
    lines.push(`- Speed with the pointer over the ticker: ${String(t.hoverPxPerSecond)} px/s. Pauses on hover: ${t.pausesOnHover ? 'yes' : 'no'}`);
    lines.push('');
  }

  for (const v of r.views) {
    lines.push(`## View: ${v.view}`, '');
    lines.push('### Keyboard shortcuts', '');
    const shown = v.keys.filter((k) => k.changed || !/^g then /.test(k.key));
    const silentChords = v.keys.filter((k) => !k.changed && /^g then /.test(k.key)).map((k) => k.key.slice(-1));
    lines.push(mdTable(['Key', 'Effect'], shown.map((k) => [k.key, k.effect])));
    if (silentChords.length) lines.push(`g-prefixed chords with no visible effect: g then ${silentChords.join(', ')}.`, '');
    if (v.helpText.length) lines.push('Shortcut help shown in a dialog:', '', ...v.helpText.map((h) => `- ${h}`), '');
    lines.push('### Command input and search', '');
    if (!v.command.length) lines.push('No command or search input received focus from Ctrl+K, Cmd+K, "/" or a focus on a search field.', '');
    for (const c of v.command) {
      lines.push(`- Trigger ${c.trigger}: focus on ${c.input}`);
      for (const q of c.queries) {
        lines.push(`  - Typed "${q.query}" (no Enter). Suggestions: ${q.suggestions.length ? q.suggestions.join(' | ') : 'none'}. Requests: ${q.requests.join(', ') || 'none'}${q.firstRequestMs !== null ? ` (first ${q.firstRequestMs} ms after the last key)` : ''}.`);
      }
    }
    lines.push('', '### Focus order (Tab)', '');
    if (!v.focusOrder.length) lines.push('No element received focus from the Tab key.', '');
    else v.focusOrder.forEach((f, i) => lines.push(`${i + 1}. ${f.role || 'element'} "${f.name}" (indicator: ${f.indicator}${f.focusVisible ? ', :focus-visible' : ''})`));
    lines.push('', '### Formats', '');
    const pf = (v.formats as { patterns?: Record<string, { count: number; samples: string[] }>; decimals?: Record<string, number>; minus?: Record<string, number>; locale?: string; timeZone?: string }) ?? {};
    const rows = Object.entries(pf.patterns ?? {}).filter(([, x]) => x.count > 0);
    lines.push(rows.length ? mdTable(['Format', 'Count', 'Samples'], rows.map(([k, x]) => [k, x.count, x.samples.join(' ; ')])) : 'No timestamp, number or currency pattern found.\n');
    if (pf.decimals && Object.keys(pf.decimals).length) lines.push(`Decimal places: ${Object.entries(pf.decimals).map(([d, n]) => `${d} (${n})`).join(', ')}. Minus: hyphen ${pf.minus?.hyphen ?? 0}, U+2212 ${pf.minus?.unicodeMinus ?? 0}. Browser locale ${pf.locale}, time zone ${pf.timeZone}.`, '');
  }
  out.writeText('behaviour.md', lines.join('\n'));
  out.writeJson('behaviour.json', r);
}
