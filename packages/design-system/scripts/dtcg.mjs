// Helpers for W3C Design Tokens (DTCG) files: validation, flattening, alias resolution and CSS output.
// The helpers accept the DTCG 2025.10 object values and the older string values.

export const DTCG_TYPES = new Set([
  "color",
  "dimension",
  "fontFamily",
  "fontWeight",
  "duration",
  "cubicBezier",
  "number",
  "strokeStyle",
  "border",
  "transition",
  "shadow",
  "gradient",
  "typography",
]);

const RESERVED = new Set(["$value", "$type", "$description", "$extensions", "$deprecated", "$schema", "$root", "$extends"]);
const ALIAS = /^\{([^{}]+)\}$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Return the alias path of a value such as "{color.bg.base}", or null. */
export function aliasOf(value) {
  if (typeof value !== "string") return null;
  const m = ALIAS.exec(value);
  return m ? m[1] : null;
}

/**
 * Flatten a token tree. Each token gets its path, its type (inherited from the groups) and its value.
 * @returns {{ path: string, type: string | undefined, value: unknown, description?: string, extensions?: unknown }[]}
 */
export function flatten(tree) {
  const out = [];
  const walk = (node, path, inheritedType) => {
    const type = typeof node.$type === "string" ? node.$type : inheritedType;
    if ("$value" in node) {
      out.push({ path: path.join("."), type, value: node.$value, description: node.$description, extensions: node.$extensions });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      if (isObject(child)) walk(child, [...path, key], type);
    }
  };
  walk(tree, [], undefined);
  return out;
}

function checkValue(type, value, where, errors) {
  if (aliasOf(value)) return;
  const fail = (msg) => errors.push(`${where}: ${msg}`);
  switch (type) {
    case "color":
      if (typeof value === "string") return;
      if (!isObject(value) || typeof value.colorSpace !== "string" || !Array.isArray(value.components)) {
        fail("color needs {colorSpace, components} or a colour string");
      }
      return;
    case "dimension":
      if (typeof value === "string" ? !/^-?(\d+\.?\d*|\.\d+)(px|rem)$/.test(value) : !(isObject(value) && typeof value.value === "number" && ["px", "rem"].includes(value.unit))) {
        fail("dimension needs {value, unit: px|rem}");
      }
      return;
    case "duration":
      if (typeof value === "string" ? !/^(\d+\.?\d*|\.\d+)(ms|s)$/.test(value) : !(isObject(value) && typeof value.value === "number" && ["ms", "s"].includes(value.unit))) {
        fail("duration needs {value, unit: ms|s}");
      }
      return;
    case "cubicBezier":
      if (!Array.isArray(value) || value.length !== 4 || value.some((n) => typeof n !== "number")) fail("cubicBezier needs four numbers");
      return;
    case "number":
      if (typeof value !== "number") fail("number needs a number");
      return;
    case "fontWeight":
      if (typeof value !== "number" && typeof value !== "string") fail("fontWeight needs a number or a keyword");
      return;
    case "fontFamily":
      if (typeof value !== "string" && !(Array.isArray(value) && value.every((s) => typeof s === "string"))) fail("fontFamily needs a string or a list of strings");
      return;
    case "shadow": {
      const list = Array.isArray(value) ? value : [value];
      for (const s of list) {
        if (!isObject(s) || !("offsetX" in s) || !("offsetY" in s) || !("blur" in s) || !("color" in s)) fail("shadow needs {color, offsetX, offsetY, blur, spread}");
      }
      return;
    }
    default:
      return;
  }
}

/**
 * Validate a DTCG token tree.
 * @param {unknown} tree
 * @param {{ external?: Map<string, unknown> }} [options] external: tokens from other files that aliases can refer to
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validate(tree, options = {}) {
  const errors = [];
  const warnings = [];
  if (!isObject(tree)) return { errors: ["the root must be a JSON object"], warnings };

  const walk = (node, path) => {
    const where = path.join(".") || "(root)";
    for (const key of Object.keys(node)) {
      if (key.startsWith("$")) {
        if (!RESERVED.has(key)) errors.push(`${where}: unknown reserved property ${key}`);
        continue;
      }
      if (/[{}.]/.test(key)) errors.push(`${where}: the name "${key}" contains a reserved character`);
      if (!isObject(node[key])) errors.push(`${[...path, key].join(".")}: a token or group must be an object`);
    }
    if (node.$type !== undefined && !DTCG_TYPES.has(node.$type)) errors.push(`${where}: unknown $type ${node.$type}`);
    if ("$value" in node) {
      const children = Object.keys(node).filter((k) => !k.startsWith("$"));
      if (children.length) errors.push(`${where}: a token cannot contain child tokens`);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (!key.startsWith("$") && isObject(child)) walk(child, [...path, key]);
    }
  };
  walk(tree, []);

  const flat = flatten(tree);
  const known = new Map(options.external ?? []);
  for (const t of flat) known.set(t.path, t);
  for (const t of flat) {
    const target = aliasOf(t.value);
    if (target && !known.has(target)) errors.push(`${t.path}: the alias {${target}} does not resolve`);
    if (t.type === undefined && !target) warnings.push(`${t.path}: no $type. The value is used as a plain string`);
    if (t.type) checkValue(t.type, t.value, t.path, errors);
    if (t.type === "shadow") {
      for (const s of Array.isArray(t.value) ? t.value : [t.value]) {
        if (isObject(s) && aliasOf(s.color) && !known.has(aliasOf(s.color))) errors.push(`${t.path}: the alias ${s.color} does not resolve`);
      }
    }
  }
  return { errors, warnings };
}

/** The CSS custom property name for a token path. */
export const cssVarName = (path) => `--${path.replace(/\./g, "-")}`;

const round = (n) => Math.round(n * 1000) / 1000;

function colorToCss(value) {
  if (typeof value === "string") return value;
  const alpha = value.alpha ?? 1;
  if (alpha === 1 && typeof value.hex === "string") return value.hex;
  if (value.colorSpace === "srgb") {
    const [r, g, b] = value.components.map((c) => Math.round(c * 255));
    return alpha === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${round(alpha)})`;
  }
  const comps = value.components.join(" ");
  return alpha === 1 ? `color(${value.colorSpace} ${comps})` : `color(${value.colorSpace} ${comps} / ${round(alpha)})`;
}

const unitToCss = (value) => (typeof value === "string" ? value : `${value.value}${value.unit}`);

/**
 * Convert a token value to CSS text.
 * @param {string | undefined} type
 * @param {unknown} value
 * @param {(path: string) => string} ref returns the CSS for an alias
 */
export function valueToCss(type, value, ref) {
  const target = aliasOf(value);
  if (target) return ref(target);
  switch (type) {
    case "color":
      return colorToCss(value);
    case "dimension":
    case "duration":
      return unitToCss(value);
    case "cubicBezier":
      return `cubic-bezier(${value.join(", ")})`;
    case "fontFamily":
      return (Array.isArray(value) ? value : [value])
        .map((f) => (/^[\w-]+$/.test(f) ? f : `"${f}"`))
        .join(", ");
    case "shadow":
      return (Array.isArray(value) ? value : [value])
        .map((s) =>
          [
            s.inset ? "inset" : "",
            valueToCss("dimension", s.offsetX, ref),
            valueToCss("dimension", s.offsetY, ref),
            valueToCss("dimension", s.blur, ref),
            valueToCss("dimension", s.spread ?? "0px", ref),
            valueToCss("color", s.color, ref),
          ]
            .filter(Boolean)
            .join(" "),
        )
        .join(", ");
    default:
      return String(value);
  }
}
