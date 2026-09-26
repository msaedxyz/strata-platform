// Measure the ticker speed: sample the horizontal position of the ticker content over time.
async function (arg) {
  let ticker = null;
  for (const s of arg.selectors) {
    try { ticker = Array.from(document.querySelectorAll(s)).find(function (el) { const r = el.getBoundingClientRect(); return r.width > 100 && r.height > 4; }); } catch (e) {}
    if (ticker) break;
  }
  if (!ticker) return { found: false };
  const cands = [ticker].concat(Array.from(ticker.querySelectorAll('*')).slice(0, 60));
  function sample() {
    return { t: performance.now(), lefts: cands.map(function (c) { return c.getBoundingClientRect().left; }), scroll: ticker.scrollLeft };
  }
  const samples = [];
  const end = performance.now() + arg.ms;
  while (performance.now() < end) {
    samples.push(sample());
    await new Promise(function (r) { setTimeout(r, 100); });
  }
  samples.push(sample());
  // For each candidate, the mean speed between samples without the wrap-around jumps
  // (a jump is a step larger than three times the median non-zero step).
  function speedOf(get) {
    const steps = [];
    for (let i = 1; i < samples.length; i++) {
      const dt = (samples[i].t - samples[i - 1].t) / 1000;
      if (dt > 0) steps.push({ d: get(samples[i]) - get(samples[i - 1]), dt: dt });
    }
    const mags = steps.map(function (x) { return Math.abs(x.d); }).filter(function (m) { return m > 0; }).sort(function (a, b) { return a - b; });
    if (!mags.length) return 0;
    const med = mags[Math.floor(mags.length / 2)];
    const kept = steps.filter(function (x) { return Math.abs(x.d) <= 3 * med; });
    const d = kept.reduce(function (n, x) { return n + x.d; }, 0);
    const t = kept.reduce(function (n, x) { return n + x.dt; }, 0);
    return t > 0 ? d / t : 0;
  }
  let best = { index: -1, speed: 0 };
  cands.forEach(function (c, i) {
    const s = speedOf(function (x) { return x.lefts[i]; });
    if (Math.abs(s) > Math.abs(best.speed)) best = { index: i, speed: s };
  });
  const scrollSpeed = speedOf(function (x) { return x.scroll; });
  let method = 'none';
  let speed = 0;
  if (Math.abs(scrollSpeed) > Math.abs(best.speed)) { method = 'scrollLeft'; speed = -scrollSpeed; } else if (best.index >= 0) { speed = best.speed; }
  const mover = best.index >= 0 ? cands[best.index] : ticker;
  const cs = getComputedStyle(mover);
  if (method === 'none' && Math.abs(speed) > 0.5) method = cs.animationName && cs.animationName !== 'none' ? 'css-animation' : (cs.transform !== 'none' ? 'transform' : 'layout-position');
  const tr = ticker.getBoundingClientRect();
  return {
    found: true,
    pxPerSecond: Math.round(speed * 10) / 10,
    direction: speed < 0 ? 'right-to-left' : speed > 0 ? 'left-to-right' : 'static',
    method: method,
    animation: cs.animationName !== 'none' ? { name: cs.animationName, duration: cs.animationDuration, timing: cs.animationTimingFunction, playState: cs.animationPlayState } : null,
    mover: mover.tagName.toLowerCase() + (mover.getAttribute('class') ? '.' + String(mover.getAttribute('class')).split(/\s+/)[0] : ''),
    rect: { x: tr.x, y: tr.y, width: tr.width, height: tr.height },
    samples: samples.length
  };
}
