// Describe the focused element: accessible name, role and the focus indicator style.
function (arg) {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  function accName(e) {
    const al = e.getAttribute('aria-label');
    if (al) return al.trim();
    const lb = e.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map(function (id) { const n = document.getElementById(id); return n ? n.innerText || n.textContent : ''; }).join(' ').trim();
      if (t) return t;
    }
    if (e.labels && e.labels.length) return (e.labels[0].innerText || '').trim();
    if (e.getAttribute('placeholder')) return e.getAttribute('placeholder');
    if (!/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)) {
      const t = (e.innerText || e.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) return t.slice(0, 60);
    }
    return e.getAttribute('title') || e.getAttribute('alt') || '';
  }
  const implicit = { A: 'link', BUTTON: 'button', INPUT: 'textbox', SELECT: 'combobox', TEXTAREA: 'textbox', SUMMARY: 'button' };
  const cs = getComputedStyle(el);
  let key = el.getAttribute('data-sa-focus');
  if (!key) {
    key = 'f' + Math.random().toString(36).slice(2, 9);
    el.setAttribute('data-sa-focus', key);
  }
  const hasOutline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
  return {
    key: key,
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') || implicit[el.tagName] || '',
    name: accName(el).slice(0, 80),
    focusVisible: el.matches(':focus-visible'),
    indicator: hasOutline ? 'outline' : hasShadow ? 'box-shadow' : 'none',
    outlineColor: hasOutline ? cs.outlineColor : null,
    outlineWidth: cs.outlineWidth,
    outlineOffset: cs.outlineOffset,
    boxShadow: hasShadow ? cs.boxShadow : null
  };
}
