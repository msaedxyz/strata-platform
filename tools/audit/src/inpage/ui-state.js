// A small snapshot of the UI state, to find the effect of a key press.
function (arg) {
  function accName(el) {
    if (!el || el === document.body || el === document.documentElement) return '';
    const al = el.getAttribute('aria-label');
    if (al) return al.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map(function (id) { const n = document.getElementById(id); return n ? n.innerText || n.textContent : ''; }).join(' ').trim();
      if (t) return t;
    }
    if (el.labels && el.labels.length) return (el.labels[0].innerText || '').trim();
    if (el.getAttribute('placeholder')) return el.getAttribute('placeholder');
    const tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) return t.slice(0, 60);
    }
    return el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name') || '';
  }
  function visible(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
  }
  const overlaySel = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open], [role="menu"], [role="listbox"], [cmdk-root], [class*="palette" i], [class*="command" i][class*="menu" i], [class*="popover" i], [class*="modal" i]';
  const overlays = Array.from(document.querySelectorAll(overlaySel)).filter(visible).slice(0, 10).map(function (el) {
    return { role: el.getAttribute('role') || el.tagName.toLowerCase(), name: accName(el).slice(0, 60) };
  });
  const a = document.activeElement;
  // Identify selected or active elements by position and class, not by text (live values change the text).
  function sig(el) {
    const idx = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + '.' + String(el.getAttribute('class') || '').trim().split(/\s+/).slice(0, 3).join('.') + '@' + idx;
  }
  const selected = Array.from(document.querySelectorAll('[aria-selected="true"], [aria-current="true"], [aria-current="page"], [class*="selected" i], [class*="active" i]')).filter(visible).slice(0, 20).map(sig);
  return {
    url: location.href,
    title: document.title,
    active: a && a !== document.body ? { tag: a.tagName.toLowerCase(), role: a.getAttribute('role') || '', name: accName(a).slice(0, 80), editable: a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) } : null,
    overlays: overlays,
    scrollY: Math.round(window.scrollY),
    selected: selected.join(' | ').slice(0, 600),
    marker: !!window.__saKeyMarker
  };
}
