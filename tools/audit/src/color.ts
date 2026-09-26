// Colour helpers. The normal form is "rgb(r, g, b)", "rgba(r, g, b, a)" or "transparent",
// the same form that inpage/collect-styles.js gives.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseNorm(norm: string): Rgba | undefined {
  if (norm === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const m = norm.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
  const h = norm.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (h) {
    const n = parseInt(h[1] as string, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: h[2] ? Math.round((parseInt(h[2], 16) / 255) * 1000) / 1000 : 1 };
  }
  return undefined;
}

export function toNorm(c: Rgba): string {
  const r = Math.round(c.r);
  const g = Math.round(c.g);
  const b = Math.round(c.b);
  const a = Math.round(c.a * 1000) / 1000;
  if (a <= 0) return 'transparent';
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Normalise any rgb()/rgba()/hex string to the normal form. */
export function normalizeColor(s: string): string | undefined {
  const t = s.trim().toLowerCase();
  if (t === 'transparent') return 'transparent';
  const m = t.match(/^rgba?\(\s*(-?[\d.]+)[,\s]+(-?[\d.]+)[,\s]+(-?[\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : Number(m[4]);
    return toNorm({ r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a });
  }
  const h = t.match(/^#([0-9a-f]{3,8})$/);
  if (h) {
    let hex = h[1] as string;
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((x) => x + x).join('');
    const p = parseNorm(`#${hex.slice(0, 6)}${hex.length === 8 ? hex.slice(6) : ''}`);
    return p ? toNorm(p) : undefined;
  }
  return undefined;
}

export function hex(c: Rgba): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

export function hex8(c: Rgba): string {
  const a = Math.round(c.a * 255);
  return a >= 255 ? hex(c) : `${hex(c)}${a.toString(16).padStart(2, '0')}`;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. */
export function luminance(c: Rgba): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function hsl(c: Rgba): { h: number; s: number; l: number } {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/** A DTCG 2025.10 colour value. */
export interface DtcgColor {
  colorSpace: 'srgb';
  components: [number, number, number];
  alpha: number;
  hex: string;
}

export function toDtcgColor(norm: string): DtcgColor {
  const c = parseNorm(norm);
  if (!c) throw new Error(`Not a normalised colour: ${norm}`);
  const r4 = (n: number) => Math.round((n / 255) * 10000) / 10000;
  return { colorSpace: 'srgb', components: [r4(c.r), r4(c.g), r4(c.b)], alpha: c.a, hex: hex(c) };
}

export function fromDtcgColor(v: unknown): string | undefined {
  if (typeof v === 'string') return normalizeColor(v);
  if (!v || typeof v !== 'object') return undefined;
  const o = v as { colorSpace?: string; components?: unknown[]; alpha?: number; hex?: string };
  if (o.colorSpace === 'srgb' && Array.isArray(o.components) && o.components.length === 3) {
    const [r, g, b] = o.components.map((x) => Math.round(Number(x) * 255));
    return toNorm({ r: r as number, g: g as number, b: b as number, a: o.alpha ?? 1 });
  }
  if (o.hex) return normalizeColor(o.hex);
  return undefined;
}
