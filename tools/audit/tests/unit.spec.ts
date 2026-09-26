// Unit tests for the safety guard, redaction, token clustering and the DTCG validator.

import { expect, test } from '@playwright/test';
import { compareRaw, indexTokens } from '../src/check-tokens.js';
import { fromDtcgColor, normalizeColor, toDtcgColor } from '../src/color.js';
import { validateDtcg, type Group } from '../src/dtcg.js';
import { estimateGrid } from '../src/layout.js';
import { clearSecrets, redactUrl, registerSecret, scrub, scrubDeep } from '../src/redact.js';
import { classifyControl, classifyWsFrame, isSensitivePage, type ControlDescriptor, type Purpose } from '../src/safety.js';
import { buildTokens, emptyRaw, parseEasing, parseShadow, type RawValues } from '../src/tokens.js';

const ALL: Purpose[] = ['navigate', 'menu', 'tab', 'panel-view', 'layout', 'active-state'];
const btn = (text: string, extra: Partial<ControlDescriptor> = {}): ControlDescriptor => ({ tag: 'button', text, visible: true, ...extra });
const link = (text: string, href: string, extra: Partial<ControlDescriptor> = {}): ControlDescriptor => ({
  tag: 'a',
  text,
  href,
  sameOrigin: true,
  inNav: true,
  visible: true,
  ...extra,
});

test.describe('safety: deny list and safe-click allow list', () => {
  const denied: [string, ControlDescriptor][] = [
    ['Save submit button in a form', btn('Save', { type: 'submit', inForm: true, inPanelHeader: false })],
    ['Save button outside a form', btn('Save')],
    ['Delete', btn('Delete', { inNav: true })],
    ['Submit order', btn('Submit order', { inNav: true })],
    ['Send', btn('Send', { inMenu: true })],
    ['Publish', btn('Publish', { inHeader: true })],
    ['Create alert link', link('Create alert', 'http://x.test/alerts/new')],
    ['Update', btn('Update', { inPanelHeader: true })],
    ['Remove panel', btn('Remove panel', { inPanelHeader: true })],
    ['Apply filters', btn('Apply', { inPanelHeader: true })],
    ['Confirm', btn('Confirm', { inMenu: true })],
    ['Buy', btn('Buy', { inNav: true })],
    ['Sell', btn('Sell', { inNav: true })],
    ['Place order', btn('Place order', { inNav: true })],
    ['Settings link', link('Settings', 'http://x.test/settings')],
    ['Dismiss alert', btn('Dismiss', { inPanelHeader: true })],
    ['Acknowledge', btn('Acknowledge', { inPanelHeader: true })],
    ['Watch button', btn('Watch', { inPanelHeader: true })],
    ['Mark all as read', btn('Mark all as read', { inMenu: true })],
    ['icon button with aria-label save', btn('', { ariaLabel: 'Save layout', inPanelHeader: true })],
    ['button with data-testid delete', btn('', { testId: 'delete-row', inPanelHeader: true })],
    ['checkbox role', { tag: 'div', role: 'checkbox', text: 'Dark mode', inMenu: true, visible: true }],
    ['switch role', { tag: 'button', role: 'switch', text: 'Live', inPanelHeader: true, visible: true }],
    ['text input', { tag: 'input', type: 'text', inHeader: true, visible: true }],
    ['external link', link('Docs', 'https://example.org/docs', { sameOrigin: false })],
    ['mailto link', link('Mail us', 'mailto:a@b.c')],
    ['javascript link', link('Run', 'javascript:void(0)')],
    ['download link', link('Report', 'http://x.test/report.pdf', { download: true })],
    ['disabled nav link', link('Markets', 'http://x.test/markets', { disabled: true })],
    ['hidden control', { ...link('Markets', 'http://x.test/markets'), visible: false }],
  ];
  for (const [name, d] of denied) {
    test(`denies: ${name}`, () => {
      for (const p of ALL) expect(classifyControl(d, p).allowed, `${name} / ${p}`).toBe(false);
    });
  }

  test('log out is denied, except in the final log out step', () => {
    const d = btn('Log out', { inMenu: true, role: 'menuitem' });
    for (const p of ALL) expect(classifyControl(d, p).allowed).toBe(false);
    expect(classifyControl(d, 'logout').allowed).toBe(true);
    expect(classifyControl(btn('Sign out', { inHeader: true }), 'logout').allowed).toBe(true);
    expect(classifyControl(btn('Save', { inMenu: true }), 'logout').allowed).toBe(false);
  });

  test('allows navigation links, tabs, menu openers and panel view controls', () => {
    expect(classifyControl(link('Markets', 'http://x.test/markets'), 'navigate').allowed).toBe(true);
    expect(classifyControl(link('Watchlist', 'http://x.test/watchlist'), 'navigate').allowed).toBe(true);
    expect(classifyControl(link('News', 'http://x.test/news', { inNav: false, inMenu: true, role: 'menuitem' }), 'navigate').allowed).toBe(true);
    expect(classifyControl({ tag: 'button', role: 'tab', text: 'Latest', inTablist: true, visible: true }, 'tab').allowed).toBe(true);
    expect(classifyControl(btn('More', { hasPopup: true, inNav: true }), 'menu').allowed).toBe(true);
    expect(classifyControl(btn('', { ariaLabel: 'Maximise panel', inPanelHeader: true }), 'panel-view').allowed).toBe(true);
    expect(classifyControl(btn('', { ariaLabel: 'Collapse', inPanelHeader: true }), 'panel-view').allowed).toBe(true);
    expect(classifyControl(btn('1M', { inPanelHeader: true }), 'panel-view').allowed).toBe(true);
  });

  test('a link outside the navigation areas is not a navigation control', () => {
    expect(classifyControl(link('Details', 'http://x.test/q/1', { inNav: false }), 'navigate').allowed).toBe(false);
    expect(classifyControl(btn('Details'), 'active-state').allowed).toBe(false);
  });

  test('close and add panel are allowed for layout work only', () => {
    const close = btn('', { ariaLabel: 'Close panel', inPanelHeader: true });
    expect(classifyControl(close, 'layout').allowed).toBe(true);
    expect(classifyControl(close, 'panel-view').allowed).toBe(false);
    expect(classifyControl(close, 'navigate').allowed).toBe(false);
    const add = btn('+ Add panel', { ariaLabel: 'Add panel', inHeader: true });
    expect(classifyControl(add, 'layout').allowed).toBe(true);
    expect(classifyControl(add, 'active-state').allowed).toBe(false);
    // "Close" outside a panel header is not a layout control.
    expect(classifyControl(btn('Close', { inHeader: true }), 'layout').allowed).toBe(false);
    // "Add to watchlist" changes data and stays denied.
    expect(classifyControl(btn('Add to watchlist', { inPanelHeader: true }), 'layout').allowed).toBe(false);
  });
});

test.describe('safety: sensitive pages', () => {
  test('URL and text rules', () => {
    expect(isSensitivePage({ url: 'https://a.test/billing' })).toMatchObject({ sensitive: true, category: 'billing' });
    expect(isSensitivePage({ url: 'https://a.test/settings/api-keys' })).toMatchObject({ sensitive: true, category: 'api-keys' });
    expect(isSensitivePage({ url: 'https://a.test/account/profile' })).toMatchObject({ sensitive: true, category: 'personal-data' });
    expect(isSensitivePage({ url: 'https://a.test/admin/users' }).sensitive).toBe(true);
    expect(isSensitivePage({ url: 'https://a.test/x', text: 'Payment method: card ending 4242' })).toMatchObject({ sensitive: true, category: 'billing' });
    expect(isSensitivePage({ url: 'https://a.test/x', hasPasswordInput: true })).toMatchObject({ sensitive: true, category: 'credentials' });
    expect(isSensitivePage({ url: 'https://a.test/x', emailCount: 3 })).toMatchObject({ sensitive: true, category: 'personal-data' });
    expect(isSensitivePage({ url: 'https://a.test/markets', text: 'Copper 9,412.50' }).sensitive).toBe(false);
    expect(isSensitivePage({ url: 'https://a.test/#/dashboard', text: 'Watchlist' }).sensitive).toBe(false);
  });
});

test.describe('safety: WebSocket frames', () => {
  test('subscriptions pass, writes are blocked', () => {
    expect(classifyWsFrame('{"type":"subscribe","channel":"quotes"}').allowed).toBe(true);
    expect(classifyWsFrame('42["subscribe","quotes"]').allowed).toBe(true);
    expect(classifyWsFrame('{"type":"connection_init"}').allowed).toBe(true);
    expect(classifyWsFrame('2').allowed).toBe(true);
    expect(classifyWsFrame(Buffer.from([1, 2, 3])).allowed).toBe(true);
    expect(classifyWsFrame('42["update_layout",{"a":1}]').allowed).toBe(false);
    expect(classifyWsFrame('{"action":"saveWorkspace"}').allowed).toBe(false);
    expect(classifyWsFrame('{"type":"subscribe","payload":{"query":"mutation { save }"}}').allowed).toBe(false);
    expect(classifyWsFrame('DELETE alert 7').allowed).toBe(false);
  });
});

test.describe('redaction', () => {
  test.afterEach(() => clearSecrets());
  test('registered secrets and their encoded forms are replaced', () => {
    const secret = 'p@ss w0rd/%x';
    registerSecret(secret);
    const text = `a ${secret} b ${encodeURIComponent(secret)} c ${JSON.stringify(secret)}`;
    const out = scrub(text);
    expect(out).not.toContain(secret);
    expect(out).not.toContain(encodeURIComponent(secret));
    expect(scrubDeep({ [secret]: [secret] })).toEqual({ '[REDACTED]': ['[REDACTED]'] });
  });
  test('known key formats, e-mail addresses and URL credentials are replaced', () => {
    const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'abcdefghijklmnopqrstu'].join('.');
    expect(scrub(`token ${jwt}`)).not.toContain(jwt);
    expect(scrub('mail me at someone@example.org')).toBe('mail me at [email]');
    expect(scrub('api_key=zzzzzzzzzz')).toBe('api_key=[REDACTED]');
    expect(scrub('header Bearer zzzzzzzzzzzz')).toBe('header Bearer [REDACTED]');
    expect(scrub('Authorization: Bearer zzzzzzzzzzzz')).not.toContain('zzzz');
    expect(scrub('https://user:pw@host.test/x')).toBe('https://[REDACTED]@host.test/x');
  });
  test('redactUrl keeps parameter names only', () => {
    expect(redactUrl('https://u:p@a.test/path?token=abc&view=1#frag')).toBe('https://a.test/path?token=…&view=…');
    expect(redactUrl('https://a.test/#/dash?x=1')).toBe('https://a.test/#/dash');
  });
});

test.describe('colours and DTCG', () => {
  test('normalisation and round trip', () => {
    expect(normalizeColor('#0B0E11')).toBe('rgb(11, 14, 17)');
    expect(normalizeColor('rgba(22, 199, 132, 0.2)')).toBe('rgba(22, 199, 132, 0.2)');
    expect(normalizeColor('rgb(1 2 3 / 50%)')).toBe('rgba(1, 2, 3, 0.5)');
    expect(normalizeColor('rgba(0,0,0,0)')).toBe('transparent');
    for (const c of ['rgb(11, 14, 17)', 'rgba(22, 199, 132, 0.2)', 'rgb(255, 255, 255)', 'rgb(128, 127, 1)']) {
      expect(fromDtcgColor(toDtcgColor(c))).toBe(c);
    }
  });

  test('validator accepts valid tokens and rejects invalid ones', () => {
    const ok: Group = {
      color: { $type: 'color', bg: { base: { $value: toDtcgColor('rgb(11, 14, 17)') } }, alias: { $value: '{color.bg.base}' } },
      space: { '1': { $type: 'dimension', $value: { value: 4, unit: 'px' } } },
      motion: { easing: { standard: { $type: 'cubicBezier', $value: [0.2, 0, 0, 1] } }, d: { $type: 'duration', $value: { value: 120, unit: 'ms' } } },
      shadow: { sm: { $type: 'shadow', $value: { color: toDtcgColor('rgba(0, 0, 0, 0.4)'), offsetX: { value: 0, unit: 'px' }, offsetY: { value: 1, unit: 'px' }, blur: { value: 2, unit: 'px' }, spread: { value: 0, unit: 'px' } } } },
      font: { numeric: { $description: 'x', $extensions: { a: 1 } } },
    };
    expect(validateDtcg(ok)).toEqual([]);
    expect(validateDtcg({ a: { $value: '#fff' } })).toContain('a: token has no $type and no inherited type');
    expect(validateDtcg({ a: { $type: 'color', $value: '#fff' } }).length).toBeGreaterThan(0);
    expect(validateDtcg({ a: { $type: 'dimension', $value: '4px' } }).length).toBeGreaterThan(0);
    expect(validateDtcg({ 'a.b': { $type: 'number', $value: 1 } }).length).toBeGreaterThan(0);
    expect(validateDtcg({ a: { $type: 'color', $value: '{missing.token}' } }).length).toBeGreaterThan(0);
    expect(validateDtcg({ a: { $type: 'fontVariantNumeric', $value: 'tabular-nums' } }).length).toBeGreaterThan(0);
  });

  test('shadow and easing parsing', () => {
    expect(parseShadow('rgba(0, 0, 0, 0.5) 0px 8px 24px 0px, rgb(1, 2, 3) 0px 0px 0px 1px inset')).toEqual([
      { color: 'rgba(0, 0, 0, 0.5)', offsetX: 0, offsetY: 8, blur: 24, spread: 0, inset: false },
      { color: 'rgb(1, 2, 3)', offsetX: 0, offsetY: 0, blur: 0, spread: 1, inset: true },
    ]);
    expect(parseEasing('ease')).toEqual([0.25, 0.1, 0.25, 1]);
    expect(parseEasing('cubic-bezier(0.2, 0, 0, 1)')).toEqual([0.2, 0, 0, 1]);
    expect(parseEasing('steps(4, end)')).toBeUndefined();
  });
});

function usage(count: number, textLen = 0) {
  return { count, textLen, props: {} as Record<string, number> };
}
function colour(props: Record<string, number>, extra: Partial<RawValues['colors'][string]> = {}) {
  const count = Object.values(props).reduce((a, b) => a + b, 0);
  return { count, props, area: 0, textLen: 0, disabledText: 0, overlay: 0, raw: {}, samples: [], ...extra };
}

test.describe('token clustering', () => {
  const raw: RawValues = {
    ...emptyRaw(),
    base: { body: 'rgb(11, 14, 17)', html: 'rgb(11, 14, 17)' },
    colors: {
      'rgb(11, 14, 17)': colour({ 'background-color': 2, color: 3 }, { area: 2_000_000, textLen: 30 }),
      'rgb(18, 22, 28)': colour({ 'background-color': 20 }, { area: 900_000 }),
      'rgb(26, 31, 39)': colour({ 'background-color': 10 }, { area: 300_000 }),
      'rgb(35, 42, 52)': colour({ 'background-color': 5 }, { area: 50_000 }),
      'rgba(0, 0, 0, 0.6)': colour({ 'background-color': 1 }, { area: 2_000_000, overlay: 1 }),
      'rgb(230, 233, 239)': colour({ color: 100 }, { textLen: 5000 }),
      'rgb(163, 172, 185)': colour({ color: 40 }, { textLen: 1500 }),
      'rgb(107, 118, 132)': colour({ color: 20 }, { textLen: 600 }),
      'rgb(74, 82, 96)': colour({ color: 2 }, { textLen: 40, disabledText: 2 }),
      'rgb(42, 49, 60)': colour({ 'border-color': 50 }),
      'rgb(31, 37, 46)': colour({ 'border-color': 20 }),
      'rgb(58, 67, 80)': colour({ 'border-color': 5 }),
      'rgb(96, 165, 250)': colour({ 'outline-color': 3 }),
      'rgb(22, 199, 132)': colour({ color: 30 }, { textLen: 200 }),
      'rgb(234, 57, 67)': colour({ color: 25 }, { textLen: 150 }),
      'rgb(59, 130, 246)': colour({ 'background-color': 8, stroke: 2 }),
      'rgb(245, 158, 11)': colour({ color: 3 }, { textLen: 20 }),
      'rgb(1, 2, 250)': colour({ fill: 1 }),
    },
    fontFamilies: { 'Inter, system-ui, sans-serif': usage(100, 5000), 'ui-monospace, Menlo, monospace': usage(20, 800) },
    fontSizes: { '10px': usage(5), '11px': usage(30), '12px': usage(40), '13px': usage(100, 5000), '14px': usage(10), '16px': usage(4), '20px': usage(2), '24px': usage(1), '9px': usage(1) },
    fontWeights: { '400': usage(100), '500': usage(20), '600': usage(10), '700': usage(3) },
    lineHeights: { '1.4': usage(100, 5000), '1.2': usage(10), '1.6': usage(5) },
    letterSpacings: { '0px': usage(100), '0.4px': usage(10), '-0.2px': usage(3) },
    numeric: { 'tabular-nums': usage(50, 900) },
    spacing: { '0px': usage(500), '4px': usage(200), '8px': usage(150), '12px': usage(40), '16px': usage(20), '24px': usage(5), '6px': usage(3) },
    radii: { '0px': usage(100), '2px': usage(10), '4px': usage(50), '8px': usage(5), '50%': usage(2) },
    shadows: { 'rgba(0, 0, 0, 0.4) 0px 1px 2px 0px': usage(5), 'rgba(0, 0, 0, 0.5) 0px 8px 24px 0px': usage(3), 'rgba(0, 0, 0, 0.6) 0px 16px 48px 0px': usage(1) },
    zIndex: {
      '1': { count: 5, kinds: { panel: 5 } },
      '20': { count: 1, kinds: { sticky: 1 } },
      '30': { count: 2, kinds: { dropdown: 2 } },
      '50': { count: 1, kinds: { modal: 1 } },
      '60': { count: 1, kinds: { toast: 1 } },
      '70': { count: 1, kinds: { tooltip: 1 } },
    },
    durations: { '120': usage(10), '200': usage(20), '600': usage(2) },
    easings: { 'cubic-bezier(0.2, 0, 0, 1)': usage(10), ease: usage(20) },
  };

  test('named slots follow the M0 token plan', () => {
    const { tokens, missing } = buildTokens(raw);
    expect(validateDtcg(tokens)).toEqual([]);
    const hexOf = (p: string) => (p.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], tokens) as { $value: { hex: string } }).$value.hex;
    expect(hexOf('color.bg.base')).toBe('#0b0e11');
    expect(hexOf('color.bg.surface-1')).toBe('#12161c');
    expect(hexOf('color.bg.surface-2')).toBe('#1a1f27');
    expect(hexOf('color.bg.surface-3')).toBe('#232a34');
    expect(hexOf('color.text.primary')).toBe('#e6e9ef');
    expect(hexOf('color.text.secondary')).toBe('#a3acb9');
    expect(hexOf('color.text.tertiary')).toBe('#6b7684');
    expect(hexOf('color.text.disabled')).toBe('#4a5260');
    expect(hexOf('color.text.inverse')).toBe('#0b0e11');
    expect(hexOf('color.border.default')).toBe('#2a313c');
    expect(hexOf('color.border.subtle')).toBe('#1f252e');
    expect(hexOf('color.border.strong')).toBe('#3a4350');
    expect(hexOf('color.focus.ring')).toBe('#60a5fa');
    expect(hexOf('color.state.positive')).toBe('#16c784');
    expect(hexOf('color.state.negative')).toBe('#ea3943');
    expect(hexOf('color.state.accent')).toBe('#3b82f6');
    expect(hexOf('color.state.warning')).toBe('#f59e0b');
    const t = tokens as Record<string, any>;
    expect(t.font.size.md.$value).toEqual({ value: 13, unit: 'px' });
    expect(t.font.size.sm.$value).toEqual({ value: 12, unit: 'px' });
    expect(t.font.size.xs.$value).toEqual({ value: 11, unit: 'px' });
    expect(t.font.size['2xs'].$value).toEqual({ value: 10, unit: 'px' });
    expect(t.font.size.lg.$value).toEqual({ value: 14, unit: 'px' });
    expect(t.font.family.mono.$value[0]).toBe('ui-monospace');
    expect(t.font.numeric.$extensions['io.strata.audit'].fontVariantNumeric).toBe('tabular-nums');
    expect(t.space['2'].$value).toEqual({ value: 8, unit: 'px' });
    expect(t.space['x-6'].$value).toEqual({ value: 6, unit: 'px' });
    expect(t.radius.full.$value).toEqual({ value: 9999, unit: 'px' });
    expect(t.radius.md.$value).toEqual({ value: 4, unit: 'px' });
    expect(t.shadow.lg.$value.blur).toEqual({ value: 48, unit: 'px' });
    expect(t.z.modal.$value).toBe(50);
    expect(t.z.base.$value).toBe(1);
    expect(t.motion.duration.fast.$value).toEqual({ value: 120, unit: 'ms' });
    expect(t.motion.easing.standard.$value).toEqual([0.25, 0.1, 0.25, 1]);
    expect(t.motion.easing.emphasized.$value).toEqual([0.2, 0, 0, 1]);
    expect(missing).not.toContain('color.bg.base');
  });

  test('every colour, font size and spacing value maps to a token', () => {
    const { tokens } = buildTokens(raw);
    const idx = indexTokens(tokens);
    expect(compareRaw(raw, idx).unmapped).toEqual([]);
    const extra = { ...raw, colors: { ...raw.colors, 'rgb(9, 9, 9)': colour({ color: 1 }) }, spacing: { ...raw.spacing, '7px': usage(1) } };
    const r = compareRaw(extra, idx);
    expect(r.unmapped.map((u) => `${u.kind} ${u.value}`).sort()).toEqual(['color rgb(9, 9, 9)', 'spacing 7px']);
  });
});

test.describe('layout grid estimate', () => {
  test('12 columns, 8px gutter and 30px rows from item geometry', () => {
    const W = 1720;
    const colW = (W - 8 * 13) / 12;
    const g = (x: number, y: number, w: number, h: number) => ({
      left: Math.round(8 + x * (colW + 8)),
      top: 8 + y * 38,
      width: Math.round(w * colW + (w - 1) * 8),
      height: h * 30 + (h - 1) * 8,
    });
    const e = estimateGrid(W, [g(0, 0, 6, 8), g(6, 0, 6, 8), g(0, 8, 4, 3), g(4, 8, 8, 5)]);
    expect(e.cols).toBe(12);
    expect(e.marginX).toBe(8);
    expect(e.rowHeight).toBe(30);
    expect(e.rowHeightCandidates).toContain(30);
  });
});
