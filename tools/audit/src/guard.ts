// Network guard: logs each request and blocks each request that is not GET or HEAD,
// except the login request(s) during the login phase and the log out request(s) during the final log out.

import type { BrowserContext, Request, Route, WebSocketRoute } from '@playwright/test';
import { loadConfig } from './config.js';
import { endpointPattern, redactUrl } from './redact.js';
import { classifyWsFrame, words } from './safety.js';

export type Phase = 'setup' | 'login' | 'audit' | 'logout' | 'closed';

export interface RequestEntry {
  t: number;
  method: string;
  url: string;
  endpoint: string;
  resourceType: string;
  phase: Phase;
  activity: string;
  outcome: 'allowed' | 'blocked' | 'allowed-login' | 'allowed-logout';
  status?: number;
  failure?: string;
}

export interface WsEntry {
  url: string;
  opened: number;
  activity: string;
  sent: number;
  received: number;
  blockedSent: { t: number; reason: string }[];
  sentActions: Record<string, number>;
  receivedShapes: Record<string, number>;
  receivedTimes: number[];
}

export interface Secrets {
  username: string;
  password: string;
}

function frameShape(message: string | Buffer): string {
  if (typeof message !== 'string') return `binary(${message.length}B)`;
  const body = message.trim();
  const sio = body.match(/^(\d+)(?:\/[^,]*,)?\d*(\[[\s\S]*\]|\{[\s\S]*\})?$/);
  const prefix = sio ? `sio:${sio[1]} ` : '';
  const json = sio ? sio[2] : body;
  if (!json) return `${prefix}text`;
  try {
    const v = JSON.parse(json) as unknown;
    if (Array.isArray(v)) return `${prefix}[${typeof v[0] === 'string' ? JSON.stringify(v[0]) : typeof v[0]}, …]`;
    if (v && typeof v === 'object') return `${prefix}{${Object.keys(v).slice(0, 8).join(',')}}`;
    return `${prefix}${typeof v}`;
  } catch {
    return `${prefix}text`;
  }
}

export class NetworkGuard {
  phase: Phase = 'setup';
  activity = 'setup';
  readonly entries: RequestEntry[] = [];
  readonly websockets: WsEntry[] = [];
  readonly scriptBodies = new Map<string, string>();
  readonly styleBodies = new Map<string, string>();
  readonly responseHeaders = new Map<string, Record<string, string>>();
  readonly fontFiles = new Map<string, { url: string; headers: Record<string, string> }>();
  private scriptBytes = 0;
  private readonly start = Date.now();
  private readonly cfg = loadConfig().safety;
  private readonly entryByRequest = new WeakMap<Request, RequestEntry>();
  /** Set by tests to count route decisions. */
  readonly maxScriptBytes = 40 * 1024 * 1024;

  constructor(private readonly secrets: Secrets) {}

  now(): number {
    return Date.now() - this.start;
  }

  setPhase(p: Phase): void {
    this.phase = p;
  }

  setActivity(a: string): void {
    this.activity = a;
  }

  async attach(context: BrowserContext): Promise<void> {
    await context.route('**/*', (route) => this.onRoute(route));
    await context.routeWebSocket(/.*/, (ws) => this.onWebSocket(ws));
    context.on('response', (res) => {
      void this.onResponse(res).catch(() => undefined);
    });
    context.on('requestfailed', (req) => {
      const e = this.entryByRequest.get(req);
      if (e && !e.failure) e.failure = req.failure()?.errorText ?? 'failed';
    });
  }

  private isLoginRequest(req: Request): boolean {
    const body = req.postData() ?? '';
    const { username, password } = this.secrets;
    // The body is compared in memory only. It is never logged.
    const hasCreds = [password, encodeURIComponent(password), username, encodeURIComponent(username)].some((s) => s && body.includes(s));
    if (hasCreds) return true;
    return this.matchesPath(req.url(), this.cfg.loginRequestPatterns);
  }

  private matchesPath(url: string, patterns: string[]): boolean {
    let w = '';
    try {
      const u = new URL(url);
      w = words(`${u.hostname} ${u.pathname}`);
    } catch {
      w = words(url);
    }
    return patterns.some((p) => w.split(' ').includes(words(p)) || w.includes(words(p)));
  }

  private async onRoute(route: Route): Promise<void> {
    const req = route.request();
    const method = req.method().toUpperCase();
    const entry: RequestEntry = {
      t: this.now(),
      method,
      url: redactUrl(req.url()),
      endpoint: endpointPattern(req.url()),
      resourceType: req.resourceType(),
      phase: this.phase,
      activity: this.activity,
      outcome: 'allowed',
    };
    this.entries.push(entry);
    this.entryByRequest.set(req, entry);
    if (this.cfg.allowedMethods.includes(method)) {
      await route.fallback();
      return;
    }
    if (this.phase === 'login' && this.isLoginRequest(req)) {
      entry.outcome = 'allowed-login';
      await route.fallback();
      return;
    }
    if (this.phase === 'logout' && this.matchesPath(req.url(), this.cfg.logoutRequestPatterns)) {
      entry.outcome = 'allowed-logout';
      await route.fallback();
      return;
    }
    entry.outcome = 'blocked';
    await route.abort('blockedbyclient');
  }

  private onWebSocket(ws: WebSocketRoute): void {
    const entry: WsEntry = {
      url: redactUrl(ws.url()),
      opened: this.now(),
      activity: this.activity,
      sent: 0,
      received: 0,
      blockedSent: [],
      sentActions: {},
      receivedShapes: {},
      receivedTimes: [],
    };
    this.websockets.push(entry);
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const d = classifyWsFrame(message);
      if (!d.allowed) {
        entry.blockedSent.push({ t: this.now(), reason: d.reason });
        return;
      }
      entry.sent += 1;
      const shape = frameShape(message);
      entry.sentActions[shape] = (entry.sentActions[shape] ?? 0) + 1;
      server.send(message);
    });
    server.onMessage((message) => {
      entry.received += 1;
      if (entry.receivedTimes.length < 5000) entry.receivedTimes.push(this.now());
      const shape = frameShape(message);
      entry.receivedShapes[shape] = (entry.receivedShapes[shape] ?? 0) + 1;
      ws.send(message);
    });
    ws.onClose((code, reason) => server.close({ code, reason }));
    server.onClose((code, reason) => ws.close({ code, reason }));
  }

  private async onResponse(res: import('@playwright/test').Response): Promise<void> {
    const req = res.request();
    const e = this.entryByRequest.get(req);
    if (e) e.status = res.status();
    const type = req.resourceType();
    const headers = res.headers();
    // Never keep cookies or authorization values.
    const safeHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (/^(set-cookie|cookie|authorization|proxy-authorization|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i.test(k)) continue;
      safeHeaders[k] = v;
    }
    if (type === 'document' && this.responseHeaders.size < 50) this.responseHeaders.set(redactUrl(req.url()), safeHeaders);
    if (type === 'font') this.fontFiles.set(redactUrl(req.url()), { url: redactUrl(req.url()), headers: safeHeaders });
    if ((type === 'script' || type === 'stylesheet') && res.ok() && this.scriptBytes < this.maxScriptBytes) {
      try {
        const body = await res.text();
        this.scriptBytes += body.length;
        (type === 'script' ? this.scriptBodies : this.styleBodies).set(req.url(), body);
      } catch {
        // Body not available (for example a redirect).
      }
    }
  }

  nonGet(): RequestEntry[] {
    return this.entries.filter((e) => !this.cfg.allowedMethods.includes(e.method));
  }

  blockedSince(t: number): RequestEntry[] {
    return this.entries.filter((e) => e.t >= t && e.outcome === 'blocked');
  }

  /** Criterion 6: no request that changes data reached the server, other than login (and the final log out). */
  criterion6(): { pass: boolean; offending: RequestEntry[]; blockedWs: number } {
    const offending = this.nonGet().filter((e) => e.outcome === 'allowed');
    const blockedWs = this.websockets.reduce((n, w) => n + w.blockedSent.length, 0);
    return { pass: offending.length === 0, offending, blockedWs };
  }
}
