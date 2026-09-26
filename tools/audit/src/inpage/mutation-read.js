// Stop the mutation recording and summarise it: text changes, classes that flash after a value change,
// style properties that change, and CSS animations and transitions.
function (arg) {
  const rec = window.__saMut;
  if (!rec) return null;
  if (rec.observer) rec.observer.disconnect();
  const items = rec.items.slice().sort(function (a, b) { return a.t - b.t; });
  const byType = {};
  const textTargets = {};
  const lastText = {};
  const open = {};
  const flashes = {};
  const styleProps = {};
  const animations = {};
  const transitions = {};
  let textChanges = 0;
  function toks(s) { return String(s || '').split(/\s+/).filter(Boolean); }
  for (const it of items) {
    byType[it.type] = (byType[it.type] || 0) + 1;
    if (it.type === 'text') {
      textChanges++;
      textTargets[it.target] = (textTargets[it.target] || 0) + 1;
      (it.ids || [it.id]).forEach(function (id) { lastText[id] = it.t; });
    } else if (it.type === 'class') {
      const o = toks(it.old), n = toks(it.now);
      const added = n.filter(function (x) { return o.indexOf(x) < 0; });
      const removed = o.filter(function (x) { return n.indexOf(x) < 0; });
      for (const tok of added) {
        if (/^data-sa/.test(tok)) continue;
        const f = flashes[tok] || (flashes[tok] = { count: 0, durations: [], afterText: 0, bg: {}, color: {}, targets: {}, transition: {} });
        f.count++;
        f.targets[it.target] = (f.targets[it.target] || 0) + 1;
        if (it.bg) f.bg[it.bg] = (f.bg[it.bg] || 0) + 1;
        if (it.color) f.color[it.color] = (f.color[it.color] || 0) + 1;
        if (it.transition) f.transition[it.transition] = (f.transition[it.transition] || 0) + 1;
        if (lastText[it.id] !== undefined && it.t - lastText[it.id] <= 1000) f.afterText++;
        open[it.id + '|' + tok] = it.t;
      }
      for (const tok of removed) {
        const k = it.id + '|' + tok;
        if (open[k] !== undefined) {
          const f = flashes[tok];
          if (f && f.durations.length < 200) f.durations.push(Math.round(it.t - open[k]));
          delete open[k];
        }
      }
    } else if (it.type === 'style') {
      const props = String(it.now).split(';').map(function (d) { return d.split(':')[0].trim(); }).filter(Boolean);
      props.forEach(function (p) { styleProps[p] = (styleProps[p] || 0) + 1; });
    } else if (it.type === 'animation') {
      animations[it.name] = (animations[it.name] || 0) + 1;
    } else if (it.type === 'transition') {
      transitions[it.name] = (transitions[it.name] || 0) + 1;
    }
  }
  function med(xs) { if (!xs.length) return null; const s = xs.slice().sort(function (a, b) { return a - b; }); return s[Math.floor(s.length / 2)]; }
  function topN(o, n) { return Object.entries(o).sort(function (a, b) { return b[1] - a[1]; }).slice(0, n); }
  const flashList = Object.entries(flashes).map(function (e) {
    const f = e[1];
    return { token: e[0], count: f.count, afterText: f.afterText, medianDurationMs: med(f.durations), bg: topN(f.bg, 3), color: topN(f.color, 3), targets: topN(f.targets, 3), transition: topN(f.transition, 2) };
  }).sort(function (a, b) { return (b.afterText - a.afterText) || (b.count - a.count); }).slice(0, 15);
  return {
    durationMs: Math.round(performance.now() - rec.t0),
    total: items.length,
    byType: byType,
    textChanges: textChanges,
    textTargets: topN(textTargets, 10),
    flashes: flashList,
    styleProps: topN(styleProps, 15),
    animations: topN(animations, 15),
    transitions: topN(transitions, 15)
  };
}
