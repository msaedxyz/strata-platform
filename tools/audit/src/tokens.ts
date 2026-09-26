// Design token extraction (docs/01-audit.md, "Design tokens").
// 1. collectRaw() reads computed values in each view (inpage/collect-styles.js).
// 2. buildTokens() clusters the raw values into named DTCG tokens. Each colour, font size and
//    spacing value that is not a named token becomes an extra token, so that criterion 2 can map every value.

import type { Page } from '@playwright/test';
import { contrast, hex8, hsl, luminance, parseNorm, toDtcgColor, type Rgba } from './color.js';
import { loadConfig } from './config.js';
import { dimension, setPath, type Group, type Token } from './dtcg.js';
import type { NetworkGuard } from './guard.js';
import { inPage, mdTable, type Output } from './util.js';

export interface Usage {
  count: number;
  textLen: number;
  props: Record<string, number>;
}
export interface ColorUsage {
  count: number;
  props: Record<string, number>;
  area: number;
  textLen: number;
  disabledText: number;
  overlay: number;
  raw: Record<string, number>;
  samples: string[];
}
export interface RawValues {
  colors: Record<string, ColorUsage>;
  fontFamilies: Record<string, Usage>;
  fontSizes: Record<string, Usage>;
  fontWeights: Record<string, Usage>;
  lineHeights: Record<string, Usage>;
  letterSpacings: Record<string, Usage>;
  numeric: Record<string, Usage>;
  spacing: Record<string, Usage>;
  radii: Record<string, Usage>;
  shadows: Record<string, Usage>;
  zIndex: Record<string, { count: number; kinds: Record<string, number> }>;
  durations: Record<string, Usage>;
  easings: Record<string, Usage>;
  rootVars: Record<string, string>;
  base: { html?: string | null; body?: string | null };
  elementCount: number;
  focusRing?: Record<string, number>;
  views?: string[];
}

export function emptyRaw(): RawValues {
  return {
    colors: {},
    fontFamilies: {},
    fontSizes: {},
    fontWeights: {},
    lineHeights: {},
    letterSpacings: {},
    numeric: {},
    spacing: {},
    radii: {},
    shadows: {},
    zIndex: {},
    durations: {},
    easings: {},
    rootVars: {},
    base: {},
    elementCount: 0,
    focusRing: {},
    views: [],
  };
}

export async function collectRaw(page: Page): Promise<RawValues> {
  return inPage<RawValues>(page, 'collect-styles', { spacingMaxPx: loadConfig().tokens.spacingMaxPx });
}

function mergeUsage(a: Record<string, Usage>, b: Record<string, Usage>): void {
  for (const [k, v] of Object.entries(b)) {
    const t = a[k] ?? (a[k] = { count: 0, textLen: 0, props: {} });
    t.count += v.count;
    t.textLen += v.textLen ?? 0;
    for (const [p, n] of Object.entries(v.props ?? {})) t.props[p] = (t.props[p] ?? 0) + n;
  }
}

export function mergeRaw(into: RawValues, add: RawValues, view?: string): RawValues {
  for (const [k, v] of Object.entries(add.colors)) {
    const t =
      into.colors[k] ?? (into.colors[k] = { count: 0, props: {}, area: 0, textLen: 0, disabledText: 0, overlay: 0, raw: {}, samples: [] });
    t.count += v.count;
    t.area += v.area;
    t.textLen += v.textLen;
    t.disabledText += v.disabledText;
    t.overlay += v.overlay;
    for (const [p, n] of Object.entries(v.props)) t.props[p] = (t.props[p] ?? 0) + n;
    for (const [p, n] of Object.entries(v.raw)) if (Object.keys(t.raw).length < 5) t.raw[p] = (t.raw[p] ?? 0) + n;
    for (const s of v.samples) if (t.samples.length < 5) t.samples.push(view ? `${view}: ${s}` : s);
  }
  for (const key of ['fontFamilies', 'fontSizes', 'fontWeights', 'lineHeights', 'letterSpacings', 'numeric', 'spacing', 'radii', 'shadows', 'durations', 'easings'] as const) {
    mergeUsage(into[key], add[key]);
  }
  for (const [k, v] of Object.entries(add.zIndex)) {
    const t = into.zIndex[k] ?? (into.zIndex[k] = { count: 0, kinds: {} });
    t.count += v.count;
    for (const [p, n] of Object.entries(v.kinds)) t.kinds[p] = (t.kinds[p] ?? 0) + n;
  }
  Object.assign(into.rootVars, add.rootVars);
  into.base.html ??= add.base.html;
  into.base.body ??= add.base.body;
  into.elementCount += add.elementCount;
  if (add.focusRing) for (const [k, n] of Object.entries(add.focusRing)) into.focusRing![k] = (into.focusRing![k] ?? 0) + n;
  if (view) into.views!.push(view);
  return into;
}

// ---------- clustering ----------

export interface Assigned {
  path: string;
  token: Token;
}

const pxNum = (s: string) => parseFloat(s);
const safeName = (s: string) => s.replace(/-/g, 'neg').replace(/\./g, '_').replace(/px$/, '');

function top<T>(entries: [string, T][], score: (t: T) => number): [string, T][] {
  return [...entries].sort((a, b) => score(b[1]) - score(a[1]) || a[0].localeCompare(b[0]));
}

function ext(count: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { 'io.strata.audit': { count, ...extra } };
}

const EASING_KEYWORDS: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
};

export function parseEasing(s: string): [number, number, number, number] | undefined {
  const t = s.trim();
  if (EASING_KEYWORDS[t]) return EASING_KEYWORDS[t];
  const m = t.match(/^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/);
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

export interface ShadowLayer {
  color: string;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  inset: boolean;
}

export function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

export function parseShadow(s: string): ShadowLayer[] {
  return splitTopLevel(s).map((layer) => {
    const colorMatch = layer.match(/(?:rgba?|hsla?)\([^()]*\)|#[0-9a-f]{3,8}\b/i);
    const color = colorMatch ? colorMatch[0] : 'rgb(0, 0, 0)';
    const rest = layer.replace(color, ' ');
    const nums = (rest.match(/-?[\d.]+px|\b0\b/g) ?? []).map((x) => parseFloat(x));
    return {
      color,
      offsetX: nums[0] ?? 0,
      offsetY: nums[1] ?? 0,
      blur: nums[2] ?? 0,
      spread: nums[3] ?? 0,
      inset: /\binset\b/.test(rest),
    };
  });
}

export interface BuildResult {
  tokens: Group;
  assigned: Record<string, string>;
  missing: string[];
  notes: string[];
}

/** Cluster raw values into DTCG tokens with the names from the M0 brief. */
export function buildTokens(raw: RawValues, extras: { fonts?: unknown; icons?: unknown } = {}): BuildResult {
  const cfg = loadConfig().tokens;
  const root: Group = {};
  const assigned: Record<string, string> = {};
  const missing: string[] = [];
  const notes: string[] = [];
  const put = (path: string, token: Token, rawKey: string) => {
    setPath(root, path, token);
    assigned[path] = rawKey;
  };

  // ----- colours -----
  const colors = Object.entries(raw.colors)
    .map(([k, v]) => ({ key: k, v, c: parseNorm(k) }))
    .filter((x): x is { key: string; v: ColorUsage; c: Rgba } => !!x.c);
  const used = new Map<string, string>(); // colour key -> first path
  const colorToken = (path: string, key: string, desc: string) => {
    const v = raw.colors[key] as ColorUsage;
    put(path, { $type: 'color', $value: toDtcgColor(key), $description: desc, $extensions: ext(v.count, { props: v.props }) }, key);
    if (!used.has(key)) used.set(key, path);
  };
  const opaque = colors.filter((x) => x.c.a === 1);
  const sat = (c: Rgba) => hsl(c).s;
  const bgs = opaque.filter((x) => (x.v.props['background-color'] ?? 0) > 0);
  const baseKey =
    [raw.base.body, raw.base.html].find((k) => k && k !== 'transparent' && parseNorm(k)?.a === 1) ??
    top(
      bgs.map((x) => [x.key, x.v] as [string, ColorUsage]),
      (v) => v.area,
    )[0]?.[0];
  const baseC = baseKey ? (parseNorm(baseKey) as Rgba) : { r: 255, g: 255, b: 255, a: 1 };
  const dark = luminance(baseC) < 0.4;
  if (baseKey) colorToken('color.bg.base', baseKey, 'Page background (body or largest area).');
  else missing.push('color.bg.base');

  const surfaces = bgs
    .filter((x) => x.key !== baseKey && sat(x.c) <= cfg.neutralSaturationMax + 0.05)
    .filter((x) => Math.abs(luminance(x.c) - luminance(baseC)) <= cfg.surfaceLuminanceWindow)
    .filter((x) => (dark ? luminance(x.c) >= luminance(baseC) : luminance(x.c) <= luminance(baseC)))
    .sort((a, b) => b.v.area - a.v.area)
    .slice(0, 3)
    .sort((a, b) => Math.abs(luminance(a.c) - luminance(baseC)) - Math.abs(luminance(b.c) - luminance(baseC)));
  surfaces.forEach((s, i) => colorToken(`color.bg.surface-${i + 1}`, s.key, `Surface level ${i + 1} (the ${i + 1}. nearest background to the base by luminance).`));
  for (let i = surfaces.length; i < 3; i++) missing.push(`color.bg.surface-${i + 1}`);

  const overlay = top(
    colors.filter((x) => x.c.a > 0 && x.c.a < 1 && (x.v.props['background-color'] ?? 0) > 0).map((x) => [x.key, x.v] as [string, ColorUsage]),
    (v) => v.overlay * 1e9 + v.area,
  )[0];
  if (overlay) colorToken('color.bg.overlay', overlay[0], 'Translucent background (overlay or scrim).');
  else missing.push('color.bg.overlay');

  const totalText = colors.reduce((n, x) => n + x.v.textLen, 0) || 1;
  const texts = colors
    .filter((x) => x.v.textLen > 0 && x.c.a > 0 && sat(x.c) <= cfg.neutralSaturationMax && x.v.textLen / totalText >= cfg.minTextShare)
    .map((x) => ({ ...x, contrast: contrast(x.c, baseC) }));
  const primary = [...texts].filter((x) => x.contrast >= 3).sort((a, b) => b.v.textLen - a.v.textLen)[0] ?? [...texts].sort((a, b) => b.v.textLen - a.v.textLen)[0];
  const textAssigned = new Set<string>();
  if (primary) {
    colorToken('color.text.primary', primary.key, 'Text colour with the most characters.');
    textAssigned.add(primary.key);
  } else missing.push('color.text.primary');
  // Lower levels: readable neutral text colours with less contrast to the base than the primary text.
  const readable = texts
    .filter((x) => !textAssigned.has(x.key) && x.contrast >= 1.5 && (!primary || x.contrast < primary.contrast))
    .sort((a, b) => b.contrast - a.contrast);
  const disabledCandidate =
    top(
      colors.filter((x) => x.v.disabledText > 0).map((x) => [x.key, x.v] as [string, ColorUsage]),
      (v) => v.disabledText,
    )[0]?.[0] ?? readable.filter((x) => x.contrast < 3).at(-1)?.key;
  const levels = readable.filter((x) => x.key !== disabledCandidate || readable.length > 3);
  const [secondary, tertiary] = levels;
  if (secondary) {
    colorToken('color.text.secondary', secondary.key, 'Text colour with lower contrast than primary.');
    textAssigned.add(secondary.key);
  } else missing.push('color.text.secondary');
  if (tertiary) {
    colorToken('color.text.tertiary', tertiary.key, 'Text colour with lower contrast than secondary.');
    textAssigned.add(tertiary.key);
  } else missing.push('color.text.tertiary');
  if (disabledCandidate) colorToken('color.text.disabled', disabledCandidate, 'Text colour on disabled controls (or the lowest contrast text).');
  else missing.push('color.text.disabled');
  // Inverse: text with little contrast to the base but high contrast to the primary text (text on accent fills).
  const primaryC = primary?.c;
  const inverse = colors
    .filter((x) => x.v.textLen > 0 && x.c.a === 1 && sat(x.c) <= cfg.neutralSaturationMax && contrast(x.c, baseC) < 2 && (!primaryC || contrast(x.c, primaryC) >= 3))
    .sort((a, b) => b.v.textLen - a.v.textLen)[0];
  if (inverse) colorToken('color.text.inverse', inverse.key, 'Text colour on strong fills: close to the base, far from the primary text.');
  else missing.push('color.text.inverse');

  const borders = colors
    .filter((x) => (x.v.props['border-color'] ?? 0) > 0 && x.c.a > 0 && sat(x.c) <= cfg.neutralSaturationMax + 0.05)
    .map((x) => ({ ...x, n: x.v.props['border-color'] as number, contrast: contrast(x.c, baseC) }));
  const bDefault = [...borders].sort((a, b) => b.n - a.n)[0];
  if (bDefault) {
    colorToken('color.border.default', bDefault.key, 'Most used border colour.');
    const byContrast = [...borders].sort((a, b) => a.contrast - b.contrast);
    const subtle = byContrast.find((x) => x.contrast < bDefault.contrast);
    const strong = [...byContrast].reverse().find((x) => x.contrast > bDefault.contrast);
    if (subtle) colorToken('color.border.subtle', subtle.key, 'Border colour with the lowest contrast to the base.');
    else missing.push('color.border.subtle');
    if (strong) colorToken('color.border.strong', strong.key, 'Border colour with the highest contrast to the base.');
    else missing.push('color.border.strong');
  } else missing.push('color.border.default', 'color.border.subtle', 'color.border.strong');

  const focusKey =
    top(Object.entries(raw.focusRing ?? {}).map(([k, n]) => [k, n] as [string, number]), (n) => n)[0]?.[0] ??
    top(
      colors.filter((x) => (x.v.props['outline-color'] ?? 0) > 0).map((x) => [x.key, x.v] as [string, ColorUsage]),
      (v) => v.props['outline-color'] ?? 0,
    )[0]?.[0];
  if (focusKey && raw.colors[focusKey]) colorToken('color.focus.ring', focusKey, 'Colour of the focus indicator.');
  else if (focusKey) {
    raw.colors[focusKey] = { count: 1, props: { 'focus-ring': 1 }, area: 0, textLen: 0, disabledText: 0, overlay: 0, raw: {}, samples: [] };
    colorToken('color.focus.ring', focusKey, 'Colour of the focus indicator.');
  } else missing.push('color.focus.ring');

  const [lMin, lMax] = cfg.stateLightnessRange;
  const saturated = colors.filter((x) => {
    const h = hsl(x.c);
    return x.c.a > 0.5 && h.s >= cfg.stateSaturationMin && h.l >= lMin && h.l <= lMax;
  });
  for (const [name, ranges] of Object.entries(cfg.hueBuckets)) {
    const inBucket = saturated.filter((x) => {
      const h = hsl(x.c).h;
      return ranges.some(([a, b]) => h >= a && h < b);
    });
    const best = inBucket.sort((a, b) => b.v.count + b.v.textLen / 10 - (a.v.count + a.v.textLen / 10))[0];
    if (best) colorToken(`color.state.${name}`, best.key, `Most used saturated colour in the ${name} hue range.`);
    else missing.push(`color.state.${name}`);
  }
  const neutralKey = secondary?.key ?? tertiary?.key ?? primary?.key;
  if (neutralKey) colorToken('color.state.neutral', neutralKey, 'Guess: the neutral (unchanged) state uses the secondary text colour.');
  else missing.push('color.state.neutral');

  // Every other colour becomes an extra token, so that each value maps to a token.
  for (const x of colors) {
    if (used.has(x.key)) continue;
    colorToken(`color.x-${hex8(x.c).slice(1)}`, x.key, 'Extra colour found in the audit, with no named role.');
  }
  if (raw.colors.transparent && !used.has('transparent')) colorToken('color.transparent', 'transparent', 'Fully transparent.');

  // ----- fonts -----
  const mono = new RegExp(cfg.monoFamilyPattern, 'i');
  const fams = top(Object.entries(raw.fontFamilies), (v) => v.textLen * 1000 + v.count);
  const splitFam = (f: string) => f.split(',').map((x) => x.trim().replace(/^["']|["']$/g, ''));
  const sans = fams.find(([f]) => !mono.test(splitFam(f)[0] ?? ''));
  const monoF = fams.find(([f]) => mono.test(f));
  if (sans) put('font.family.sans', { $type: 'fontFamily', $value: splitFam(sans[0]), $extensions: ext(sans[1].count) }, sans[0]);
  else missing.push('font.family.sans');
  if (monoF) put('font.family.mono', { $type: 'fontFamily', $value: splitFam(monoF[0]), $extensions: ext(monoF[1].count) }, monoF[0]);
  else missing.push('font.family.mono');
  fams
    .filter(([f]) => f !== sans?.[0] && f !== monoF?.[0])
    .forEach(([f, v], i) => put(`font.family.x-${i + 1}`, { $type: 'fontFamily', $value: splitFam(f), $extensions: ext(v.count) }, f));

  const sizes = Object.entries(raw.fontSizes).filter(([k]) => /px$/.test(k));
  const md = top(sizes, (v) => v.textLen * 1000 + v.count)[0];
  const sizeNames: Record<string, string> = {};
  if (md) {
    const mdPx = pxNum(md[0]);
    sizeNames[md[0]] = 'md';
    const smaller = top(
      sizes.filter(([k]) => pxNum(k) < mdPx),
      (v) => v.count,
    )
      .slice(0, 3)
      .sort((a, b) => pxNum(b[0]) - pxNum(a[0]));
    ['sm', 'xs', '2xs'].forEach((n, i) => smaller[i] && (sizeNames[smaller[i][0]] = n));
    const larger = top(
      sizes.filter(([k]) => pxNum(k) > mdPx),
      (v) => v.count,
    )
      .slice(0, 3)
      .sort((a, b) => pxNum(a[0]) - pxNum(b[0]));
    ['lg', 'xl', '2xl'].forEach((n, i) => larger[i] && (sizeNames[larger[i][0]] = n));
  }
  for (const n of ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl']) if (!Object.values(sizeNames).includes(n)) missing.push(`font.size.${n}`);
  for (const [k, v] of sizes) {
    const name = sizeNames[k] ?? `x-${safeName(k)}`;
    put(`font.size.${name}`, { $type: 'dimension', $value: dimension(pxNum(k)), $extensions: ext(v.count) }, k);
  }

  const weightNames: Record<string, string> = { '400': 'regular', '500': 'medium', '600': 'semibold', '700': 'bold' };
  for (const [k, v] of Object.entries(raw.fontWeights)) {
    const n = Number(k);
    put(`font.weight.${weightNames[k] ?? `x-${k}`}`, { $type: 'fontWeight', $value: Number.isFinite(n) ? n : 400, $extensions: ext(v.count) }, k);
  }
  for (const [k, n] of Object.entries(weightNames)) if (!raw.fontWeights[k]) missing.push(`font.weight.${n}`);

  const lhs = Object.entries(raw.lineHeights).filter(([k]) => k !== 'normal');
  const lhNormal = top(lhs, (v) => v.textLen * 1000 + v.count)[0];
  if (lhNormal) {
    const n = Number(lhNormal[0]);
    put('font.line-height.normal', { $type: 'number', $value: n, $extensions: ext(lhNormal[1].count) }, lhNormal[0]);
    const tight = top(
      lhs.filter(([k]) => Number(k) < n),
      (v) => v.count,
    )[0];
    const relaxed = top(
      lhs.filter(([k]) => Number(k) > n),
      (v) => v.count,
    )[0];
    if (tight) put('font.line-height.tight', { $type: 'number', $value: Number(tight[0]), $extensions: ext(tight[1].count) }, tight[0]);
    else missing.push('font.line-height.tight');
    if (relaxed) put('font.line-height.relaxed', { $type: 'number', $value: Number(relaxed[0]), $extensions: ext(relaxed[1].count) }, relaxed[0]);
    else missing.push('font.line-height.relaxed');
    for (const [k, v] of lhs) {
      if ([lhNormal[0], tight?.[0], relaxed?.[0]].includes(k)) continue;
      put(`font.line-height.x-${safeName(k)}`, { $type: 'number', $value: Number(k), $extensions: ext(v.count) }, k);
    }
  } else missing.push('font.line-height.tight', 'font.line-height.normal', 'font.line-height.relaxed');
  if (raw.lineHeights.normal) notes.push(`line-height "normal" is used ${raw.lineHeights.normal.count} times. It depends on the font and has no number token.`);

  const ls = Object.entries(raw.letterSpacings).filter(([k]) => /px$/.test(k));
  const lsNormal = ls.find(([k]) => pxNum(k) === 0) ?? top(ls, (v) => v.count)[0];
  if (lsNormal) {
    put('font.letter-spacing.normal', { $type: 'dimension', $value: dimension(pxNum(lsNormal[0])), $extensions: ext(lsNormal[1].count) }, lsNormal[0]);
    const tight = top(
      ls.filter(([k]) => pxNum(k) < pxNum(lsNormal[0])),
      (v) => v.count,
    )[0];
    const wide = top(
      ls.filter(([k]) => pxNum(k) > pxNum(lsNormal[0])),
      (v) => v.count,
    )[0];
    if (tight) put('font.letter-spacing.tight', { $type: 'dimension', $value: dimension(pxNum(tight[0])), $extensions: ext(tight[1].count) }, tight[0]);
    else missing.push('font.letter-spacing.tight');
    if (wide) put('font.letter-spacing.wide', { $type: 'dimension', $value: dimension(pxNum(wide[0])), $extensions: ext(wide[1].count) }, wide[0]);
    else missing.push('font.letter-spacing.wide');
  } else missing.push('font.letter-spacing.normal');

  // DTCG has no type for font-variant-numeric. Keep it as a group with an extension (see docs/decisions.md).
  const numeric = top(Object.entries(raw.numeric), (v) => v.textLen * 1000 + v.count)[0];
  setPath(root, 'font.numeric', {
    $description: 'font-variant-numeric of numeric text. DTCG has no token type for it, so the value is in $extensions.',
    $extensions: {
      'io.strata.audit': {
        fontVariantNumeric: numeric ? numeric[0] : 'normal',
        observed: Object.fromEntries(Object.entries(raw.numeric).map(([k, v]) => [k, v.count])),
      },
    },
  });
  if (!numeric) notes.push('No font-variant-numeric other than "normal" was observed.');

  // ----- spacing -----
  const spacing = Object.entries(raw.spacing).filter(([k]) => /px$/.test(k));
  // Zero is a multiple of every unit, so it does not count for the choice of the unit.
  const nonZero = spacing.filter(([k]) => pxNum(k) !== 0);
  const totalSpace = nonZero.reduce((n, [, v]) => n + v.count, 0) || 1;
  // The base unit is the largest candidate that divides most spacing values (share at or above spaceUnitMinShare).
  const shares = cfg.spaceUnitCandidates
    .map((u) => ({ u, share: nonZero.filter(([k]) => pxNum(k) % u === 0).reduce((n, [, v]) => n + v.count, 0) / totalSpace }))
    .sort((a, b) => b.u - a.u);
  const unit = shares.find((x) => x.share >= cfg.spaceUnitMinShare)?.u ?? [...shares].sort((a, b) => b.share - a.share)[0]?.u ?? 4;
  const spaceNames: Record<string, string> = {};
  for (const k of cfg.spaceKeys) {
    const key = `${k * unit}px`;
    if (raw.spacing[key]) spaceNames[key] = String(k);
    else missing.push(`space.${k}`);
  }
  for (const [k, v] of spacing) {
    put(`space.${spaceNames[k] ?? `x-${safeName(k)}`}`, { $type: 'dimension', $value: dimension(pxNum(k)), $extensions: ext(v.count, { props: v.props }) }, k);
  }
  setPath(root, 'space.$description', `Spacing scale. The base unit is ${unit}px: space.N = N x ${unit}px. Extra values are named x-<px>.` as never);

  // ----- radii -----
  const radii = Object.entries(raw.radii);
  const radiusNames: Record<string, string> = {};
  const finite = radii.filter(([k]) => /px$/.test(k) && pxNum(k) > 0 && pxNum(k) < 999);
  if (raw.radii['0px']) radiusNames['0px'] = 'none';
  const full = radii.find(([k]) => k === '50%' || (/px$/.test(k) && pxNum(k) >= 999));
  if (full) radiusNames[full[0]] = 'full';
  const rMd = top(finite, (v) => v.count)[0];
  if (rMd) {
    radiusNames[rMd[0]] = 'md';
    const sm = top(
      finite.filter(([k]) => pxNum(k) < pxNum(rMd[0])),
      (v) => v.count,
    )[0];
    const lg = top(
      finite.filter(([k]) => pxNum(k) > pxNum(rMd[0])),
      (v) => v.count,
    )[0];
    if (sm) radiusNames[sm[0]] = 'sm';
    if (lg) radiusNames[lg[0]] = 'lg';
  }
  for (const n of ['none', 'sm', 'md', 'lg', 'full']) if (!Object.values(radiusNames).includes(n)) missing.push(`radius.${n}`);
  for (const [k, v] of radii) {
    const value = k.endsWith('%') ? dimension(9999) : dimension(pxNum(k));
    const desc = k.endsWith('%') ? `Observed as ${k}. Written as 9999px for a pill or circle.` : undefined;
    put(`radius.${radiusNames[k] ?? `x-${safeName(k.replace('%', 'pct'))}`}`, { $type: 'dimension', $value: value, ...(desc ? { $description: desc } : {}), $extensions: ext(v.count) }, k);
  }

  // ----- shadows -----
  const shadows = Object.entries(raw.shadows)
    .map(([k, v]) => ({ k, v, layers: parseShadow(k) }))
    .filter((s) => s.layers.length)
    .sort((a, b) => Math.max(...a.layers.map((l) => l.blur)) - Math.max(...b.layers.map((l) => l.blur)));
  const shadowNames: string[] = shadows.length >= 3 ? ['sm', 'md', 'lg'] : shadows.length === 2 ? ['sm', 'md'] : ['md'];
  const pickIdx = shadows.length >= 3 ? [0, Math.floor(shadows.length / 2), shadows.length - 1] : shadows.map((_, i) => i);
  shadows.forEach((s, i) => {
    const slot = pickIdx.indexOf(i);
    const name = slot >= 0 ? shadowNames[slot] : `x-${i + 1}`;
    const layers = s.layers.map((l) => ({
      color: toDtcgColor(parseNorm(l.color) ? l.color : 'rgb(0, 0, 0)'),
      offsetX: dimension(l.offsetX),
      offsetY: dimension(l.offsetY),
      blur: dimension(l.blur),
      spread: dimension(l.spread),
      ...(l.inset ? { inset: true } : {}),
    }));
    put(`shadow.${name}`, { $type: 'shadow', $value: layers.length === 1 ? layers[0] : layers, $extensions: ext(s.v.count, { css: s.k }) }, s.k);
  });
  for (const n of ['sm', 'md', 'lg']) if (!shadows.length || !shadowNames.includes(n)) missing.push(`shadow.${n}`);

  // ----- z-index -----
  const zs = Object.entries(raw.zIndex)
    .map(([k, v]) => ({ z: Number(k), v }))
    .filter((x) => Number.isFinite(x.z));
  const zNames: Record<string, number> = {};
  if (zs.length) zNames.base = Math.min(...zs.map((x) => x.z));
  for (const kind of ['panel', 'sticky', 'dropdown', 'drawer', 'modal', 'toast', 'tooltip']) {
    const best = zs.filter((x) => (x.v.kinds[kind] ?? 0) > 0).sort((a, b) => (b.v.kinds[kind] ?? 0) - (a.v.kinds[kind] ?? 0))[0];
    if (best) zNames[kind] = best.z;
  }
  for (const n of ['base', 'panel', 'sticky', 'dropdown', 'drawer', 'modal', 'toast', 'tooltip']) {
    if (zNames[n] === undefined) missing.push(`z.${n}`);
    else put(`z.${n}`, { $type: 'number', $value: zNames[n], $extensions: ext(raw.zIndex[String(zNames[n])]?.count ?? 0) }, String(zNames[n]));
  }
  const namedZ = new Set(Object.values(zNames));
  for (const x of zs) if (!namedZ.has(x.z)) put(`z.x-${safeName(String(x.z))}`, { $type: 'number', $value: x.z, $extensions: ext(x.v.count, { kinds: x.v.kinds }) }, String(x.z));

  // ----- motion -----
  const durs = Object.entries(raw.durations)
    .map(([k, v]) => ({ ms: Number(k), v }))
    .sort((a, b) => a.ms - b.ms);
  if (durs.length) {
    const fast = durs[0];
    const slow = durs.length >= 3 ? durs[durs.length - 1] : undefined;
    const middle = durs.filter((d) => d !== fast && d !== slow);
    const normal = durs.length === 1 ? durs[0] : middle.sort((a, b) => b.v.count - a.v.count)[0];
    const names: [string, typeof fast | undefined][] = durs.length === 1 ? [['normal', normal]] : [['fast', fast], ['normal', normal], ['slow', slow]];
    const named = new Set<number>();
    for (const [n, d] of names) {
      if (!d) {
        missing.push(`motion.duration.${n}`);
        continue;
      }
      named.add(d.ms);
      put(`motion.duration.${n}`, { $type: 'duration', $value: { value: d.ms, unit: 'ms' }, $extensions: ext(d.v.count) }, String(d.ms));
    }
    if (durs.length === 1) missing.push('motion.duration.fast', 'motion.duration.slow');
    for (const d of durs) if (!named.has(d.ms)) put(`motion.duration.x-${d.ms}`, { $type: 'duration', $value: { value: d.ms, unit: 'ms' }, $extensions: ext(d.v.count) }, String(d.ms));
  } else missing.push('motion.duration.fast', 'motion.duration.normal', 'motion.duration.slow');
  const eases = top(Object.entries(raw.easings), (v) => v.count)
    .map(([k, v]) => ({ k, v, curve: parseEasing(k) }))
    .filter((e) => e.curve);
  const std = eases[0];
  const emph = eases.find((e) => e.curve!.join() !== std?.curve!.join());
  if (std) put('motion.easing.standard', { $type: 'cubicBezier', $value: std.curve, $extensions: ext(std.v.count, { css: std.k }) }, std.k);
  else missing.push('motion.easing.standard');
  if (emph) put('motion.easing.emphasized', { $type: 'cubicBezier', $value: emph.curve, $extensions: ext(emph.v.count, { css: emph.k }) }, emph.k);
  else missing.push('motion.easing.emphasized');
  eases
    .filter((e) => e !== std && e !== emph)
    .forEach((e, i) => put(`motion.easing.x-${i + 1}`, { $type: 'cubicBezier', $value: e.curve, $extensions: ext(e.v.count, { css: e.k }) }, e.k));
  const steps = Object.keys(raw.easings).filter((k) => !parseEasing(k));
  if (steps.length) notes.push(`Easing values with no cubic-bezier form: ${steps.join(', ')}`);

  (root as Record<string, unknown>).$description =
    'Design tokens of Infora from the Strata M0 audit. Names follow the Strata token plan. Values come from computed styles.';
  (root as Record<string, unknown>).$extensions = {
    'io.strata.audit': {
      format: 'DTCG 2025.10',
      views: raw.views ?? [],
      theme: dark ? 'dark' : 'light',
      missingNamedTokens: missing,
      notes,
      fonts: extras.fonts ?? null,
      icons: extras.icons ?? null,
      rootCustomProperties: raw.rootVars,
    },
  };
  return { tokens: root, assigned, missing, notes };
}

// ---------- fonts and icons ----------

export interface FontsIcons {
  faces: { family: string; weight: string; style: string; status: string }[];
  fontFaceRules: { family: string; weight: string; style: string; urls: string[]; sheet: string }[];
  licenceComments: string[];
  icons: {
    useHrefs: Record<string, number>;
    symbolIds: string[];
    classPrefixes: Record<string, number>;
    svgSignatures: Record<string, number>;
    iconFontElements: number;
    examples: string[];
  };
}

export async function collectFontsIcons(page: Page): Promise<FontsIcons> {
  return inPage<FontsIcons>(page, 'fonts-icons', { iconPrefixes: loadConfig().tokens.iconPrefixes });
}

export function summariseFonts(all: FontsIcons[], guard: NetworkGuard): Record<string, unknown>[] {
  const files = new Map<string, Record<string, unknown>>();
  for (const f of all) {
    for (const r of f.fontFaceRules) {
      for (const url of r.urls) {
        if (files.has(url)) continue;
        files.set(url, { family: r.family, weight: r.weight, style: r.style, url, licence: licenceGuess(url, f.licenceComments, guard) });
      }
    }
  }
  for (const [url, info] of guard.fontFiles) {
    const match = [...files.keys()].find((u) => u.split('?')[0] === url.split('?')[0]);
    if (match) continue;
    files.set(url, { family: '(from network)', url, licence: licenceGuess(url, [], guard, info.headers) });
  }
  return [...files.values()];
}

function licenceGuess(url: string, comments: string[], guard: NetworkGuard, headers?: Record<string, string>): string {
  const h = headers ?? guard.fontFiles.get(url)?.headers ?? {};
  const header = Object.entries(h).find(([k]) => /licen[cs]e/i.test(k));
  if (header) return `header ${header[0]}: ${header[1]}`;
  const file = url.split('/').pop() ?? '';
  if (/ofl/i.test(file)) return 'file name shows OFL';
  if (/apache/i.test(file)) return 'file name shows Apache';
  if (/fonts\.gstatic\.com|fonts\.googleapis\.com/.test(url)) return 'Google Fonts host. Google Fonts are under SIL OFL 1.1, Apache 2.0 or UFL. Confirm the family licence';
  if (/use\.typekit\.net|p\.typekit\.net/.test(url)) return 'Adobe Fonts host. Licence is a subscription licence. Confirm with Mohamed';
  const comment = comments.find((c) => /licen[cs]e|ofl/i.test(c));
  if (comment) return `CSS comment: ${comment.slice(0, 120)}`;
  for (const body of guard.styleBodies.values()) {
    const m = body.match(/\/\*[^*]{0,400}?(licen[cs]ed? under[^*]{0,120}|SIL Open Font License[^*]{0,40})/i);
    if (m && body.includes(file)) return `CSS comment: ${m[1]?.slice(0, 120)}`;
  }
  return 'unknown: no licence shown in headers, file name or CSS';
}

export function summariseIcons(all: FontsIcons[]): Record<string, unknown> {
  const prefixes: Record<string, number> = {};
  const hrefs: Record<string, number> = {};
  const sigs: Record<string, number> = {};
  const examples = new Set<string>();
  const symbols = new Set<string>();
  let iconFont = 0;
  for (const f of all) {
    for (const [k, n] of Object.entries(f.icons.classPrefixes)) prefixes[k] = (prefixes[k] ?? 0) + n;
    for (const [k, n] of Object.entries(f.icons.useHrefs)) hrefs[k] = (hrefs[k] ?? 0) + n;
    for (const [k, n] of Object.entries(f.icons.svgSignatures)) sigs[k] = (sigs[k] ?? 0) + n;
    f.icons.examples.forEach((e) => examples.add(e));
    f.icons.symbolIds.forEach((e) => symbols.add(e));
    iconFont += f.icons.iconFontElements;
  }
  const topPrefix = Object.entries(prefixes).sort((a, b) => b[1] - a[1])[0];
  const topSig = Object.entries(sigs).sort((a, b) => b[1] - a[1])[0];
  let guess = 'unknown';
  if (topPrefix) guess = `class prefix "${topPrefix[0]}" (${topPrefix[1]} elements)`;
  else if (Object.keys(hrefs).length) guess = `SVG sprite: ${Object.keys(hrefs)[0]}`;
  else if (topSig && /^0 0 24 24 none currentColor 2 round$/.test(topSig[0])) guess = 'inline SVG with the Lucide or Feather attribute pattern (24x24, stroke 2, round caps). This is a guess';
  else if (topSig) guess = `inline SVG, most common attributes "${topSig[0]}" (viewBox fill stroke stroke-width linecap)`;
  if (iconFont > 0 && guess === 'unknown') guess = 'icon font';
  return { guess, classPrefixes: prefixes, spriteHrefs: hrefs, svgSignatures: sigs, examples: [...examples], symbolIds: [...symbols].slice(0, 30), iconFontElements: iconFont };
}

export function writeTokens(out: Output, raw: RawValues, fonts: Record<string, unknown>[], icons: Record<string, unknown>): BuildResult {
  out.writeJson('raw-values.json', raw);
  const built = buildTokens(raw, { fonts, icons });
  out.writeJson('tokens.json', built.tokens);
  const lines = ['# Token extraction notes', '', `Views: ${(raw.views ?? []).join(', ')}`, ''];
  lines.push('## Named tokens', '', mdTable(['Token', 'Raw value'], Object.entries(built.assigned).filter(([p]) => !/\.x-/.test(p)).map(([p, v]) => [p, v])));
  lines.push('## Named tokens with no observed value', '', built.missing.length ? built.missing.map((m) => `- ${m}`).join('\n') : 'None.', '');
  lines.push('## Fonts', '', mdTable(['Family', 'URL', 'Licence'], fonts.map((f) => [f.family, f.url, f.licence])));
  lines.push('## Icon set', '', `- Guess: ${String(icons.guess)}`, '');
  if (built.notes.length) lines.push('## Notes', '', ...built.notes.map((n) => `- ${n}`), '');
  out.writeText('tokens.md', lines.join('\n'));
  return built;
}
