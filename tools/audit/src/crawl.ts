// Route discovery and view capture (docs/01-audit.md, "Views", criterion 1).

import type { Page } from '@playwright/test';
import { loadConfig, viewportName } from './config.js';
import type { Gaps } from './gaps.js';
import type { Session } from './login.js';
import { screenshotMasks } from './mask.js';
import { redactUrl } from './redact.js';
import { classifyControl, isSensitivePage, type ControlDescriptor } from './safety.js';
import { errorText, inPage, log, mdTable, sleep, slugify, type Output } from './util.js';

type Control = ControlDescriptor & { id: string; rect?: { x: number; y: number; width: number; height: number } };

export interface PanelInfo {
  title: string;
  kind: string;
  className: string;
  rect: { x: number; y: number; width: number; height: number };
}

export interface View {
  name: string;
  slug: string;
  url: string;
  displayUrl: string;
  title: string;
  discoveredFrom: string;
  via: string;
  headings: string[];
  panels: PanelInfo[];
  purposeGuess: string;
  screenshots: Record<string, string>;
  inViewTabs: string[];
  skippedControls: { label: string; reason: string }[];
}

interface QueueItem {
  url: string;
  name: string;
  /** Label priority: 2 for a link in the navigation, 1 in a menu, 0 elsewhere (for example the logo). */
  labelPriority?: number;
  depth: number;
  from: string;
  via: string;
}

/** A key that identifies a route: origin, path, hash route and sorted query. */
export function routeKey(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+$/, '') || '/';
    const hash = u.hash.startsWith('#/') ? u.hash.replace(/\/+$/, '') : '';
    const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    const q = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
    return `${u.origin}${path}${q}${hash}`;
  } catch {
    return raw;
  }
}

export async function settle(page: Page, ms?: number): Promise<void> {
  const cfg = loadConfig();
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForLoadState('load', { timeout: 5000 }).catch(() => undefined);
  await page.evaluate('document.fonts ? document.fonts.ready.then(() => true) : true').catch(() => undefined);
  await sleep(ms ?? cfg.crawl.settleMs);
}

export async function gotoView(page: Page, url: string): Promise<void> {
  const cfg = loadConfig();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: cfg.crawl.navTimeoutMs });
  await settle(page);
}

function labelFor(c: Control): string {
  return (c.text || c.ariaLabel || c.title || c.name || c.href || c.tag).replace(/\s+/g, ' ').trim().slice(0, 80);
}

export async function crawl(s: Session, out: Output, gaps: Gaps): Promise<View[]> {
  const cfg = loadConfig();
  const { page, guard } = s;
  guard.setActivity('crawl');
  const origin = new URL(s.creds.url).origin;
  const landing = page.url();
  const queue: QueueItem[] = [];
  const queued = new Set<string>();
  const views: View[] = [];
  const slugs = new Set<string>();
  const labels = new Map<string, { name: string; prio: number }>();
  const enqueue = (item: QueueItem) => {
    const key = routeKey(item.url);
    const prio = item.labelPriority ?? 0;
    if (item.name && (!labels.has(key) || (labels.get(key) as { prio: number }).prio < prio)) labels.set(key, { name: item.name, prio });
    if (queued.has(key)) return;
    try {
      if (new URL(item.url).origin !== origin) return;
    } catch {
      return;
    }
    queued.add(key);
    queue.push(item);
  };
  enqueue({ url: landing, name: '', depth: 0, from: 'login', via: 'landing page after login' });
  enqueue({ url: s.creds.url, name: '', depth: 0, from: 'INFORA_URL', via: 'start URL' });

  const visitedFinal = new Set<string>();
  while (queue.length && views.length + visitedFinal.size < cfg.crawl.maxRoutes * 2 && views.length < cfg.crawl.maxRoutes) {
    const item = queue.shift() as QueueItem;
    const name0 = item.name || new URL(item.url).pathname;
    try {
      guard.setActivity(`crawl ${name0}`);
      await gotoView(page, item.url);
      const finalKey = routeKey(page.url());
      if (visitedFinal.has(finalKey)) continue;
      visitedFinal.add(finalKey);
      queued.add(finalKey);
      const info = await inPage<{ title: string; h1: string; headings: string[]; text: string; hasPassword: boolean; emailCount: number }>(
        page,
        'page-info',
        {},
      );
      let name = item.name || labels.get(finalKey)?.name || info.h1 || info.title || new URL(page.url()).pathname;
      if (info.hasPassword && /login|sign/i.test(page.url())) {
        gaps.add('view-error', name, 'the route sent the browser back to the login page');
        continue;
      }
      const sens = isSensitivePage({ url: page.url(), text: info.text, hasPasswordInput: info.hasPassword, emailCount: info.emailCount });
      if (sens.sensitive) {
        gaps.add('view-sensitive', name, `not captured: may show ${sens.category} (${sens.reason})`);
        log(`Skip sensitive page: ${name}`);
        continue;
      }
      const skipped: { label: string; reason: string }[] = [];
      const inViewTabs: string[] = [];
      if (item.depth < cfg.crawl.maxDepth) {
        await discover(page, item, enqueue, skipped, inViewTabs, gaps);
        // Discovery can change the view. Load it again before the capture.
        await gotoView(page, item.url);
        // A navigation link found later can name the landing page better than the document title.
        if (!item.name && labels.has(finalKey)) name = labels.get(finalKey)?.name as string;
      }
      const view = await captureView(s, out, item, name, info, slugs);
      view.skippedControls = skipped;
      view.inViewTabs = inViewTabs;
      views.push(view);
      log(`View captured: ${view.name} (${view.displayUrl})`);
    } catch (e) {
      gaps.add('view-error', name0, `could not open or capture: ${errorText(e)}`);
    }
  }
  if (queue.length) {
    for (const q of queue) gaps.add('view-error', q.name || redactUrl(q.url), `not audited: route limit of ${cfg.crawl.maxRoutes} reached`);
  }
  writeViews(out, views);
  return views;
}

async function discover(
  page: Page,
  item: QueueItem,
  enqueue: (i: QueueItem) => void,
  skipped: { label: string; reason: string }[],
  inViewTabs: string[],
  gaps: Gaps,
): Promise<void> {
  const cfg = loadConfig();
  const viewUrl = page.url();
  const seenIds = new Set<string>();
  const addLinks = (controls: Control[], via: string) => {
    for (const c of controls) {
      if (!c.href || c.sameOrigin === false) continue;
      const nav = c.inNav || c.inMenu || c.inHeader;
      if (!nav) continue;
      const d = classifyControl({ ...c, visible: true }, 'navigate');
      const label = labelFor(c);
      if (d.allowed) {
        enqueue({ url: c.href, name: label, depth: item.depth + 1, from: item.name || viewUrl, via, labelPriority: c.inNav ? 2 : c.inMenu ? 1 : 0 });
      } else if (d.category !== 'logout' && d.category !== 'link-scheme' && d.category !== 'external') {
        if (!skipped.some((x) => x.label === label)) skipped.push({ label, reason: d.reason });
        gaps.add('view-needs-write', label, `the link was not followed: ${d.reason}`);
      }
    }
  };

  const all = await inPage<Control[]>(page, 'controls', {});
  all.forEach((c) => seenIds.add(c.id));
  addLinks(all, 'navigation link');

  // Menus that open on hover or click.
  const openers = all.filter((c) => c.visible && !c.href && classifyControl(c, 'menu').allowed);
  for (const o of openers) {
    const loc = page.locator(`[data-sa-id="${o.id}"]`);
    try {
      await loc.hover({ timeout: 3000 });
      await sleep(cfg.crawl.menuSettleMs);
      let fresh = (await inPage<Control[]>(page, 'controls', { onlyVisible: true })).filter((c) => !seenIds.has(c.id) || c.inMenu);
      if (!fresh.some((c) => c.href)) {
        await loc.click({ timeout: 3000 });
        await sleep(cfg.crawl.menuSettleMs);
        fresh = (await inPage<Control[]>(page, 'controls', { onlyVisible: true })).filter((c) => !seenIds.has(c.id) || c.inMenu);
      }
      fresh.forEach((c) => seenIds.add(c.id));
      addLinks(fresh.map((c) => ({ ...c, inMenu: true })), `menu "${labelFor(o)}"`);
      await page.keyboard.press('Escape');
      await page.mouse.move(1, 1);
      if (routeKey(page.url()) !== routeKey(viewUrl)) await gotoView(page, viewUrl);
    } catch (e) {
      gaps.add('behaviour', `menu ${labelFor(o)}`, `menu could not be opened: ${errorText(e)}`);
    }
  }

  // Navigation buttons without href, and tabs that change the URL.
  const buttons = (await inPage<Control[]>(page, 'controls', { onlyVisible: true })).filter(
    (c) => !c.href && (classifyControl(c, 'navigate').allowed || classifyControl(c, 'tab').allowed),
  );
  for (const b of buttons.slice(0, 40)) {
    const isTab = classifyControl(b, 'tab').allowed;
    try {
      const loc = page.locator(`[data-sa-id="${b.id}"]`);
      if (!(await loc.count())) continue;
      await loc.click({ timeout: 3000 });
      await sleep(cfg.crawl.menuSettleMs);
      const now = page.url();
      if (routeKey(now) !== routeKey(viewUrl)) {
        enqueue({ url: now, name: labelFor(b), depth: item.depth + 1, from: item.name || viewUrl, via: isTab ? 'tab' : 'navigation button' });
        await gotoView(page, viewUrl);
      } else if (isTab) {
        inViewTabs.push(labelFor(b));
      }
    } catch (e) {
      gaps.add('behaviour', `control ${labelFor(b)}`, `click failed: ${errorText(e)}`);
    }
  }

  // Record the controls that the guard refused in the navigation areas.
  for (const c of all) {
    if (c.href || !c.visible || !(c.inNav || c.inHeader || c.inMenu)) continue;
    const d = classifyControl(c, 'active-state');
    if (!d.allowed && (d.category === 'deny-list' || d.category === 'form-submit' || d.category === 'logout')) {
      const label = labelFor(c);
      if (!skipped.some((x) => x.label === label)) skipped.push({ label, reason: d.reason });
    }
  }
}

async function captureView(
  s: Session,
  out: Output,
  item: QueueItem,
  name: string,
  info: { title: string; headings: string[] },
  slugs: Set<string>,
): Promise<View> {
  const cfg = loadConfig();
  const { page } = s;
  const u = new URL(page.url());
  let slug = slugify(`${u.pathname}${u.hash.startsWith('#/') ? u.hash : ''}`);
  if (slug === 'root' && name) slug = slugify(name);
  let n = 2;
  const base = slug;
  while (slugs.has(slug)) slug = `${base}-${n++}`;
  slugs.add(slug);
  const panels = await inPage<PanelInfo[]>(page, 'panels', {});
  const screenshots: Record<string, string> = {};
  for (const v of cfg.viewports) {
    await page.setViewportSize(v);
    await sleep(Math.min(800, cfg.crawl.settleMs));
    const file = out.path(`screenshots/${slug}/${viewportName(v)}.png`);
    await page.screenshot({ path: file, mask: screenshotMasks(page, s.creds.username), animations: 'disabled' });
    screenshots[viewportName(v)] = out.rel(file);
  }
  await page.setViewportSize(cfg.primaryViewport);
  const kinds = [...new Set(panels.map((p) => p.kind))];
  const titles = panels.map((p) => p.title).filter(Boolean);
  const purposeGuess =
    `Guess: the "${name}" view` +
    (panels.length ? ` shows ${panels.length} panel(s) of kind ${kinds.join(', ')}` : ' shows no panel that the heuristics found') +
    (titles.length ? `, with the titles ${titles.slice(0, 8).map((t) => `"${t}"`).join(', ')}` : '') +
    '.';
  return {
    name,
    slug,
    url: page.url(),
    displayUrl: redactUrl(page.url()),
    title: info.title,
    discoveredFrom: item.from,
    via: item.via,
    headings: info.headings,
    panels,
    purposeGuess,
    screenshots,
    inViewTabs: [],
    skippedControls: [],
  };
}

export function writeViews(out: Output, views: View[]): void {
  const lines: string[] = ['# Views', '', 'One section for each route that the navigation can reach. Pages that the audit did not capture are in gaps.md.', ''];
  for (const v of views) {
    lines.push(`## ${v.name}`, '');
    lines.push(`- URL: ${v.displayUrl}`);
    lines.push(`- Title: ${v.title || '(none)'}`);
    lines.push(`- Purpose: ${v.purposeGuess} (This is a guess from the DOM. Confirm it with Mohamed.)`);
    lines.push(`- Found from: ${v.discoveredFrom} (${v.via})`);
    lines.push(`- Headings: ${v.headings.length ? v.headings.join('; ') : '(none)'}`);
    if (v.inViewTabs.length) lines.push(`- Tabs in the view: ${v.inViewTabs.join('; ')}`);
    lines.push('', '### Panels', '');
    if (v.panels.length) {
      lines.push(
        mdTable(
          ['No.', 'Title', 'Kind (guess)', 'Position (x, y)', 'Size (w x h)'],
          v.panels.map((p, i) => [i + 1, p.title || '(no title)', p.kind, `${p.rect.x}, ${p.rect.y}`, `${p.rect.width} x ${p.rect.height}`]),
        ),
      );
    } else lines.push('No panel found by the DOM heuristics.', '');
    lines.push('### Screenshots', '');
    for (const [vp, file] of Object.entries(v.screenshots)) lines.push(`- ${vp}: [${file}](${file})`);
    if (v.skippedControls.length) {
      lines.push('', '### Controls that the safety guard did not click', '');
      lines.push(mdTable(['Control', 'Reason'], v.skippedControls.map((c) => [c.label, c.reason])));
    }
    lines.push('');
  }
  out.writeText('views.md', lines.join('\n'));
  out.writeJson(
    'views.json',
    views.map((v) => ({ name: v.name, slug: v.slug, url: v.url, displayUrl: v.displayUrl, panels: v.panels.length })),
  );
}
