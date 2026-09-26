// Find components by DOM heuristics and ARIA roles. Mark instances and state examples with
// data-sa-comp / data-sa-state attributes so that Node can take screenshots of them.
function (arg) {
  const defs = arg.definitions;
  const stateSel = arg.stateSelectors;
  const emptyRe = (arg.emptyTextPatterns || []).map(function (p) { return new RegExp(p, 'i'); });
  const maxN = arg.maxInstances || 3;
  const containers = arg.stateContainers || [];
  document.querySelectorAll('[data-sa-comp]').forEach(function (e) { e.removeAttribute('data-sa-comp'); });
  document.querySelectorAll('[data-sa-state]').forEach(function (e) { e.removeAttribute('data-sa-state'); });
  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
  }
  function cleanClass(c) {
    if (/^(sc-|css-|jsx-|svelte-|emotion-|tw-)[a-z0-9]+$/i.test(c)) return '';
    if (/^data-sa/.test(c)) return '';
    return c.replace(/__[a-z0-9]{4,}$/i, '').replace(/[_-][a-z0-9]{5,8}$/i, function (m) { return /\d/.test(m) ? '' : m; });
  }
  function sig(el) {
    const cls = String(el.getAttribute('class') || '').split(/\s+/).map(cleanClass).filter(Boolean).sort().slice(0, 6);
    const role = el.getAttribute('role');
    return el.tagName.toLowerCase() + (role ? '[role=' + role + ']' : '') + (cls.length ? '.' + cls.join('.') : '');
  }
  function outline(el, depth) {
    const line = sig(el);
    if (depth <= 0) return line;
    const kids = [];
    const seen = {};
    for (const c of Array.from(el.children)) {
      if (!visible(c)) continue;
      const s = sig(c);
      if (seen[s]) { seen[s]++; continue; }
      seen[s] = 1;
      kids.push(c);
      if (kids.length >= 5) break;
    }
    if (!kids.length) return line;
    return line + '\n' + kids.map(function (k) {
      const sub = outline(k, depth - 1).split('\n').map(function (l) { return '  ' + l; }).join('\n');
      return seen[sig(k)] > 1 ? sub + ' (x' + seen[sig(k)] + ')' : sub;
    }).join('\n');
  }
  function focusable(el) {
    if (el.tabIndex >= 0 && !el.disabled) return true;
    return !!el.querySelector('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
  }
  function matchesAny(el, sels) {
    for (const s of sels) { try { if (el.matches(s)) return true; } catch (e) {} }
    return false;
  }
  const result = {};
  for (const name of Object.keys(defs)) {
    const sels = defs[name];
    const set = new Set();
    for (const s of sels) {
      try { document.querySelectorAll(s).forEach(function (e) { if (!e.closest('[data-sa-ignore]')) set.add(e); }); } catch (e) {}
    }
    let all = Array.from(set);
    // Keep the outermost match for container components, so that nested matches do not count twice.
    if (['panel-frame', 'navigation', 'top-bar', 'app-shell', 'data-table', 'modal', 'drawer', 'ticker', 'map', 'tabs', 'menu', 'toast'].indexOf(name) >= 0) {
      all = all.filter(function (el) { return !all.some(function (o) { return o !== el && o.contains(el); }); });
    }
    const vis = all.filter(visible);
    const entry = { count: all.length, visibleCount: vis.length, instances: [], variants: {}, outline: '', states: {} };
    vis.forEach(function (el) { const s = sig(el); entry.variants[s] = (entry.variants[s] || 0) + 1; });
    vis.slice(0, maxN).forEach(function (el, i) {
      const mark = name + '-' + i;
      el.setAttribute('data-sa-comp', ((el.getAttribute('data-sa-comp') || '') + ' ' + mark).trim());
      const r = el.getBoundingClientRect();
      entry.instances.push({ mark: mark, rect: { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height }, focusable: focusable(el) });
    });
    if (vis[0]) entry.outline = outline(vis[0], 3);
    for (const state of Object.keys(stateSel)) {
      let found = null;
      // A container component (a panel, a table) shows a state through its content. Other components
      // show a state on the element itself. "disabled" is always a state of the element itself.
      const allowContains = state !== 'disabled' && containers.indexOf(name) >= 0;
      for (const el of vis) {
        const inner = matchesAny(el, stateSel[state]) ? el : !allowContains ? null : (function () {
          for (const s of stateSel[state]) { try { const x = el.querySelector(s); if (x && visible(x)) return x; } catch (e) {} }
          return null;
        })();
        if (inner) { found = el; break; }
        if (state === 'empty' && allowContains) {
          const t = (el.innerText || '').trim();
          if (t && t.length < 80 && emptyRe.some(function (re) { return re.test(t); })) { found = el; break; }
        }
      }
      if (state === 'empty' && !found && allowContains) {
        // An element with an empty-state text inside the component.
        for (const el of vis) {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = walker.nextNode())) {
            const t = n.textContent.trim();
            if (t && emptyRe.some(function (re) { return re.test(t); })) { found = el; break; }
          }
          if (found) break;
        }
      }
      if (found) {
        const mark = name + '-' + state;
        found.setAttribute('data-sa-state', ((found.getAttribute('data-sa-state') || '') + ' ' + mark).trim());
        entry.states[state] = mark;
      }
    }
    result[name] = entry;
  }
  return result;
}
