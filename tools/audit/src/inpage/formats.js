// Samples of timestamp, number and currency formats in the visible text.
function (arg) {
  const MON = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?';
  const patterns = {
    'iso-datetime': /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
    'iso-date': /\b\d{4}-\d{2}-\d{2}\b/g,
    'time-24h': /\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b(?!\s?[AaPp][Mm])/g,
    'time-12h': /\b(?:0?[1-9]|1[0-2]):[0-5]\d(?::[0-5]\d)?\s?[AaPp][Mm]\b/g,
    'date-day-month-name': new RegExp('\\b\\d{1,2}\\s' + MON + '(?:\\s\\d{2,4})?\\b', 'g'),
    'date-month-name-day': new RegExp('\\b' + MON + '\\s\\d{1,2}(?:,?\\s\\d{4})?\\b', 'g'),
    'date-numeric': /\b\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\b/g,
    'relative-time': /\b\d+\s?(?:s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|weeks?|mo|months?|y|yr|years?)\s?ago\b|\bjust now\b|\byesterday\b/gi,
    'timezone': /\b(?:UTC|GMT|CAT|SAST|EAT|WAT|BST|CET|EST|EDT|PST)(?:[+-]\d{1,2})?\b/g,
    'currency-symbol': /[$€£¥₦]\s?[-−]?\d[\d,.\s]*(?:[kKmMbBtT](?:n|bn)?)?/g,
    'currency-code': /\b(?:USD|EUR|GBP|ZMW|ZAR|CNY|CAD|AUD|JPY|CHF|KES|NGN)\s?[-−]?\d[\d,.]*(?:\s?(?:k|m|bn|mn|K|M|B))?\b|\b\d[\d,.]*\s?(?:USD|EUR|GBP|ZMW|ZAR)\b/g,
    'kwacha-prefix': /\bK\s?\d[\d,]*(?:\.\d+)?\b/g,
    'percent': /[+\-−]?\d+(?:[.,]\d+)?\s?%/g,
    'signed-number': /(?:^|[\s(])[+\-−]\d[\d,]*(?:\.\d+)?(?![\d%])/g,
    'thousands-comma': /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g,
    'thousands-space': /\b\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?\b/g,
    'abbreviated-number': /\b\d+(?:\.\d+)?\s?(?:[KMBT]|bn|mn|k)\b/g,
    'decimal': /\b\d+\.\d+\b/g,
    'parentheses-negative': /\(\d[\d,]*(?:\.\d+)?\)/g
  };
  const out = {};
  for (const k of Object.keys(patterns)) out[k] = { count: 0, samples: [] };
  const decimals = {};
  let minusHyphen = 0, minusSign = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n, seen = 0;
  while ((n = walker.nextNode()) && seen < 20000) {
    const t = n.textContent;
    if (!t || !t.trim()) continue;
    const p = n.parentElement;
    if (!p || p.closest('script, style, noscript, [data-sa-ignore]')) continue;
    const r = p.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    seen++;
    for (const [k, re] of Object.entries(patterns)) {
      re.lastIndex = 0;
      const m = t.match(re);
      if (!m) continue;
      out[k].count += m.length;
      for (const s of m) {
        const v = s.trim();
        if (out[k].samples.length < 6 && out[k].samples.indexOf(v) < 0) out[k].samples.push(v.slice(0, 40));
        if (k === 'decimal') { const d = v.split('.')[1].length; decimals[d] = (decimals[d] || 0) + 1; }
      }
    }
    minusHyphen += (t.match(/(?:^|\s)-\d/g) || []).length;
    minusSign += (t.match(/−\d/g) || []).length;
  }
  return { patterns: out, decimals: decimals, minus: { hyphen: minusHyphen, unicodeMinus: minusSign }, textNodes: seen, locale: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
