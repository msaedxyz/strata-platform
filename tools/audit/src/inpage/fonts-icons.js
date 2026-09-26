// Font faces and the icon set of the current view.
function (arg) {
  const prefixes = arg.iconPrefixes || [];
  const faces = [];
  if (document.fonts) {
    document.fonts.forEach(function (f) {
      faces.push({ family: f.family.replace(/^["']|["']$/g, ''), weight: f.weight, style: f.style, status: f.status, display: f.display });
    });
  }
  const fontFaceRules = [];
  const licenceComments = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const rule of Array.from(rules || [])) {
      if (rule.type === 5 || (rule.constructor && rule.constructor.name === 'CSSFontFaceRule')) {
        const src = rule.style.getPropertyValue('src');
        const urls = (src.match(/url\(([^)]+)\)/g) || []).map(function (u) {
          const raw = u.slice(4, -1).replace(/^["']|["']$/g, '');
          try { return new URL(raw, sheet.href || location.href).href; } catch (e) { return raw; }
        });
        fontFaceRules.push({
          family: rule.style.getPropertyValue('font-family').replace(/^["']|["']$/g, ''),
          weight: rule.style.getPropertyValue('font-weight'),
          style: rule.style.getPropertyValue('font-style'),
          urls: urls,
          sheet: sheet.href || 'inline'
        });
      }
    }
    if (sheet.ownerNode && sheet.ownerNode.tagName === 'STYLE') {
      const m = (sheet.ownerNode.textContent || '').match(/\/\*[^*]*(licen[cs]e|OFL|copyright)[^*]*\*\//gi);
      if (m) m.slice(0, 5).forEach(function (x) { licenceComments.push(x.slice(0, 300)); });
    }
  }
  const icons = { useHrefs: {}, symbolIds: [], classPrefixes: {}, svgSignatures: {}, iconFontElements: 0, examples: [] };
  document.querySelectorAll('svg use').forEach(function (u) {
    const h = u.getAttribute('href') || u.getAttribute('xlink:href') || '';
    const key = h.replace(/[?#].*$/, '') + (h.indexOf('#') >= 0 ? '#' + h.split('#')[1].replace(/[-_]?[a-z0-9]+$/i, '*') : '');
    icons.useHrefs[key] = (icons.useHrefs[key] || 0) + 1;
  });
  document.querySelectorAll('symbol[id]').forEach(function (s) { if (icons.symbolIds.length < 50) icons.symbolIds.push(s.id); });
  document.querySelectorAll('svg, i, span').forEach(function (el) {
    const cls = (el.getAttribute('class') || '').toLowerCase().split(/\s+/);
    for (const c of cls) {
      for (const p of prefixes) {
        if (c.indexOf(p) === 0 || c === p.replace(/-$/, '')) {
          icons.classPrefixes[p] = (icons.classPrefixes[p] || 0) + 1;
          if (icons.examples.length < 10 && icons.examples.indexOf(c) < 0) icons.examples.push(c);
        }
      }
    }
    if (el.tagName.toLowerCase() === 'svg') {
      const sig = [el.getAttribute('viewBox') || '-', el.getAttribute('fill') || '-', el.getAttribute('stroke') || '-', el.getAttribute('stroke-width') || '-', el.getAttribute('stroke-linecap') || '-'].join(' ');
      icons.svgSignatures[sig] = (icons.svgSignatures[sig] || 0) + 1;
    } else {
      const ff = getComputedStyle(el).fontFamily.toLowerCase();
      if (/icon|symbols|awesome|glyph/.test(ff)) icons.iconFontElements++;
    }
  });
  return { faces: faces, fontFaceRules: fontFaceRules, licenceComments: licenceComments, icons: icons };
}
