// Detect the panel grid: react-grid-layout style containers and CSS grids. Mark the items.
function (arg) {
  function q(sels, root) {
    for (const s of sels) {
      let list;
      try { list = (root || document).querySelectorAll(s); } catch (e) { continue; }
      if (list.length) return { selector: s, list: Array.from(list) };
    }
    return { selector: null, list: [] };
  }
  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && getComputedStyle(el).display !== 'none';
  }
  document.querySelectorAll('[data-sa-item]').forEach(function (e) { e.removeAttribute('data-sa-item'); });
  const grid = q(arg.gridSelectors);
  const container = grid.list.filter(visible)[0] || null;
  const items = [];
  let itemSelector = null;
  if (container) {
    const it = q(arg.itemSelectors, container);
    itemSelector = it.selector;
    const crect = container.getBoundingClientRect();
    it.list.filter(visible).forEach(function (el, i) {
      el.setAttribute('data-sa-item', String(i));
      const r = el.getBoundingClientRect();
      const title = (function () {
        const h = el.querySelector('h1, h2, h3, h4, h5, h6, [class*="title" i]');
        return h ? (h.innerText || '').split('\n')[0].trim().slice(0, 60) : '';
      })();
      const handles = Array.from(el.querySelectorAll(arg.resizeHandleSelectors.join(','))).map(function (h) { return String(h.getAttribute('class') || '').slice(0, 80); });
      let dragHandle = null;
      for (const s of arg.dragHandleSelectors) {
        try { const d = el.querySelector(s); if (d && visible(d)) { dragHandle = s; break; } } catch (e) {}
      }
      items.push({
        index: i,
        title: title,
        left: Math.round(r.left - crect.left),
        top: Math.round(r.top - crect.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
        transform: getComputedStyle(el).transform,
        position: getComputedStyle(el).position,
        className: String(el.getAttribute('class') || '').slice(0, 120),
        resizeHandles: handles.slice(0, 8),
        dragHandle: dragHandle,
        draggable: /react-draggable|draggable/i.test(String(el.getAttribute('class') || '')) || !!dragHandle
      });
    });
  }
  const cssGrids = [];
  document.querySelectorAll('body *').forEach(function (el) {
    if (cssGrids.length >= 20) return;
    const cs = getComputedStyle(el);
    if (cs.display !== 'grid' && cs.display !== 'inline-grid') return;
    if (el.children.length < 2 || !visible(el)) return;
    const cols = cs.gridTemplateColumns === 'none' ? 0 : cs.gridTemplateColumns.split(/\s+(?![^(]*\))/).length;
    cssGrids.push({
      element: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.getAttribute('class') ? '.' + String(el.getAttribute('class')).trim().split(/\s+/).slice(0, 2).join('.') : ''),
      columns: cols,
      templateColumns: cs.gridTemplateColumns.slice(0, 200),
      templateRows: cs.gridTemplateRows.slice(0, 200),
      autoRows: cs.gridAutoRows,
      rowGap: cs.rowGap,
      columnGap: cs.columnGap,
      children: el.children.length
    });
  });
  const crect = container ? container.getBoundingClientRect() : null;
  return {
    container: container ? {
      selector: grid.selector,
      className: String(container.getAttribute('class') || '').slice(0, 120),
      width: Math.round(crect.width),
      height: Math.round(crect.height),
      itemSelector: itemSelector
    } : null,
    items: items,
    cssGrids: cssGrids,
    placeholder: !!(container || document).querySelector(arg.placeholderSelectors.join(','))
  };
}
