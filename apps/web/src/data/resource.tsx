// A small cache of API reads, shared by the modules. Two modules that read the same endpoint share one request
// and one copy of the data (for example the Kanban board and the next actions both read GET /api/deals).
// A live event reloads the data in the background: the old data stays on screen until the new data comes.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { type LiveEvent, useLiveEvents } from "../live/LiveProvider";

export interface ResourceSnapshot<T> {
  data: T | undefined;
  error: string | undefined;
  /** The first load runs. No data yet. */
  loading: boolean;
  /** A reload runs. The old data stays on screen. */
  refreshing: boolean;
  /** Time of the last successful load (Date.now()). */
  updatedAt: number;
}

type Fetcher<T> = () => Promise<T>;
type Listener = () => void;

interface Entry {
  snapshot: ResourceSnapshot<unknown>;
  listeners: Set<Listener>;
  seq: number;
  inflight: Promise<void> | null;
  startedAt: number;
}

const IDLE: ResourceSnapshot<never> = Object.freeze({ data: undefined, error: undefined, loading: false, refreshing: false, updatedAt: 0 });

export class ResourceCache {
  private entries = new Map<string, Entry>();

  private entry(key: string): Entry {
    let e = this.entries.get(key);
    if (!e) {
      e = { snapshot: { data: undefined, error: undefined, loading: true, refreshing: false, updatedAt: 0 }, listeners: new Set(), seq: 0, inflight: null, startedAt: 0 };
      this.entries.set(key, e);
    }
    return e;
  }

  private set(key: string, patch: Partial<ResourceSnapshot<unknown>>) {
    const e = this.entry(key);
    e.snapshot = { ...e.snapshot, ...patch };
    e.listeners.forEach((l) => l());
  }

  snapshot<T>(key: string | null): ResourceSnapshot<T> {
    if (!key) return IDLE;
    return this.entry(key).snapshot as ResourceSnapshot<T>;
  }

  subscribe(key: string, listener: Listener): () => void {
    const e = this.entry(key);
    e.listeners.add(listener);
    return () => e.listeners.delete(listener);
  }

  /** Load when there is no data yet and no load runs. */
  ensure<T>(key: string, fetcher: Fetcher<T>) {
    const e = this.entry(key);
    if (e.snapshot.data !== undefined || e.inflight) return;
    void this.load(key, fetcher);
  }

  /** Load again. A newer load wins over an older one that ends later. */
  load<T>(key: string, fetcher: Fetcher<T>): Promise<void> {
    const e = this.entry(key);
    const seq = ++e.seq;
    e.startedAt = Date.now();
    const first = e.snapshot.data === undefined;
    this.set(key, first ? { loading: true, error: undefined } : { refreshing: true });
    const p = fetcher().then(
      (data) => {
        if (seq !== e.seq) return;
        this.set(key, { data, error: undefined, loading: false, refreshing: false, updatedAt: Date.now() });
      },
      (err: unknown) => {
        if (seq !== e.seq) return;
        const message = err instanceof Error ? err.message : "The data did not load.";
        // A failed reload keeps the old data. The error shows only when there is no data.
        this.set(key, { error: first ? message : undefined, loading: false, refreshing: false });
      },
    );
    const done = p.finally(() => {
      if (e.inflight === done) e.inflight = null;
    });
    e.inflight = done;
    return done;
  }

  /**
   * Reload for a live event. Two modules that share the key get the same event, so a load that started
   * within `windowMs` counts for both.
   */
  refresh<T>(key: string, fetcher: Fetcher<T>, windowMs = 50): Promise<void> {
    const e = this.entry(key);
    if (e.inflight && Date.now() - e.startedAt < windowMs) return e.inflight;
    return this.load(key, fetcher);
  }

  /** Change the data in place, for example after a write, before the reload comes. */
  mutate<T>(key: string, fn: (old: T | undefined) => T | undefined) {
    const e = this.entry(key);
    this.set(key, { data: fn(e.snapshot.data as T | undefined) });
  }

  clear() {
    this.entries.clear();
  }
}

const CacheContext = createContext<ResourceCache | null>(null);

export function ResourceProvider({ children, cache }: { children: ReactNode; cache?: ResourceCache }) {
  const value = useMemo(() => cache ?? new ResourceCache(), [cache]);
  return <CacheContext.Provider value={value}>{children}</CacheContext.Provider>;
}

export function useResourceCache(): ResourceCache {
  const c = useContext(CacheContext);
  if (!c) throw new Error("useResource needs a ResourceProvider");
  return c;
}

export interface ResourceOptions {
  /** Live event types that reload the data. */
  live?: readonly string[];
  batchMs?: number;
  /** Reload only for the events that pass the filter, for example the events of one deal. */
  liveFilter?: (e: LiveEvent) => boolean;
  /** Reload on an interval, in milliseconds. */
  refreshMs?: number;
}

export interface Resource<T> extends ResourceSnapshot<T> {
  reload: () => Promise<void>;
  mutate: (fn: (old: T | undefined) => T | undefined) => void;
}

/** Read a resource from the cache. A null key reads nothing. */
export function useResource<T>(key: string | null, fetcher: Fetcher<T>, options: ResourceOptions = {}): Resource<T> {
  const cache = useResourceCache();
  const fetchRef = useRef(fetcher);
  useLayoutEffect(() => {
    fetchRef.current = fetcher;
  });
  const subscribe = useCallback((l: Listener) => (key ? cache.subscribe(key, l) : () => undefined), [cache, key]);
  const getSnapshot = useCallback(() => cache.snapshot<T>(key), [cache, key]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (key) cache.ensure(key, () => fetchRef.current());
  }, [cache, key]);

  const reload = useCallback(() => (key ? cache.load(key, () => fetchRef.current()) : Promise.resolve()), [cache, key]);
  const mutate = useCallback((fn: (old: T | undefined) => T | undefined) => key && cache.mutate<T>(key, fn), [cache, key]);

  const filter = options.liveFilter;
  useLiveEvents(
    options.live ?? [],
    (events) => {
      if (!key) return;
      if (filter && !events.some(filter)) return;
      void cache.refresh(key, () => fetchRef.current());
    },
    options.batchMs,
  );

  const refreshMs = options.refreshMs;
  useEffect(() => {
    if (!key || !refreshMs) return undefined;
    const t = setInterval(() => void cache.load(key, () => fetchRef.current()), refreshMs);
    return () => clearInterval(t);
  }, [cache, key, refreshMs]);

  return useMemo(() => ({ ...snapshot, reload, mutate }), [snapshot, reload, mutate]);
}
