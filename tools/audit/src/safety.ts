// Safety rules for the read-only audit.
// The crawler clicks a control only when classifyControl() allows it. The deny list always wins.
// The network guard (guard.ts) is the second line of defence: it blocks each non-GET request.

import { loadConfig } from './config.js';

/** A description of a DOM control, made in the page by inpage/controls.js. */
export interface ControlDescriptor {
  id?: string;
  tag: string;
  role?: string | null;
  type?: string | null;
  text?: string | null;
  ariaLabel?: string | null;
  title?: string | null;
  name?: string | null;
  elementId?: string | null;
  testId?: string | null;
  dataAction?: string | null;
  href?: string | null;
  sameOrigin?: boolean;
  target?: string | null;
  download?: boolean;
  inForm?: boolean;
  formHasPassword?: boolean;
  inNav?: boolean;
  inMenu?: boolean;
  inHeader?: boolean;
  inPanelHeader?: boolean;
  inTablist?: boolean;
  hasPopup?: boolean;
  expanded?: string | null;
  disabled?: boolean;
  contentEditable?: boolean;
  visible?: boolean;
}

export type Purpose = 'navigate' | 'menu' | 'tab' | 'panel-view' | 'layout' | 'active-state' | 'logout';

export interface Decision {
  allowed: boolean;
  category: string;
  reason: string;
}

const compiled = new Map<string, RegExp>();
function re(src: string): RegExp {
  let r = compiled.get(src);
  if (!r) {
    r = new RegExp(src, 'i');
    compiled.set(src, r);
  }
  return r;
}

/** Split camelCase, kebab-case, snake_case and path separators into words. */
export function words(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-/\\.#?=&:+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hrefWords(href: string | null | undefined): string {
  if (!href) return '';
  try {
    const u = new URL(href, 'http://x.invalid');
    return words(`${u.pathname} ${[...u.searchParams.keys()].join(' ')} ${u.hash}`);
  } catch {
    return words(href);
  }
}

/** The text that the rules test: visible text, accessible name, title and identifiers. Class names are not used. */
export function labelOf(d: ControlDescriptor): string {
  return [d.text, d.ariaLabel, d.title, words(d.name), words(d.elementId), words(d.testId), words(d.dataAction), hrefWords(d.href)]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();
}

/** The visible name only, for the patterns that must match the whole label (for example "+"). */
function shortLabel(d: ControlDescriptor): string {
  return (d.ariaLabel || d.text || d.title || '').trim().toLowerCase();
}

export function matchesAny(text: string, patterns: string[]): string | undefined {
  return patterns.find((p) => re(p).test(text));
}

const FORM_ROLES = new Set(['switch', 'checkbox', 'radio', 'menuitemcheckbox', 'menuitemradio', 'slider', 'spinbutton', 'textbox', 'searchbox', 'combobox', 'option']);
const INPUT_TAGS = new Set(['input', 'select', 'textarea', 'option']);

function isLink(d: ControlDescriptor): boolean {
  return (d.tag === 'a' && !!d.href) || d.role === 'link';
}

export function classifyControl(d: ControlDescriptor, purpose: Purpose): Decision {
  const cfg = loadConfig().safety;
  const label = labelOf(d);
  const short = shortLabel(d);
  const deny = (category: string, reason: string): Decision => ({ allowed: false, category, reason });
  const allow = (category: string, reason: string): Decision => ({ allowed: true, category, reason });

  if (d.disabled) return deny('disabled', 'control is disabled');
  if (d.visible === false) return deny('hidden', 'control is not visible');

  const logout = matchesAny(label, cfg.logoutPatterns);
  if (purpose === 'logout') {
    if (!logout) return deny('not-logout', 'control is not a log out control');
    if (d.inForm && !d.formHasPassword && d.type === 'submit' && !d.inMenu && !d.inHeader && !d.inNav) {
      // A log out button in a form is still a log out control. Allow it only in the final log out step.
      return allow('logout', 'final log out (form)');
    }
    return allow('logout', 'final log out');
  }
  if (logout) return deny('logout', 'log out is allowed only at the end of the session');

  // Layout controls such as "Add panel" contain words from the deny list. Allow them only for layout work:
  // "close" and "hide" only in a panel header, "add ... panel" anywhere.
  let layoutMatch: string | undefined;
  if (purpose === 'layout') {
    layoutMatch = d.inPanelHeader ? matchesAny(short || label, cfg.layoutClosePatterns) : undefined;
    layoutMatch ??= matchesAny(short || label, cfg.layoutAddPatterns);
  }
  const denied = matchesAny(label, cfg.denyPatterns);
  if (denied && !layoutMatch) return deny('deny-list', `label matches deny pattern /${denied}/`);

  // Structural rules: forms, inputs and toggles change data or settings.
  if (d.inForm && !d.formHasPassword) {
    if (d.type === 'submit' || d.type === 'reset' || (d.tag === 'button' && !d.type) || d.tag === 'input') {
      return deny('form-submit', 'control can submit a form');
    }
  }
  if (d.type === 'submit' || d.type === 'reset' || d.type === 'image') return deny('form-submit', 'submit or reset control');
  if (INPUT_TAGS.has(d.tag)) return deny('form-control', 'form controls are not clicked');
  if (d.role && FORM_ROLES.has(d.role)) return deny('form-control', `role ${d.role} changes a value`);
  if (d.contentEditable) return deny('form-control', 'editable content');
  if (d.href) {
    const h = d.href.trim().toLowerCase();
    if (h.startsWith('javascript:') || h.startsWith('mailto:') || h.startsWith('tel:') || h.startsWith('data:') || h.startsWith('blob:')) {
      return deny('link-scheme', 'link scheme is not a page');
    }
    if (d.download) return deny('download', 'link downloads a file');
    if (d.sameOrigin === false) return deny('external', 'link leaves the audited site');
  }

  switch (purpose) {
    case 'navigate':
      if (isLink(d) && (d.inNav || d.inMenu || d.inHeader)) return allow('nav-link', 'navigation link');
      if ((d.tag === 'button' || d.role === 'button' || d.role === 'menuitem') && (d.inNav || d.inMenu) && !d.hasPopup) {
        return allow('nav-button', 'navigation control in a navigation area');
      }
      if (d.role === 'menuitem' && isLink(d)) return allow('nav-link', 'menu link');
      return deny('not-allowed', 'not a navigation control');
    case 'menu':
      if ((d.hasPopup || d.expanded === 'false') && (d.inNav || d.inHeader || d.inMenu)) return allow('menu-opener', 'opens a navigation menu');
      return deny('not-allowed', 'not a menu opener');
    case 'tab':
      if (d.role === 'tab' || d.inTablist) return allow('tab', 'tab');
      return deny('not-allowed', 'not a tab');
    case 'panel-view': {
      if (!d.inPanelHeader) return deny('not-allowed', 'not in a panel header');
      const pv = matchesAny(short || label, cfg.panelViewPatterns);
      if (pv) return allow('panel-view', `panel view control /${pv}/`);
      return deny('not-allowed', 'panel header control is not a view control');
    }
    case 'layout': {
      const pv = d.inPanelHeader ? matchesAny(short || label, cfg.panelViewPatterns) : undefined;
      if (pv) return allow('panel-view', `panel view control /${pv}/`);
      if (layoutMatch) return allow('layout', `layout control /${layoutMatch}/`);
      return deny('not-allowed', 'not a layout control');
    }
    case 'active-state': {
      for (const p of ['navigate', 'tab', 'panel-view', 'menu'] as Purpose[]) {
        const r = classifyControl(d, p);
        if (r.allowed) return r;
      }
      return deny('not-allowed', 'no safe category');
    }
    default:
      return deny('not-allowed', 'unknown purpose');
  }
}

export interface SensitiveResult {
  sensitive: boolean;
  category?: 'credentials' | 'api-keys' | 'billing' | 'personal-data';
  reason?: string;
}

function categoryOf(match: string): SensitiveResult['category'] {
  if (/api|token|secret|key/.test(match)) return 'api-keys';
  if (/bill|invoice|pay|subscription|checkout|plan|card/.test(match)) return 'billing';
  if (/password|credential|mfa|2fa|two|recovery|security/.test(match)) return 'credentials';
  return 'personal-data';
}

/** Decide whether a page must not be captured. The caller records the page name only. */
export function isSensitivePage(input: {
  url: string;
  text?: string;
  hasPasswordInput?: boolean;
  emailCount?: number;
}): SensitiveResult {
  const cfg = loadConfig().sensitive;
  let pathWords = '';
  try {
    const u = new URL(input.url);
    pathWords = words(`${u.pathname} ${u.hash}`);
  } catch {
    pathWords = words(input.url);
  }
  const urlHit = matchesAny(pathWords, cfg.urlPatterns);
  if (urlHit) return { sensitive: true, category: categoryOf(urlHit), reason: 'URL suggests sensitive content' };
  if (input.hasPasswordInput) return { sensitive: true, category: 'credentials', reason: 'page has a password field' };
  const text = (input.text ?? '').toLowerCase();
  const textHit = matchesAny(text, cfg.textPatterns);
  if (textHit) return { sensitive: true, category: categoryOf(textHit), reason: 'page text suggests sensitive content' };
  if ((input.emailCount ?? 0) >= cfg.emailCountThreshold) {
    return { sensitive: true, category: 'personal-data', reason: 'page lists e-mail addresses' };
  }
  return { sensitive: false };
}

/** Classify a WebSocket frame that the page sends. A frame whose action words match the deny list is blocked. */
export function classifyWsFrame(message: string | Buffer): Decision {
  const cfg = loadConfig().safety;
  if (typeof message !== 'string') return { allowed: true, category: 'binary', reason: 'binary frame is not inspected' };
  const actions: string[] = [];
  let body = message.trim();
  // socket.io / engine.io framing: 42["event", ...] or 42/namespace,["event"]
  const sio = body.match(/^\d+(?:\/[^,]*,)?(\d*)(\[[\s\S]*\])$/);
  if (sio) body = sio[2] as string;
  try {
    const parsed = JSON.parse(body) as unknown;
    const visit = (v: unknown, depth: number) => {
      if (depth > 3 || v === null) return;
      if (Array.isArray(v)) {
        if (typeof v[0] === 'string') actions.push(v[0]);
        v.slice(1).forEach((x) => visit(x, depth + 1));
      } else if (typeof v === 'object') {
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          if (cfg.wsActionKeys.includes(k) && typeof val === 'string') actions.push(val);
          if (k === 'query' && typeof val === 'string' && /^\s*mutation\b/i.test(val)) actions.push('mutation');
          if (typeof val === 'object') visit(val, depth + 1);
        }
      }
    };
    visit(parsed, 0);
  } catch {
    // Plain text frame: test the first word, for example "SUBSCRIBE quotes".
    const first = body.split(/\s+/)[0];
    if (first) actions.push(first);
  }
  if (actions.includes('mutation')) return { allowed: false, category: 'ws-mutation', reason: 'GraphQL mutation' };
  for (const a of actions) {
    const w = words(a);
    if (cfg.wsProtocolActions.includes(a.toLowerCase()) || cfg.wsProtocolActions.includes(w)) continue;
    const hit = matchesAny(w, cfg.denyPatterns);
    if (hit) return { allowed: false, category: 'ws-deny', reason: `frame action "${a}" matches /${hit}/` };
  }
  return { allowed: true, category: 'ws-read', reason: actions.length ? `actions: ${actions.join(', ')}` : 'no action field' };
}
