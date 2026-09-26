// Describe the interactive controls in the page. Each control gets a data-sa-id attribute so that
// Node can find it again. The descriptors feed classifyControl() in safety.ts.
function (arg) {
  const selector = arg.selector || 'a[href], button, [role="button"], [role="link"], [role="menuitem"], [role="tab"], summary, [aria-haspopup], input, select, textarea, [contenteditable="true"]';
  const within = arg.within ? document.querySelector(arg.within) : document;
  if (!within) return [];
  const NAV = 'nav, [role="navigation"], aside, [class*="sidebar" i], [class*="sidenav" i], [class*="side-nav" i]';
  const MENU = '[role="menu"], [role="menubar"], [role="listbox"], [class*="dropdown" i], [class*="popover" i], [class*="submenu" i]';
  const HEADER = 'header, [role="banner"], [class*="topbar" i], [class*="top-bar" i], [class*="navbar" i], [class*="app-header" i]';
  const PANEL = '.react-grid-item, [data-panel], [class*="panel" i], [class*="widget" i], [role="region"]';
  const PANEL_HEADER = '[class*="panel-header" i], [class*="panelheader" i], [class*="widget-header" i], [class*="card-header" i], [class*="toolbar" i], [class*="titlebar" i], [class*="title-bar" i], header';
  let counter = Number(document.documentElement.getAttribute('data-sa-counter') || '0');
  const out = [];
  const els = Array.from(within.querySelectorAll(selector));
  if (within !== document && within.matches && within.matches(selector)) els.unshift(within);
  for (const el of els) {
    if (el.closest('[data-sa-ignore]')) continue;
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const visible = rect.width > 0 && rect.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
    if (arg.onlyVisible && !visible) continue;
    let id = el.getAttribute('data-sa-id');
    if (!id) {
      counter += 1;
      id = 'c' + counter;
      el.setAttribute('data-sa-id', id);
    }
    const form = el.closest('form');
    const hrefAttr = el.getAttribute('href');
    let href = null;
    let sameOrigin = undefined;
    if (hrefAttr !== null) {
      href = hrefAttr;
      try {
        const u = new URL(hrefAttr, location.href);
        if (u.protocol === 'http:' || u.protocol === 'https:') {
          href = u.href;
          sameOrigin = u.origin === location.origin;
        }
      } catch (e) {}
    }
    // A panel header is a header-like element inside a panel-like element. Look for the panel above the header,
    // so that a part such as "panel-controls" inside the header does not count as the panel.
    const panelHeader = el.closest(PANEL_HEADER);
    const panelEl = panelHeader && panelHeader.parentElement ? panelHeader.parentElement.closest(PANEL) : null;
    const inPanelHeader = !!(panelHeader && panelEl);
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    out.push({
      id: id,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      type: el.getAttribute('type') ? el.getAttribute('type').toLowerCase() : null,
      text: text,
      ariaLabel: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      name: el.getAttribute('name'),
      elementId: el.id || null,
      testId: el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy'),
      dataAction: el.getAttribute('data-action'),
      href: href,
      sameOrigin: sameOrigin,
      target: el.getAttribute('target'),
      download: el.hasAttribute('download'),
      inForm: !!form,
      formHasPassword: !!(form && form.querySelector('input[type="password"]')),
      inNav: !!el.closest(NAV),
      inMenu: !!el.closest(MENU),
      inHeader: !!el.closest(HEADER) && !inPanelHeader,
      inPanelHeader: inPanelHeader,
      inTablist: !!el.closest('[role="tablist"]'),
      hasPopup: el.hasAttribute('aria-haspopup') && el.getAttribute('aria-haspopup') !== 'false',
      expanded: el.getAttribute('aria-expanded'),
      disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      contentEditable: el.isContentEditable,
      visible: visible,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    });
  }
  document.documentElement.setAttribute('data-sa-counter', String(counter));
  return out;
}
