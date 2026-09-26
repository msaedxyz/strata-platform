// Mock dashboard for the audit tests. Plain JavaScript, no framework.
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const path = location.pathname.replace(/\/$/, '') || '/dashboard';
  const probe = (name) => { new Image().src = '/__probe/' + name + '?t=' + Date.now(); };

  // ----- user menu, more menu -----
  fetch('/api/me').then((r) => r.json()).then((me) => { $('#user-name').textContent = me.name; });
  function toggleMenu(btn, menu, open) {
    const o = open === undefined ? menu.hidden : open;
    menu.hidden = !o;
    btn.setAttribute('aria-expanded', String(o));
  }
  $('#user-btn').addEventListener('click', () => toggleMenu($('#user-btn'), $('#user-dropdown')));
  $('#more-btn').addEventListener('mouseenter', () => toggleMenu($('#more-btn'), $('#more-menu'), true));
  $('#more-btn').addEventListener('click', () => toggleMenu($('#more-btn'), $('#more-menu')));
  $('.more').addEventListener('mouseleave', () => toggleMenu($('#more-btn'), $('#more-menu'), false));
  $('#logout-btn').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/login';
  });
  $$('.sidebar a').forEach((a) => { if (a.getAttribute('href') === path) a.setAttribute('aria-current', 'page'); });

  // ----- ticker -----
  const track = $('#ticker-track');
  const symbols = [['CU', '9,412.50', '+1.24%'], ['CO', '33,150.00', '-0.42%'], ['AU', '2,315.10', '+0.08%'], ['DSL', 'K 28.45', '+2.10%'], ['ZMW', '26.81', '-0.15%']];
  for (let k = 0; k < 3; k++) {
    for (const [s, p, c] of symbols) {
      const span = document.createElement('span');
      span.className = 'ticker-item';
      span.innerHTML = s + ' ' + p + ' <span class="' + (c[0] === '+' ? 'up' : 'down') + '">' + c + '</span>';
      track.appendChild(span);
    }
  }
  let offset = 0;
  let paused = false;
  let last = performance.now();
  $('.ticker').addEventListener('mouseenter', () => { paused = true; });
  $('.ticker').addEventListener('mouseleave', () => { paused = false; });
  function frame(now) {
    const dt = (now - last) / 1000;
    last = now;
    if (!paused) {
      offset -= 40 * dt;
      if (-offset > track.scrollWidth / 3) offset = 0;
      track.style.transform = 'translateX(' + offset.toFixed(1) + 'px)';
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ----- toast -----
  setTimeout(() => $('#toast').classList.add('hidden'), 6000);

  // ----- search -----
  let searchTimer = null;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value;
    searchTimer = setTimeout(async () => {
      const list = $('#search-results');
      if (!q) { list.hidden = true; return; }
      const res = await fetch('/api/search?q=' + encodeURIComponent(q));
      const items = await res.json();
      list.innerHTML = items.map((i) => '<li role="option">' + i + '</li>').join('');
      list.hidden = !items.length;
    }, 250);
  });

  // ----- dialogs -----
  function openDialog(id) { $('#' + id).hidden = false; $('#modal-backdrop').hidden = false; }
  function closeDialogs() { $$('[role="dialog"]').forEach((d) => { d.hidden = true; }); $('#modal-backdrop').hidden = true; }
  $('#modal-close').addEventListener('click', closeDialogs);
  const commands = ['HELP  Show help', 'NEWS  Open news', 'MKTS  Open markets', 'DASH  Open dashboard'];
  function renderPalette(q) {
    $('#palette-list').innerHTML = commands.filter((c) => c.toLowerCase().includes(q.toLowerCase())).map((c) => '<li role="option">' + c + '</li>').join('');
  }
  $('#palette-input').addEventListener('input', (e) => renderPalette(e.target.value));
  $('#palette-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fetch('/api/command', { method: 'POST', body: e.target.value });
  });

  // ----- keyboard -----
  let gPending = 0;
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
    if (e.key === 'Escape') { closeDialogs(); if (typing) t.blur(); return; }
    if (typing) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openDialog('palette');
      renderPalette('');
      $('#palette-input').focus();
      return;
    }
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); return; }
    if (e.key === '?') { openDialog('help'); return; }
    if (e.key === 'g') { gPending = Date.now(); return; }
    if (gPending && Date.now() - gPending < 1000) {
      gPending = 0;
      const to = { d: '/dashboard', m: '/markets', n: '/news' }[e.key];
      if (to) location.href = to;
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const rows = $$('#watchlist-table tbody tr');
      if (!rows.length) return;
      e.preventDefault();
      let i = rows.findIndex((r) => r.classList.contains('selected'));
      rows.forEach((r) => { r.classList.remove('selected'); r.removeAttribute('aria-selected'); });
      i = e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
      rows[i].classList.add('selected');
      rows[i].setAttribute('aria-selected', 'true');
      return;
    }
    if (/^[1-4]$/.test(e.key)) {
      const panels = $$('.react-grid-item');
      panels.forEach((p) => p.classList.remove('active-panel'));
      const p = panels[Number(e.key) - 1];
      if (p) p.classList.add('active-panel');
    }
  });

  // ----- grid layout -----
  const COLS = 12, ROW = 30, M = 8;
  const main = $('#main');
  function panelHtml(id, title, body) {
    return '<div class="react-grid-item react-draggable react-resizable panel" data-i="' + id + '">' +
      '<div class="panel-header"><h2 class="panel-title">' + title + '</h2><div class="panel-controls">' +
      '<button aria-label="Collapse panel" title="Collapse">&#9662;</button>' +
      '<button aria-label="Maximise panel" title="Maximise">&#9633;</button>' +
      '<button aria-label="Close panel" title="Close">&#215;</button></div></div>' +
      '<div class="panel-body">' + body + '</div><span class="react-resizable-handle react-resizable-handle-se"></span></div>';
  }
  const bodies = {
    watchlist: '<table id="watchlist-table"><thead><tr><th aria-sort="ascending"><button>Symbol</button></th><th aria-sort="none"><button>Last</button></th><th>Change</th><th>Updated</th></tr></thead><tbody>' +
      '<tr><td>CU</td><td class="num price" data-s="CU">$9,412.50</td><td class="num up">+1.24%</td><td class="num">14:32:05</td></tr>' +
      '<tr><td>CO</td><td class="num price" data-s="CO">$33,150.00</td><td class="num down">-0.42%</td><td class="num">14:31:58</td></tr>' +
      '<tr><td>AU</td><td class="num price" data-s="AU">$2,315.10</td><td class="num up">+0.08%</td><td class="num">14:31:40</td></tr>' +
      '<tr><td>DSL</td><td class="num price" data-s="DSL">K 28.45</td><td class="num up">+2.10%</td><td class="num">14:30:12</td></tr>' +
      '</tbody></table><button class="btn" id="details-btn">Details</button> <span class="badge badge-positive">LIVE</span> <span class="badge badge-warning">DELAYED</span>',
    chart: '<svg class="chart" width="100%" height="160" viewBox="0 0 300 160" role="img" aria-label="Price chart"><polyline fill="none" stroke="#3b82f6" stroke-width="2" points="0,120 50,100 100,110 150,60 200,70 250,40 300,50"/><line x1="0" y1="150" x2="300" y2="150" stroke="#2a313c" stroke-width="1"/></svg><canvas class="chart-canvas" width="300" height="40" aria-label="Volume"></canvas>',
    news: '<div class="tabs" role="tablist"><button role="tab" aria-selected="true" id="tab-latest">Latest</button><button role="tab" aria-selected="false" id="tab-saved">Pinned</button></div>' +
      '<ul class="feed" id="feed"><li class="feed-item"><time>2026-09-26 10:15</time><span>Copper output rises at Kansanshi</span> <span class="badge badge-positive">Tier 1</span></li>' +
      '<li class="feed-item"><time>2 min ago</time><span>Diesel shortage reported on the corridor</span> <span class="badge badge-negative">Tier 0</span></li>' +
      '<li class="feed-item"><time>26 Sep 2026</time><span>ZEMA notice for a new mine project</span> <span class="badge">Reported</span></li></ul>' +
      '<div class="empty-state" id="feed-empty" hidden>No results</div>',
    order: '<form id="order-form" class="order-form"><div class="form-row"><label for="qty">Quantity</label><input id="qty" name="qty" value="-5" aria-invalid="true"><span class="error-text">Quantity must be positive</span></div>' +
      '<div class="form-row"><label for="note">Note</label><input id="note" name="note" value=""></div>' +
      '<div class="form-actions"><button type="submit" class="btn btn-primary" id="save-btn">Save</button><button type="button" class="btn btn-danger" id="delete-btn">Delete</button><button type="button" class="btn" disabled>Submit order</button></div></form>',
    quotes: '<table id="quotes-table"><thead><tr><th>Symbol</th><th>Price</th></tr></thead><tbody>' +
      ['CU', 'CO', 'AU', 'DSL'].map((s) => '<tr><td>' + s + '</td><td class="num price" data-s="' + s + '">1,000.00</td></tr>').join('') + '</tbody></table>',
    reports: '<div class="empty-state">No results</div>'
  };
  const titles = { watchlist: 'Watchlist', chart: 'Price chart', news: 'News feed', order: 'Order entry', quotes: 'Quotes', reports: 'Reports' };
  const defaults = {
    '/dashboard': [{ i: 'watchlist', x: 0, y: 0, w: 6, h: 8 }, { i: 'chart', x: 6, y: 0, w: 6, h: 8 }, { i: 'news', x: 0, y: 8, w: 6, h: 8 }, { i: 'order', x: 6, y: 8, w: 6, h: 8 }],
    '/markets': [{ i: 'quotes', x: 0, y: 0, w: 8, h: 10 }],
    '/news': [{ i: 'news', x: 0, y: 0, w: 12, h: 10 }],
    '/reports': [{ i: 'reports', x: 0, y: 0, w: 6, h: 6 }]
  };
  const storeKey = 'mock-layout-v1:' + path;
  let layout = null;
  try { layout = JSON.parse(localStorage.getItem(storeKey) || 'null'); } catch (e) { layout = null; }
  if (!layout && defaults[path]) layout = defaults[path].map((x) => Object.assign({}, x));

  const sensitive = { '/billing': '<h1>Billing</h1><p>Payment method: card ending 4242</p>', '/account/api-keys': '<h1>API keys</h1><p>Secret key: shown once</p>', '/account/profile': '<h1>Profile</h1><p>Personal details</p>' };
  if (sensitive[path]) { main.innerHTML = '<div class="panel-body">' + sensitive[path] + '</div>'; }

  let colW = 0;
  function geom(it) {
    return { left: M + it.x * (colW + M), top: M + it.y * (ROW + M), width: it.w * colW + (it.w - 1) * M, height: it.h * ROW + (it.h - 1) * M };
  }
  function save() { try { localStorage.setItem(storeKey, JSON.stringify(layout)); } catch (e) {} }
  function render() {
    if (!layout) return;
    const grid = $('.react-grid-layout') || (function () {
      const g = document.createElement('div');
      g.className = 'react-grid-layout';
      main.appendChild(g);
      return g;
    })();
    colW = (grid.clientWidth - M * (COLS + 1)) / COLS;
    let maxBottom = 0;
    for (const it of layout) {
      let el = grid.querySelector('[data-i="' + it.i + '"]');
      if (!el) {
        grid.insertAdjacentHTML('beforeend', panelHtml(it.i, titles[it.i] || it.i, bodies[it.i] || ''));
        el = grid.querySelector('[data-i="' + it.i + '"]');
        wire(el, it);
      }
      const g = geom(it);
      el.style.transform = 'translate(' + g.left + 'px,' + g.top + 'px)';
      el.style.width = g.width + 'px';
      el.style.height = (it.collapsed ? 28 : g.height) + 'px';
      el.classList.toggle('collapsed', !!it.collapsed);
      maxBottom = Math.max(maxBottom, g.top + g.height);
    }
    grid.style.height = (maxBottom + M) + 'px';
  }
  function wire(el, it) {
    const header = el.querySelector('.panel-header');
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      startDrag(e, el, it, 'move');
    });
    el.querySelector('.react-resizable-handle').addEventListener('mousedown', (e) => startDrag(e, el, it, 'resize'));
    el.querySelector('[aria-label="Collapse panel"]').addEventListener('click', () => { it.collapsed = !it.collapsed; save(); render(); });
    el.querySelector('[aria-label="Maximise panel"]').addEventListener('click', () => el.classList.toggle('maximised'));
    el.querySelector('[aria-label="Close panel"]').addEventListener('click', () => {
      layout = layout.filter((x) => x !== it);
      el.remove();
      fetch('/api/layout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(layout) });
      render();
    });
  }
  function startDrag(e, el, it, mode) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const g0 = geom(it);
    const ph = document.createElement('div');
    ph.className = 'react-grid-placeholder';
    el.parentElement.appendChild(ph);
    el.classList.add(mode === 'move' ? 'dragging' : 'resizing');
    function move(ev) {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let nx = it.x, ny = it.y, nw = it.w, nh = it.h;
      if (mode === 'move') {
        el.style.transform = 'translate(' + (g0.left + dx) + 'px,' + (g0.top + dy) + 'px)';
        nx = Math.max(0, Math.min(COLS - it.w, Math.round((g0.left + dx - M) / (colW + M))));
        ny = Math.max(0, Math.round((g0.top + dy - M) / (ROW + M)));
      } else {
        el.style.width = (g0.width + dx) + 'px';
        el.style.height = (g0.height + dy) + 'px';
        nw = Math.max(1, Math.min(COLS - it.x, Math.round((g0.width + dx + M) / (colW + M))));
        nh = Math.max(1, Math.round((g0.height + dy + M) / (ROW + M)));
      }
      const pg = geom({ x: nx, y: ny, w: nw, h: nh });
      Object.assign(ph.style, { transform: 'translate(' + pg.left + 'px,' + pg.top + 'px)', width: pg.width + 'px', height: pg.height + 'px' });
      el.__next = { x: nx, y: ny, w: nw, h: nh };
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      ph.remove();
      el.classList.remove('dragging', 'resizing');
      if (el.__next) Object.assign(it, el.__next);
      save();
      render();
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  if (layout) {
    render();
    window.addEventListener('resize', render);
    // Loading skeleton for a short time, then the content.
    $$('.panel-body').forEach((b) => {
      const html = b.innerHTML;
      b.setAttribute('aria-busy', 'true');
      b.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
      setTimeout(() => { b.innerHTML = html; b.removeAttribute('aria-busy'); wireBodies(); }, 700);
    });
  }
  if (path === '/dashboard') {
    const add = $('#add-panel');
    add.hidden = false;
    add.addEventListener('click', () => { $('#add-menu').hidden = !$('#add-menu').hidden; });
    $$('#add-menu [role="menuitem"]').forEach((b) => b.addEventListener('click', () => {
      const kind = b.getAttribute('data-kind');
      layout.push({ i: kind + '-' + layout.length, x: 0, y: 16, w: 4, h: 6 });
      titles[kind + '-' + (layout.length - 1)] = kind === 'chart' ? 'Chart' : 'News';
      bodies[kind + '-' + (layout.length - 1)] = bodies[kind];
      $('#add-menu').hidden = true;
      save();
      render();
    }));
  }

  function wireBodies() {
    const details = $('#details-btn');
    if (details && !details.__w) { details.__w = 1; details.addEventListener('click', () => openDialog('modal')); }
    const form = $('#order-form');
    if (form && !form.__w) {
      form.__w = 1;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        probe('save-clicked');
        fetch('/api/save', { method: 'POST', body: new FormData(form) });
      });
      $('#delete-btn').addEventListener('click', () => {
        probe('delete-clicked');
        fetch('/api/delete', { method: 'DELETE' });
      });
    }
    $$('[role="tab"]').forEach((tab) => {
      if (tab.__w) return;
      tab.__w = 1;
      tab.addEventListener('click', () => {
        $$('[role="tab"]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
        const pinned = tab.id === 'tab-saved';
        $('#feed').hidden = pinned;
        $('#feed-empty').hidden = !pinned;
      });
    });
  }

  // ----- live data -----
  function flash(td, up, text) {
    td.textContent = text;
    td.classList.remove('flash-up', 'flash-down');
    td.classList.add(up ? 'flash-up' : 'flash-down');
    setTimeout(() => td.classList.remove('flash-up', 'flash-down'), 600);
  }
  if (path === '/dashboard' || path === '/markets') {
    const es = new EventSource('/api/stream');
    es.onmessage = (m) => {
      const d = JSON.parse(m.data);
      $$('.price[data-s="' + d.symbol + '"]').forEach((td) => flash(td, d.up, '$' + d.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
    };
  }
  if (path === '/markets') {
    fetch('/api/telemetry', { method: 'POST', body: JSON.stringify({ view: 'markets' }) });
    setInterval(() => fetch('/api/quotes'), 2000);
  }
})();
