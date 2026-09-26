// Live updates over Server Sent Events (docs/02 default, /api/live). The connection reconnects with a growing delay
// and gives each event to the subscribers of its type.
import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { appConfig } from "../config/app.config";

export type LiveStatus = "connecting" | "open" | "reconnecting";
export type LiveHandler = (data: unknown, type: string) => void;

interface EventSourceLike {
  addEventListener(type: string, listener: (e: MessageEvent) => void): void;
  close(): void;
  onopen: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface LiveConnectionOptions {
  url: string;
  getToken: () => string | null;
  onStatus: (s: LiveStatus) => void;
  factory?: EventSourceFactory;
  reconnect?: { initialMs: number; maxMs: number; factor: number };
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void };
}

/** The live connection without React. It keeps the subscribers and connects again after an error. */
export class LiveConnection {
  private source: EventSourceLike | null = null;
  private readonly handlers = new Map<string, Set<LiveHandler>>();
  private readonly bound = new Set<string>();
  private delay: number;
  private timer: unknown = null;
  private stopped = false;
  attempts = 0;

  constructor(private readonly opts: LiveConnectionOptions) {
    this.delay = this.reconnect.initialMs;
  }

  private get reconnect() {
    return this.opts.reconnect ?? {
      initialMs: appConfig.live.reconnectInitialMs,
      maxMs: appConfig.live.reconnectMaxMs,
      factor: appConfig.live.reconnectFactor,
    };
  }

  private get timers() {
    return this.opts.timers ?? { set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (id: unknown) => clearTimeout(id as number) };
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.source?.close();
    this.source = null;
  }

  subscribe(type: string, handler: LiveHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    this.bind(type);
    return () => {
      set.delete(handler);
    };
  }

  /** Give an event to the subscribers. The EventSource listener calls it. Tests call it too. */
  dispatch(type: string, raw: string) {
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      // Not JSON. Give the text.
    }
    this.handlers.get(type)?.forEach((h) => h(data, type));
    this.handlers.get("*")?.forEach((h) => h(data, type));
  }

  private bind(type: string) {
    if (!this.source || this.bound.has(type) || type === "*") return;
    this.bound.add(type);
    this.source.addEventListener(type, (e) => this.dispatch(type, String(e.data)));
  }

  private connect() {
    if (this.stopped) return;
    this.attempts += 1;
    const token = this.opts.getToken();
    const url = token ? `${this.opts.url}?access_token=${encodeURIComponent(token)}` : this.opts.url;
    const factory = this.opts.factory ?? ((u: string) => new EventSource(u) as unknown as EventSourceLike);
    const source = factory(url);
    this.source = source;
    this.bound.clear();
    source.onopen = () => {
      this.delay = this.reconnect.initialMs;
      this.opts.onStatus("open");
    };
    source.onerror = () => {
      // EventSource retries by itself with a fixed delay. Strata closes it and retries with a growing delay and a new token.
      source.close();
      if (this.source !== source || this.stopped) return;
      this.opts.onStatus("reconnecting");
      const wait = this.delay;
      this.delay = Math.min(this.delay * this.reconnect.factor, this.reconnect.maxMs);
      this.timer = this.timers.set(() => {
        this.timer = null;
        this.connect();
      }, wait);
    };
    // The connection listens to the types that have subscribers. "*" subscribers get the events of those types.
    for (const type of ["hello", "ping", "message", ...this.handlers.keys()]) this.bind(type);
  }
}

interface LiveContextValue {
  status: LiveStatus;
  connection: LiveConnection | null;
}

const LiveContext = createContext<LiveContextValue>({ status: "connecting", connection: null });

export function LiveProvider({ getToken, children, factory }: { getToken: () => string | null; children: ReactNode; factory?: EventSourceFactory }) {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [connection, setConnection] = useState<LiveConnection | null>(null);
  useEffect(() => {
    const c = new LiveConnection({ url: appConfig.api.livePath, getToken, onStatus: setStatus, factory });
    setConnection(c);
    c.start();
    return () => c.stop();
  }, [getToken, factory]);
  const value = useMemo(() => ({ status, connection }), [status, connection]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/** Subscribe to live events of one type ("*" for every type). */
export function useLive(type: string, handler: LiveHandler) {
  const { connection } = useContext(LiveContext);
  const saved = useRef(handler);
  useLayoutEffect(() => {
    saved.current = handler;
  });
  useEffect(() => {
    if (!connection) return undefined;
    return connection.subscribe(type, (d, t) => saved.current(d, t));
  }, [connection, type]);
}

export function useLiveStatus(): LiveStatus {
  return useContext(LiveContext).status;
}
