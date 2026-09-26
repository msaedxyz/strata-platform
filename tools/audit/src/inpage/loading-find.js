// Find a visible loading indicator while the view loads. Mark it and name the component that holds it.
function (arg) {
  const sels = arg.loading;
  const defs = arg.definitions;
  const order = arg.priority;
  for (const s of sels) {
    let list;
    try { list = document.querySelectorAll(s); } catch (e) { continue; }
    for (const el of Array.from(list)) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      let comp = 'panel-frame';
      let host = el;
      for (const name of order) {
        const csels = defs[name] || [];
        let hit = null;
        for (const c of csels) { try { hit = el.closest(c); } catch (e) {} if (hit) break; }
        if (hit) { comp = name; host = hit; break; }
      }
      host.setAttribute('data-sa-loading', '1');
      return { component: comp, selector: s };
    }
  }
  return null;
}
