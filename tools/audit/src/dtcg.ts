// W3C Design Tokens Community Group format (2025.10 stable), writer helpers and a validator.

export type TokenType =
  | 'color'
  | 'dimension'
  | 'fontFamily'
  | 'fontWeight'
  | 'duration'
  | 'cubicBezier'
  | 'number'
  | 'strokeStyle'
  | 'border'
  | 'transition'
  | 'shadow'
  | 'gradient'
  | 'typography';

export const TOKEN_TYPES: TokenType[] = ['color', 'dimension', 'fontFamily', 'fontWeight', 'duration', 'cubicBezier', 'number', 'strokeStyle', 'border', 'transition', 'shadow', 'gradient', 'typography'];

export interface Token {
  $value: unknown;
  $type?: TokenType;
  $description?: string;
  $extensions?: Record<string, unknown>;
}

export type Group = { [key: string]: Group | Token | unknown };

const GROUP_PROPS = new Set(['$type', '$description', '$extensions', '$deprecated', '$root', '$extends', '$schema']);

export function isToken(v: unknown): v is Token {
  return !!v && typeof v === 'object' && !Array.isArray(v) && '$value' in (v as object);
}

export function setPath(root: Group, path: string, value: Group | Token): void {
  const parts = path.split('.');
  let node = root;
  for (const p of parts.slice(0, -1)) {
    if (!node[p] || typeof node[p] !== 'object') node[p] = {};
    node = node[p] as Group;
  }
  node[parts[parts.length - 1] as string] = value;
}

export function getPath(root: Group, path: string): unknown {
  let node: unknown = root;
  for (const p of path.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[p];
  }
  return node;
}

/** Visit each token with its dotted path and resolved type. */
export function walkTokens(root: Group, fn: (path: string, token: Token, type: string | undefined) => void): void {
  const visit = (node: Group, path: string[], inherited: string | undefined) => {
    const groupType = typeof node.$type === 'string' ? (node.$type as string) : inherited;
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$')) continue;
      if (isToken(v)) fn([...path, k].join('.'), v, v.$type ?? groupType);
      else if (v && typeof v === 'object' && !Array.isArray(v)) visit(v as Group, [...path, k], groupType);
    }
  };
  visit(root, [], undefined);
}

export function dimension(px: number): { value: number; unit: 'px' } {
  return { value: Math.round(px * 100) / 100, unit: 'px' };
}

/** "12px" or {value, unit}. Returns the pixel value in normal form "12px", with rem at 16px. */
export function dimensionToPx(v: unknown): string | undefined {
  let n: number | undefined;
  if (v && typeof v === 'object' && 'value' in (v as object)) {
    const o = v as { value: number; unit: string };
    n = o.unit === 'rem' ? o.value * 16 : o.unit === 'px' ? o.value : undefined;
  } else if (typeof v === 'string') {
    const m = v.match(/^(-?[\d.]+)(px|rem)$/);
    if (m) n = m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]);
  } else if (typeof v === 'number' && v === 0) n = 0;
  if (n === undefined || Number.isNaN(n)) return undefined;
  const r = Math.round(n * 100) / 100;
  return `${Object.is(r, -0) ? 0 : r}px`;
}

function isAlias(v: unknown): v is string {
  return typeof v === 'string' && /^\{[^{}]+\}$/.test(v);
}

function checkValue(type: string, v: unknown, root: Group, errors: string[], where: string): void {
  if (isAlias(v)) {
    const target = getPath(root, v.slice(1, -1));
    if (!isToken(target)) errors.push(`${where}: alias ${v} does not resolve to a token`);
    return;
  }
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  const dim = (x: unknown) =>
    isAlias(x) ||
    (!!x && typeof x === 'object' && num((x as { value: unknown }).value) && ['px', 'rem'].includes((x as { unit: string }).unit));
  const color = (x: unknown) => {
    if (isAlias(x)) return true;
    if (!x || typeof x !== 'object') return false;
    const o = x as { colorSpace?: unknown; components?: unknown; alpha?: unknown; hex?: unknown };
    if (typeof o.colorSpace !== 'string') return false;
    if (!Array.isArray(o.components) || o.components.length !== 3) return false;
    if (o.colorSpace === 'srgb' && !o.components.every((c) => c === 'none' || (num(c) && (c as number) >= 0 && (c as number) <= 1))) return false;
    if (o.alpha !== undefined && !(num(o.alpha) && (o.alpha as number) >= 0 && (o.alpha as number) <= 1)) return false;
    if (o.hex !== undefined && !(typeof o.hex === 'string' && /^#[0-9a-f]{6}$/i.test(o.hex))) return false;
    return true;
  };
  const shadowLayer = (x: unknown) => {
    if (!x || typeof x !== 'object') return false;
    const o = x as Record<string, unknown>;
    return color(o.color) && dim(o.offsetX) && dim(o.offsetY) && dim(o.blur) && dim(o.spread) && (o.inset === undefined || typeof o.inset === 'boolean');
  };
  let ok = true;
  switch (type) {
    case 'color':
      ok = color(v);
      break;
    case 'dimension':
      ok = dim(v);
      break;
    case 'fontFamily':
      ok = (typeof v === 'string' && v.length > 0) || (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string'));
      break;
    case 'fontWeight':
      ok =
        (num(v) && (v as number) >= 1 && (v as number) <= 1000) ||
        (typeof v === 'string' && /^(thin|hairline|extra-light|ultra-light|light|normal|regular|book|medium|semi-bold|demi-bold|bold|extra-bold|ultra-bold|black|heavy|extra-black|ultra-black)$/.test(v));
      break;
    case 'duration':
      ok = !!v && typeof v === 'object' && num((v as { value: unknown }).value) && ['ms', 's'].includes((v as { unit: string }).unit);
      break;
    case 'cubicBezier':
      ok =
        Array.isArray(v) &&
        v.length === 4 &&
        v.every(num) &&
        (v[0] as number) >= 0 &&
        (v[0] as number) <= 1 &&
        (v[2] as number) >= 0 &&
        (v[2] as number) <= 1;
      break;
    case 'number':
      ok = num(v);
      break;
    case 'shadow':
      ok = Array.isArray(v) ? v.length > 0 && v.every(shadowLayer) : shadowLayer(v);
      break;
    default:
      // Composite types other than shadow are not written by this tool. Accept an object.
      ok = !!v && typeof v === 'object';
  }
  if (!ok) errors.push(`${where}: value is not a valid ${type}`);
}

/** Validate a token file. Returns a list of errors. An empty list means the file is valid. */
export function validateDtcg(doc: unknown): string[] {
  const errors: string[] = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return ['root: the file must be a JSON object'];
  const root = doc as Group;
  let tokenCount = 0;
  const visit = (node: Group, path: string[], inherited: string | undefined) => {
    const where = path.join('.') || 'root';
    if (node.$type !== undefined && !TOKEN_TYPES.includes(node.$type as TokenType)) errors.push(`${where}: unknown group $type ${String(node.$type)}`);
    if (node.$description !== undefined && typeof node.$description !== 'string') errors.push(`${where}: $description must be a string`);
    if (node.$extensions !== undefined && (typeof node.$extensions !== 'object' || Array.isArray(node.$extensions))) errors.push(`${where}: $extensions must be an object`);
    const groupType = typeof node.$type === 'string' ? (node.$type as string) : inherited;
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$')) {
        if (!GROUP_PROPS.has(k)) errors.push(`${where}: unknown group property ${k}`);
        continue;
      }
      const p = [...path, k];
      const w = p.join('.');
      if (/[{}.]/.test(k)) errors.push(`${w}: a name must not contain "{", "}" or "."`);
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        errors.push(`${w}: must be a token or a group`);
        continue;
      }
      if (isToken(v)) {
        tokenCount++;
        for (const tk of Object.keys(v)) {
          if (tk.startsWith('$') && !['$value', '$type', '$description', '$extensions', '$deprecated'].includes(tk)) errors.push(`${w}: unknown token property ${tk}`);
          if (!tk.startsWith('$')) errors.push(`${w}: a token must not have child ${tk}`);
        }
        const type = v.$type ?? groupType;
        if (!type) {
          errors.push(`${w}: token has no $type and no inherited type`);
          continue;
        }
        if (!TOKEN_TYPES.includes(type as TokenType)) {
          errors.push(`${w}: unknown $type ${type}`);
          continue;
        }
        if (v.$description !== undefined && typeof v.$description !== 'string') errors.push(`${w}: $description must be a string`);
        if (v.$extensions !== undefined && (typeof v.$extensions !== 'object' || Array.isArray(v.$extensions))) errors.push(`${w}: $extensions must be an object`);
        checkValue(type, v.$value, root, errors, w);
      } else visit(v as Group, p, groupType);
    }
  };
  visit(root, [], undefined);
  if (tokenCount === 0) errors.push('root: the file has no tokens');
  return errors;
}
