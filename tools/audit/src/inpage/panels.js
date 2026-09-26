// Find the panels of a view by DOM heuristics. Keep the outermost candidates that are smaller than the viewport.
function (arg) {
  const GENERIC = '[data-panel], [class*="panel" i], [class*="widget" i], [class*="card" i], section[aria-label], [role="region"]';
  const SEL = arg.selector || (document.querySelector('.react-grid-item') ? '.react-grid-item' : GENERIC);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const PART = /(header|body|title|footer|content|toolbar|control|action|head|inner|wrapper|container|group|list|grid|tab|label|icon)/i;
  const candidates = Array.from(document.querySelectorAll(SEL)).filter(function (el) {
    if (el.closest('nav, [role="navigation"], aside')) return false;
    if (SEL === GENERIC && !el.hasAttribute('data-panel') && el.getAttribute('role') !== 'region' && el.tagName !== 'SECTION') {
      const toks = Array.from(el.classList).filter(function (t) { return /panel|widget|card/i.test(t); });
      if (toks.length && toks.every(function (t) { return PART.test(t.replace(/panel|widget|card/ig, '')); })) return false;
    }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (r.width < 80 || r.height < 40 || cs.display === 'none' || cs.visibility === 'hidden') return false;
    return r.width * r.height < 0.9 * vw * vh;
  });
  // A candidate that holds two or more other candidates is a container, not a panel.
  const all = candidates.filter(function (el) {
    let n = 0;
    for (const o of candidates) if (o !== el && el.contains(o)) n++;
    return n < 2;
  });
  const outer = all.filter(function (el) {
    return !all.some(function (o) { return o !== el && o.contains(el); });
  });
  function titleOf(el) {
    const lbl = el.getAttribute('aria-label');
    if (lbl) return lbl;
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map(function (id) { const n = document.getElementById(id); return n ? n.innerText : ''; }).join(' ').trim();
      if (t) return t;
    }
    const h = el.querySelector('h1, h2, h3, h4, h5, h6, [class*="title" i], [class*="header" i]');
    if (h) {
      const t = (h.innerText || '').split('\n')[0].trim();
      if (t) return t.slice(0, 80);
    }
    return '';
  }
  function kindOf(el) {
    if (el.querySelector('.maplibregl-map, .mapboxgl-map, .leaflet-container')) return 'map';
    if (el.querySelector('table, [role="grid"], [role="table"], [role="treegrid"], .ag-root')) return 'table';
    const big = Array.from(el.querySelectorAll('canvas, svg')).some(function (c) { const r = c.getBoundingClientRect(); return r.width > 120 && r.height > 60; });
    if (big) return 'chart';
    if (el.querySelector('form, input, select, textarea')) return 'form';
    if (el.querySelectorAll('li, [role="article"], [role="listitem"]').length >= 3) return 'list or feed';
    return 'content';
  }
  return outer.slice(0, 80).map(function (el) {
    const r = el.getBoundingClientRect();
    return {
      title: titleOf(el),
      kind: kindOf(el),
      className: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 120),
      rect: { x: Math.round(r.x), y: Math.round(r.y + window.scrollY), width: Math.round(r.width), height: Math.round(r.height) }
    };
  });
}
