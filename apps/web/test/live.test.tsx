import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LiveConnection, LiveProvider, useLive, useLiveStatus } from "../src/live/LiveProvider";

class FakeSource {
  static all: FakeSource[] = [];
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;
  listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
  constructor(public url: string) {
    FakeSource.all.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  emit(type: string, data: unknown) {
    (this.listeners[type] ?? []).forEach((fn) => fn({ data: JSON.stringify(data) } as MessageEvent));
  }
  close() {
    this.closed = true;
  }
}

function setup(token = "t1") {
  FakeSource.all = [];
  const statuses: string[] = [];
  let current = token;
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const conn = new LiveConnection({
    url: "/api/live",
    getToken: () => current,
    onStatus: (s) => statuses.push(s),
    factory: (u) => new FakeSource(u),
    reconnect: { initialMs: 1000, maxMs: 4000, factor: 2 },
    timers: { set: (fn, ms) => timers.push({ fn, ms }), clear: () => undefined },
  });
  return { conn, statuses, timers, setToken: (t: string) => (current = t) };
}

describe("LiveConnection", () => {
  it("connects to /api/live with the access token in the query", () => {
    const { conn } = setup("abc def");
    conn.start();
    expect(FakeSource.all[0]!.url).toBe("/api/live?access_token=abc%20def");
  });

  it("gives each event to the subscribers of its type", () => {
    const { conn } = setup();
    const alerts = vi.fn();
    const all = vi.fn();
    conn.subscribe("AlertRaised", alerts);
    conn.subscribe("*", all);
    conn.start();
    FakeSource.all[0]!.emit("AlertRaised", { id: "a1" });
    FakeSource.all[0]!.emit("SignalScored", { id: "s1" });
    expect(alerts).toHaveBeenCalledWith({ id: "a1" }, "AlertRaised");
    expect(alerts).toHaveBeenCalledTimes(1);
    expect(all).toHaveBeenCalledWith({ id: "a1" }, "AlertRaised");
  });

  it("subscribes to a new type on the open connection", () => {
    const { conn } = setup();
    conn.start();
    const late = vi.fn();
    conn.subscribe("DealStageChanged", late);
    FakeSource.all[0]!.emit("DealStageChanged", { id: "d1" });
    expect(late).toHaveBeenCalledTimes(1);
  });

  it("reconnects with a growing delay and a fresh token, and keeps the subscribers", () => {
    const { conn, statuses, timers, setToken } = setup("old");
    const handler = vi.fn();
    conn.subscribe("AlertRaised", handler);
    conn.start();
    FakeSource.all[0]!.onopen?.(new Event("open"));
    expect(statuses).toEqual(["open"]);
    FakeSource.all[0]!.onerror?.(new Event("error"));
    expect(FakeSource.all[0]!.closed).toBe(true);
    expect(statuses.at(-1)).toBe("reconnecting");
    expect(timers.map((t) => t.ms)).toEqual([1000]);
    setToken("new");
    timers[0]!.fn();
    expect(FakeSource.all[1]!.url).toContain("access_token=new");
    FakeSource.all[1]!.onerror?.(new Event("error"));
    timers[1]!.fn();
    FakeSource.all[2]!.onerror?.(new Event("error"));
    timers[2]!.fn();
    FakeSource.all[3]!.onerror?.(new Event("error"));
    expect(timers.map((t) => t.ms)).toEqual([1000, 2000, 4000, 4000]);
    FakeSource.all[3]!.onopen?.(new Event("open"));
    FakeSource.all[3]!.onerror?.(new Event("error"));
    expect(timers.at(-1)!.ms).toBe(1000);
    timers.at(-1)!.fn();
    FakeSource.all.at(-1)!.emit("AlertRaised", { id: "x" });
    expect(handler).toHaveBeenCalledWith({ id: "x" }, "AlertRaised");
  });

  it("stops and does not reconnect", () => {
    const { conn, timers } = setup();
    conn.start();
    conn.stop();
    expect(FakeSource.all[0]!.closed).toBe(true);
    FakeSource.all[0]!.onerror?.(new Event("error"));
    expect(timers).toHaveLength(0);
  });
});

describe("useLive", () => {
  it("dispatches events to components and shows the status", async () => {
    FakeSource.all = [];
    const received = vi.fn();
    function Probe() {
      const status = useLiveStatus();
      useLive("SignalScored", received);
      return <span>status {status}</span>;
    }
    render(
      <LiveProvider getToken={() => "tok"} factory={(u) => new FakeSource(u)}>
        <Probe />
      </LiveProvider>,
    );
    expect(screen.getByText("status connecting")).toBeInTheDocument();
    const src = FakeSource.all.at(-1)!;
    act(() => src.onopen?.(new Event("open")));
    expect(screen.getByText("status open")).toBeInTheDocument();
    act(() => src.emit("SignalScored", { id: "s9" }));
    expect(received).toHaveBeenCalledWith({ id: "s9" }, "SignalScored");
  });
});
