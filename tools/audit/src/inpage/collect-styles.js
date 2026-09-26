// Collect computed style values from every element of the current view.
// tokens.ts and check-tokens.ts both use this collector, so that both see the same values.
// Rules (recorded in tools/audit/README.md):
//  - Elements without a box (display: none) are skipped for colour, font and spacing values.
//  - "color" and font values count only for elements with their own text or for form controls.
//  - Border and outline colours count only when the border or outline is drawn.
//  - fill and stroke count only for SVG shape elements.
//  - ::before and ::after count for colours when they have content.
//  - Spacing values larger than spacingMaxPx are layout results (for example margin: auto) and are skipped.
//  - An element in a running colour transition or animation is skipped for colours.
function (arg) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const colorCache = new Map();
  function normColor(s) {
    if (!s) return null;
    s = String(s).trim();
    if (colorCache.has(s)) return colorCache.get(s);
    let out = null;
    if (s === 'transparent') out = 'transparent';
    else if (s === 'none' || s.indexOf('url(') === 0 || s === 'auto' || s === 'currentcolor') out = null;
    else {
      let r, g, b, a;
      const m = s.match(/^rgba?\(\s*(-?[\d.]+)[,\s]+(-?[\d.]+)[,\s]+(-?[\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
      if (m) {
        r = +m[1]; g = +m[2]; b = +m[3];
        a = m[4] === undefined ? 1 : (m[4].slice(-1) === '%' ? parseFloat(m[4]) / 100 : +m[4]);
      } else {
        ctx.fillStyle = '#010203';
        ctx.fillStyle = s;
        if (ctx.fillStyle === '#010203' && !/^#010203/i.test(s)) {
          colorCache.set(s, null);
          return null;
        }
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        r = d[0]; g = d[1]; b = d[2]; a = d[3] / 255;
      }
      r = Math.max(0, Math.min(255, Math.round(r)));
      g = Math.max(0, Math.min(255, Math.round(g)));
      b = Math.max(0, Math.min(255, Math.round(b)));
      a = Math.round(a * 1000) / 1000;
      if (a <= 0) out = 'transparent';
      else out = a >= 1 ? 'rgb(' + r + ', ' + g + ', ' + b + ')' : 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
    }
    colorCache.set(s, out);
    return out;
  }
  function px(v) {
    if (v === null || v === undefined) return null;
    const m = String(v).trim().match(/^(-?[\d.]+(?:e-?\d+)?)px$/);
    if (!m) return null;
    const n = Math.round(parseFloat(m[1]) * 100) / 100;
    return (Object.is(n, -0) ? 0 : n) + 'px';
  }
  const COLOR_PROP = /color|background|border|outline|fill|stroke|shadow|^all$/i;
  const COLOR_FN = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|#[0-9a-fA-F]{3,8}\b/g;
  function splitTop(s) {
    const parts = [];
    let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur.trim());
    return parts;
  }
  function durationsMs(v) {
    return String(v || '').split(',').map(function (x) {
      x = x.trim();
      if (x.slice(-2) === 'ms') return parseFloat(x);
      if (x.slice(-1) === 's') return parseFloat(x) * 1000;
      return 0;
    });
  }

  const R = {
    colors: {}, fontFamilies: {}, fontSizes: {}, fontWeights: {}, lineHeights: {}, letterSpacings: {}, numeric: {},
    spacing: {}, radii: {}, shadows: {}, zIndex: {}, durations: {}, easings: {}, rootVars: {}, base: {}, elementCount: 0
  };
  const vw = window.innerWidth, vh = window.innerHeight;
  const spacingMax = arg.spacingMaxPx || 200;
  function addColor(value, prop, el, extra) {
    const n = normColor(value);
    if (!n) return;
    let c = R.colors[n];
    if (!c) c = R.colors[n] = { count: 0, props: {}, area: 0, textLen: 0, disabledText: 0, overlay: 0, raw: {}, samples: [] };
    c.count++;
    c.props[prop] = (c.props[prop] || 0) + 1;
    if (value !== n && Object.keys(c.raw).length < 5) c.raw[value] = (c.raw[value] || 0) + 1;
    if (extra) {
      if (extra.area) c.area += extra.area;
      if (extra.textLen) c.textLen += extra.textLen;
      if (extra.disabled) c.disabledText++;
      if (extra.overlay) c.overlay++;
    }
    if (c.samples.length < 3 && el) c.samples.push(describe(el) + ' ' + prop);
  }
  function bump(map, key, extra) {
    if (key === null || key === undefined) return;
    let e = map[key];
    if (!e) e = map[key] = { count: 0, textLen: 0, props: {} };
    e.count++;
    if (extra && extra.textLen) e.textLen += extra.textLen;
    if (extra && extra.prop) e.props[extra.prop] = (e.props[extra.prop] || 0) + 1;
  }
  function describe(el) {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = el.getAttribute('class');
    if (cls) s += '.' + cls.trim().split(/\s+/).slice(0, 2).join('.');
    return s.slice(0, 80);
  }
  function zKind(el, cs) {
    const role = el.getAttribute('role') || '';
    const cls = (el.getAttribute('class') || '').toLowerCase();
    if (role === 'tooltip' || cls.indexOf('tooltip') >= 0) return 'tooltip';
    if (role === 'dialog' || role === 'alertdialog' || el.getAttribute('aria-modal') === 'true' || /modal|dialog/.test(cls)) return 'modal';
    if (/toast|snackbar|notification/.test(cls) || ((role === 'status' || role === 'alert') && cs.position === 'fixed')) return 'toast';
    if (/drawer|offcanvas|sheet/.test(cls)) return 'drawer';
    if (role === 'menu' || role === 'listbox' || /dropdown|popover|menu|select/.test(cls)) return 'dropdown';
    if (cs.position === 'sticky' || /sticky/.test(cls)) return 'sticky';
    if (/react-grid-item|panel|widget/.test(cls)) return 'panel';
    return 'other';
  }
  const SVG_SHAPES = { path: 1, rect: 1, circle: 1, ellipse: 1, line: 1, polyline: 1, polygon: 1, text: 1, tspan: 1, use: 1 };
  const FORM = { INPUT: 1, BUTTON: 1, SELECT: 1, TEXTAREA: 1 };
  const SIDES = ['top', 'right', 'bottom', 'left'];

  const els = [document.documentElement].concat(Array.from(document.body ? document.body.querySelectorAll('*') : []));
  for (const el of els) {
    if (el.closest && el.closest('[data-sa-ignore]')) continue;
    const cs = getComputedStyle(el);
    // z-index and motion values are read even for hidden elements (menus and dialogs are often hidden).
    if (cs.zIndex !== 'auto') {
      const z = R.zIndex[cs.zIndex] || (R.zIndex[cs.zIndex] = { count: 0, kinds: {} });
      z.count++;
      const k = zKind(el, cs);
      z.kinds[k] = (z.kinds[k] || 0) + 1;
    }
    const tds = durationsMs(cs.transitionDuration);
    const tfs = splitTop(cs.transitionTimingFunction || '');
    tds.forEach(function (d, i) {
      if (d > 0) {
        bump(R.durations, String(Math.round(d)), { prop: 'transition' });
        bump(R.easings, (tfs[i] || tfs[0] || 'ease').trim(), { prop: 'transition' });
      }
    });
    if (cs.animationName && cs.animationName !== 'none') {
      const ads = durationsMs(cs.animationDuration);
      const afs = splitTop(cs.animationTimingFunction || '');
      ads.forEach(function (d, i) {
        if (d > 0) {
          bump(R.durations, String(Math.round(d)), { prop: 'animation' });
          bump(R.easings, (afs[i] || afs[0] || 'ease').trim(), { prop: 'animation' });
        }
      });
    }
    const isRoot = el === document.documentElement || el === document.body;
    if (!isRoot && el.getClientRects().length === 0) continue;
    if (cs.visibility === 'hidden' && !isRoot) continue;
    R.elementCount++;
    const isSvg = el instanceof SVGElement;
    const tag = el.tagName.toLowerCase();
    let textLen = 0;
    for (const n of el.childNodes) if (n.nodeType === 3) textLen += n.textContent.trim().length;
    const isForm = !!FORM[el.tagName];
    const hasText = textLen > 0 || isForm;
    const rect = el.getBoundingClientRect();
    const area = Math.min(rect.width * rect.height, vw * vh);
    const disabled = !!(el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[aria-disabled="true"], :disabled'));
    // An element in a running colour transition or animation shows a value between two states. Skip its colours.
    let transient = false;
    if (el.getAnimations) {
      for (const a of el.getAnimations()) {
        if (a.playState !== 'running') continue;
        if (a.transitionProperty !== undefined) {
          if (COLOR_PROP.test(a.transitionProperty)) transient = true;
        } else if (a.effect && a.effect.getKeyframes) {
          const kf = a.effect.getKeyframes();
          if (kf.some(function (k) { return Object.keys(k).some(function (p) { return COLOR_PROP.test(p); }); })) transient = true;
        }
      }
    }
    if (transient) R.transientSkipped = (R.transientSkipped || 0) + 1;
    const colorOn = !transient;

    if (hasText && !(isSvg && tag !== 'text' && tag !== 'tspan')) {
      if (colorOn) addColor(cs.color, 'color', el, { textLen: textLen, disabled: disabled && textLen > 0 });
      bump(R.fontFamilies, cs.fontFamily, { textLen: textLen });
      bump(R.fontSizes, px(cs.fontSize), { textLen: textLen, prop: 'font-size' });
      bump(R.fontWeights, cs.fontWeight, { textLen: textLen });
      const fs = parseFloat(cs.fontSize);
      if (cs.lineHeight === 'normal') bump(R.lineHeights, 'normal', { textLen: textLen });
      else if (px(cs.lineHeight) && fs > 0) bump(R.lineHeights, String(Math.round((parseFloat(cs.lineHeight) / fs) * 100) / 100), { textLen: textLen });
      bump(R.letterSpacings, cs.letterSpacing === 'normal' ? '0px' : px(cs.letterSpacing), { textLen: textLen });
      if (cs.fontVariantNumeric && cs.fontVariantNumeric !== 'normal') bump(R.numeric, cs.fontVariantNumeric, { textLen: textLen });
      else if (cs.fontFeatureSettings && /tnum/.test(cs.fontFeatureSettings)) bump(R.numeric, 'tabular-nums', { textLen: textLen });
    }
    const bg = normColor(cs.backgroundColor);
    if (colorOn && bg && bg !== 'transparent') {
      const overlay = bg.indexOf('rgba') === 0 && (cs.position === 'fixed' || cs.position === 'absolute') && area > 0.25 * vw * vh;
      addColor(cs.backgroundColor, 'background-color', el, { area: area, overlay: overlay });
    }
    for (const side of SIDES) {
      const w = parseFloat(cs.getPropertyValue('border-' + side + '-width'));
      const st = cs.getPropertyValue('border-' + side + '-style');
      if (colorOn && w > 0 && st !== 'none' && st !== 'hidden') addColor(cs.getPropertyValue('border-' + side + '-color'), 'border-color', el);
    }
    if (colorOn && cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) addColor(cs.outlineColor, 'outline-color', el);
    if (cs.boxShadow && cs.boxShadow !== 'none') {
      bump(R.shadows, cs.boxShadow);
      if (colorOn) (cs.boxShadow.match(COLOR_FN) || []).forEach(function (c) { addColor(c, 'box-shadow', el); });
    }
    if (colorOn && isSvg && SVG_SHAPES[tag]) {
      if (cs.fill && cs.fill !== 'none') addColor(cs.fill, 'fill', el);
      if (cs.stroke && cs.stroke !== 'none' && parseFloat(cs.strokeWidth) > 0) addColor(cs.stroke, 'stroke', el);
    }
    if (!isSvg) {
      for (const p of ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'row-gap', 'column-gap']) {
        const v = px(cs.getPropertyValue(p));
        // Very large values are layout results (for example margin: auto), not spacing tokens.
        if (v !== null && Math.abs(parseFloat(v)) <= spacingMax) bump(R.spacing, v, { prop: p });
      }
      for (const c of ['top-left', 'top-right', 'bottom-right', 'bottom-left']) {
        const raw = cs.getPropertyValue('border-' + c + '-radius').trim().split(/\s+/)[0];
        if (!raw) continue;
        if (raw.slice(-1) === '%') bump(R.radii, raw);
        else {
          const v = px(raw);
          if (v !== null) bump(R.radii, v);
        }
      }
    }
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(el, pseudo);
      if (!ps.content || ps.content === 'none' || ps.content === 'normal') continue;
      if (ps.display === 'none') continue;
      const hasPText = ps.content.replace(/^["']|["']$/g, '').trim().length > 0;
      if (hasPText) addColor(ps.color, 'color', null, {});
      const pbg = normColor(ps.backgroundColor);
      if (pbg && pbg !== 'transparent') addColor(ps.backgroundColor, 'background-color', null, {});
      for (const side of SIDES) {
        const w = parseFloat(ps.getPropertyValue('border-' + side + '-width'));
        const st = ps.getPropertyValue('border-' + side + '-style');
        if (w > 0 && st !== 'none' && st !== 'hidden') addColor(ps.getPropertyValue('border-' + side + '-color'), 'border-color', null);
      }
    }
  }
  R.base.html = normColor(getComputedStyle(document.documentElement).backgroundColor);
  R.base.body = document.body ? normColor(getComputedStyle(document.body).backgroundColor) : null;

  if (arg.rootVars !== false) {
    const rcs = getComputedStyle(document.documentElement);
    for (let i = 0; i < rcs.length; i++) {
      const name = rcs[i];
      if (name.indexOf('--') === 0) R.rootVars[name] = rcs.getPropertyValue(name).trim();
    }
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const rule of Array.from(rules || [])) {
        if (!rule.selectorText || !/(^|,)\s*(:root|html)\s*(,|$)/.test(rule.selectorText)) continue;
        for (let i = 0; i < rule.style.length; i++) {
          const name = rule.style[i];
          if (name.indexOf('--') === 0 && !(name in R.rootVars)) R.rootVars[name] = rule.style.getPropertyValue(name).trim();
        }
      }
    }
  }
  return R;
}
