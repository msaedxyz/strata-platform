// A small local site that looks like a dashboard, for the audit tests.
// It has a login form, a navigation with a hover menu, panels in a react-grid-layout style grid,
// a ticker, a table, a modal, a form with Save and Delete buttons, live updates (SSE and polling)
// and pages that the audit must not capture (billing, API keys, profile).
// The server records every request, so that tests can prove what the audit did and did not send.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const APP_ROUTES = ['/dashboard', '/markets', '/news', '/reports', '/billing', '/account/api-keys', '/account/profile', '/alerts/new'];

export interface LoggedRequest {
  t: number;
  method: string;
  path: string;
  authenticated: boolean;
}

export interface MockServer {
  url: string;
  requests: LoggedRequest[];
  probes: string[];
  close: () => Promise<void>;
}

function send(res: http.ServerResponse, status: number, body: string, type = 'text/html; charset=utf-8', headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  res.end(body);
}

export function startMockServer(opts: { username: string; password: string; port?: number }): Promise<MockServer> {
  const sessions = new Set<string>();
  const requests: LoggedRequest[] = [];
  const probes: string[] = [];
  const start = Date.now();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const cookie = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    const authed = !!cookie && sessions.has(cookie);
    requests.push({ t: Date.now() - start, method: req.method ?? 'GET', path: url.pathname, authenticated: authed });
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const p = url.pathname;
      if (req.method === 'POST' && p === '/api/login') {
        let ok = false;
        try {
          const j = JSON.parse(body) as { username?: string; password?: string };
          ok = j.username === opts.username && j.password === opts.password;
        } catch {
          ok = false;
        }
        if (!ok) return send(res, 401, '{"ok":false}', 'application/json');
        const sid = randomUUID();
        sessions.add(sid);
        return send(res, 200, '{"ok":true}', 'application/json', { 'set-cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax` });
      }
      if (req.method === 'POST' && p === '/api/logout') {
        if (cookie) sessions.delete(cookie);
        return send(res, 200, '{"ok":true}', 'application/json', { 'set-cookie': 'sid=; Path=/; Max-Age=0' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        // Any other write. The audit must never let one through.
        return send(res, 200, '{"ok":true}', 'application/json');
      }
      if (p.startsWith('/__probe/')) {
        probes.push(p.slice('/__probe/'.length));
        return send(res, 204, '');
      }
      if (p === '/login') return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'login.html'), 'utf8'));
      if (p === '/app.js' || p === '/login.js') return send(res, 200, fs.readFileSync(path.join(PUBLIC, p.slice(1)), 'utf8'), 'text/javascript; charset=utf-8');
      if (p === '/app.css') return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'app.css'), 'utf8'), 'text/css; charset=utf-8');
      if (p === '/favicon.ico') return send(res, 204, '');
      if (p === '/') return send(res, 302, '', 'text/plain', { location: authed ? '/dashboard' : '/login' });
      if (APP_ROUTES.includes(p.replace(/\/$/, ''))) {
        if (!authed) return send(res, 302, '', 'text/plain', { location: `/login?next=${encodeURIComponent(p)}` });
        return send(res, 200, fs.readFileSync(path.join(PUBLIC, 'app.html'), 'utf8'));
      }
      if (!authed && p.startsWith('/api/')) return send(res, 401, '{"error":"unauthenticated"}', 'application/json');
      if (p === '/api/me') return send(res, 200, JSON.stringify({ name: opts.username }), 'application/json');
      if (p === '/api/quotes') {
        const q = ['CU', 'CO', 'AU', 'DSL'].map((s, i) => ({ symbol: s, price: 1000 + i * 250 + Math.round(Math.random() * 100) / 10 }));
        return send(res, 200, JSON.stringify(q), 'application/json');
      }
      if (p === '/api/search') {
        const q = (url.searchParams.get('q') ?? '').toUpperCase();
        const all = ['CU Copper', 'CO Cobalt', 'AU Gold', 'DSL Diesel', 'HELP Help'];
        return send(res, 200, JSON.stringify(all.filter((x) => x.includes(q))), 'application/json');
      }
      if (p === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        let n = 0;
        const timer = setInterval(() => {
          n += 1;
          res.write(`data: ${JSON.stringify({ symbol: ['CU', 'CO', 'AU', 'DSL'][n % 4], price: 1000 + (n % 4) * 250 + (n % 7) * 1.5, up: n % 2 === 0 })}\n\n`);
        }, 800);
        res.on('close', () => clearInterval(timer));
        return;
      }
      return send(res, 404, 'not found', 'text/plain');
    });
  });
  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        requests,
        probes,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const username = process.env.INFORA_USERNAME ?? 'demo';
  const password = process.env.INFORA_PASSWORD ?? 'demo-pass';
  startMockServer({ username, password, port: Number(process.env.PORT ?? 4173) }).then((s) => process.stdout.write(`Mock site on ${s.url}/dashboard\n`));
}
