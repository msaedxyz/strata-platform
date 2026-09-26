// Start recording class, style and text mutations, and CSS animations, for the value-change analysis.
function (arg) {
  if (window.__saMut && window.__saMut.observer) window.__saMut.observer.disconnect();
  const cap = arg.cap || 20000;
  const rec = { t0: performance.now(), items: [], observer: null, flashColors: {} };
  function desc(el) {
    if (!el || !el.tagName) return '#text';
    let s = el.tagName.toLowerCase();
    const cls = el.getAttribute('class');
    if (cls) s += '.' + cls.trim().split(/\s+/).filter(function (c) { return !/^data-sa/.test(c); }).slice(0, 2).join('.');
    return s.slice(0, 60);
  }
  function elId(el) {
    if (!el.__saId) el.__saId = Math.random().toString(36).slice(2, 10);
    return el.__saId;
  }
  function chain(el) {
    const ids = [];
    for (let e = el, i = 0; e && e.nodeType === 1 && i < 4; e = e.parentElement, i++) ids.push(elId(e));
    return ids;
  }
  const obs = new MutationObserver(function (list) {
    const now = performance.now() - rec.t0;
    for (const m of list) {
      if (rec.items.length >= cap) return;
      if (m.type === 'attributes') {
        const el = m.target;
        if (m.attributeName && m.attributeName.indexOf('data-sa') === 0) continue;
        const item = { t: now, type: m.attributeName, id: elId(el), target: desc(el), old: (m.oldValue || '').slice(0, 300), now: String(el.getAttribute(m.attributeName) || '').slice(0, 300) };
        if (m.attributeName === 'class') {
          const cs = getComputedStyle(el);
          item.bg = cs.backgroundColor;
          item.color = cs.color;
          item.transition = cs.transitionDuration + ' ' + cs.transitionProperty.slice(0, 60);
          // During a colour transition the computed value is the start value. Read the end value instead.
          if (el.getAnimations) {
            for (const a of el.getAnimations()) {
              if (a.transitionProperty === undefined || !a.effect || !a.effect.getKeyframes) continue;
              const kf = a.effect.getKeyframes();
              const end = kf[kf.length - 1] || {};
              for (const k of Object.keys(end)) {
                if (!/color/i.test(k)) continue;
                if (/background/i.test(k)) item.bg = end[k];
                else if (k === 'color') item.color = end[k];
              }
            }
          }
        }
        rec.items.push(item);
      } else if (m.type === 'characterData') {
        const el = m.target.parentElement;
        if (el) rec.items.push({ t: now, type: 'text', id: elId(el), ids: chain(el), target: desc(el) });
      } else if (m.type === 'childList') {
        const el = m.target;
        const textish = Array.from(m.addedNodes).some(function (n) { return n.nodeType === 3 || (n.nodeType === 1 && n.childElementCount === 0); });
        if (textish && el.nodeType === 1) rec.items.push({ t: now, type: 'text', id: elId(el), ids: chain(el), target: desc(el) });
        else if (m.addedNodes.length && el.nodeType === 1) rec.items.push({ t: now, type: 'nodes', id: elId(el), target: desc(el), added: m.addedNodes.length });
      }
    }
  });
  obs.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-state', 'data-flash', 'data-trend'], attributeOldValue: true, characterData: true, characterDataOldValue: false, childList: true, subtree: true });
  rec.observer = obs;
  document.addEventListener('animationstart', function (e) {
    if (rec.items.length < cap) rec.items.push({ t: performance.now() - rec.t0, type: 'animation', id: elId(e.target), target: desc(e.target), name: e.animationName });
  }, true);
  document.addEventListener('transitionstart', function (e) {
    if (rec.items.length < cap) rec.items.push({ t: performance.now() - rec.t0, type: 'transition', id: elId(e.target), target: desc(e.target), name: e.propertyName });
  }, true);
  window.__saMut = rec;
  return true;
}
