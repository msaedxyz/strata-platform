// Facts about the current page for the sensitive-page check and for views.md.
function (arg) {
  // Page content only: text in the navigation, header and menus is the same on each page, so it does not count.
  const SKIP = 'nav, aside, header, [role="navigation"], [role="banner"], [role="menu"], [role="menubar"], [class*="sidebar" i], script, style, noscript';
  const parts = [];
  let len = 0;
  const max = arg.maxText || 20000;
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode()) && len < max) {
      const t = n.textContent.trim();
      if (!t) continue;
      const p = n.parentElement;
      if (!p || p.closest(SKIP)) continue;
      if (p.getClientRects().length === 0) continue;
      parts.push(t);
      len += t.length + 1;
    }
  }
  const text = parts.join(' ').slice(0, max);
  const emails = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
  const pw = Array.from(document.querySelectorAll('input[type="password"]')).filter(function (el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const h1 = document.querySelector('h1');
  const headings = Array.from(document.querySelectorAll('h1, h2, h3')).filter(function (h) { return h.getClientRects().length > 0; }).slice(0, 20).map(function (h) {
    return (h.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }).filter(Boolean);
  return {
    title: document.title,
    h1: h1 ? (h1.innerText || '').trim().slice(0, 120) : '',
    headings: headings,
    text: text,
    hasPassword: pw.length > 0,
    emailCount: new Set(emails).size,
    lang: document.documentElement.lang || ''
  };
}
