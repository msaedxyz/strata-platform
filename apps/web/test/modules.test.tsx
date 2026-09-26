// Unit tests for the M6 module layer: the read cache, live batching, the API helpers, the module configuration
// and the formats. The end to end tests (e2e/) test the modules in the browser.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createHttp, toQueryString } from "../src/api/http";
import { liveEvents, moduleConfig, sharedResources } from "../src/config/modules";
import { ResourceCache, ResourceProvider, useResource } from "../src/data/resource";
import { type LiveEvent, LiveProvider, useLiveEvents } from "../src/live/LiveProvider";
import { ACTIONS } from "../src/modules/common/actions";
import { toEvidence } from "../src/modules/common/api";
import { certaintyStatus, formatDuration, formatLeadTime, humanise, nameOf, tierBadge } from "../src/modules/common/format";
import { breakdownBars } from "../src/modules/PriorityListModule";
import { windowOrders } from "../src/modules/ProjectPipelineModule";
import { MODULE_COMPONENTS, MODULE_IDS } from "../src/modules/registry";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("module registry (docs/07 criterion 8)", () => {
  it("has a real component for each module, and no placeholder", () => {
    for (const id of MODULE_IDS) expect(MODULE_COMPONENTS[id], id).toBeTypeOf("function");
    expect(Object.keys(MODULE_COMPONENTS).sort()).toEqual([...MODULE_IDS].sort());
  });
});

describe("module configuration (docs/07 rule 4 of the task: config in src/config/modules.ts)", () => {
  const schemaEvents = new Set([...readFileSync(join(ROOT, "config", "event-schemas.yaml"), "utf8").matchAll(/^ {2}([A-Z][A-Za-z]+):/gm)].map((m) => m[1]!));
  // Live messages that are not events: collector runs (a strata_live notification).
  const notEvents = new Set(["collector_run"]);

  it("lists only event types from config/event-schemas.yaml", () => {
    for (const [id, c] of Object.entries(moduleConfig)) {
      for (const e of c.live?.events ?? []) if (!notEvents.has(e)) expect(schemaEvents.has(e), `${id}: ${e}`).toBe(true);
    }
    for (const e of sharedResources.deals.live.events) expect(schemaEvents.has(e), e).toBe(true);
  });

  it("makes the modules that docs/07 marks live listen to events, and keeps the timeline, quarantine and brief editor not live", () => {
    for (const id of ["ticker", "tier0-alerts", "demand-drivers", "site-watch-list", "signal-feed", "deal-map", "kanban", "priority-list", "project-pipeline", "procurement-calendar", "relationship-panel", "approval-queue", "source-health", "alert-telemetry", "next-actions"] as const)
      expect(liveEvents(id).length, id).toBeGreaterThan(0);
    for (const id of ["timeline", "quarantine", "brief-editor"] as const) expect(liveEvents(id)).toEqual([]);
  });

  it("gives the deals read the engagement events, so the next actions update after Set next action", () => {
    expect(sharedResources.deals.live.events).toContain("NextActionSet");
    expect(sharedResources.deals.live.events).toContain("DealStageChanged");
  });
});

describe("action names (docs/07 rule 5, docs/api-contract.md)", () => {
  it("uses the contract table: button and message", () => {
    const table: Record<string, string> = {
      Approve: "Approved",
      Reject: "Rejected",
      "Edit and approve": "Edited and approved",
      Acknowledge: "Acknowledged",
      Confirm: "Confirmed",
      Dismiss: "Dismissed",
      "Move to stage": "Moved, pending approval",
      "Add contact": "Contact added",
      "Log touchpoint": "Touchpoint logged",
      "Set next action": "Next action set",
      Activate: "Activated",
    };
    const actual = Object.fromEntries(Object.values(ACTIONS).map((a) => [a.button, a.done]));
    for (const [button, done] of Object.entries(table)) expect(actual[button], button).toBe(done);
  });
});

describe("http helpers", () => {
  it("repeats keys for lists and leaves out empty values", () => {
    expect(toQueryString({ tier: [0, 1], sector: undefined, q: "", limit: 10 })).toBe("?tier=0&tier=1&limit=10");
    expect(toQueryString({})).toBe("");
  });

  it("sends the bearer token and gives the FastAPI detail as the error message", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: "you cannot approve a proposal that you created" }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const http = createHttp(() => "tok");
    await expect(http.post("/api/proposals/p1/approve")).rejects.toMatchObject({ status: 403, message: "you cannot approve a proposal that you created" });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    vi.unstubAllGlobals();
  });
});

describe("evidence (docs/07 rule 1)", () => {
  const base = { id: "e1", source_id: "s1", char_start: 10, char_end: 20, verified: true, url: "https://x.test/a", title: "T", publisher: "P", published_at: "2026-09-20T10:00:00Z", read_at_source: false, excerpt: null, type: "web" };
  it("splits the context of a full licence source around the quote", () => {
    const e = toEvidence({ ...base, quote: "the quote", retention_policy: "full", context: "Before text the quote after text." });
    expect(e).toMatchObject({ quote: "the quote", before: "Before text ", after: " after text.", sourceUrl: "https://x.test/a", publisher: "P" });
  });
  it("gives the quote only when the licence is not full", () => {
    const e = toEvidence({ ...base, quote: "the quote", retention_policy: "verify_then_purge", context: null });
    expect(e.before).toBeUndefined();
    expect(e.after).toBeUndefined();
  });
});

describe("formats and module helpers", () => {
  it("formats codes, durations, lead times, tiers and certainty", () => {
    expect(humanise("care_and_maintenance")).toBe("Care and maintenance");
    expect(humanise("DealStageChanged")).toBe("Deal stage changed");
    expect(nameOf([{ code: "qualified", name: "Qualified" }], "qualified")).toBe("Qualified");
    expect(formatDuration(250)).toBe("4 min 10 s");
    expect(formatLeadTime(365)).toBe("12 months");
    expect(tierBadge(0)).toEqual({ label: "T0", tone: "accent" });
    // docs/07 rule 4: reported and speculative claims use the one unverified style.
    expect(certaintyStatus("reported")).toBe("reported");
    expect(certaintyStatus("speculative")).toBe("unconfirmed");
    expect(certaintyStatus("stated")).toBeUndefined();
  });

  it("reads the priority breakdown as numbers or as parts with a score", () => {
    const bars = breakdownBars({ lead_time: 0.3, demand: { score: 0.2, weight: 0.3 }, total: 0.9, buyer_fit: { contribution: 0.1 } });
    expect(bars.map((b) => [b.label, b.value])).toEqual([
      ["Lead time", 0.3],
      ["Demand estimate", 0.2],
      ["Buyer fit", 0.1],
    ]);
  });

  it("finds the engagement window stages from the configuration", () => {
    const stages = {
      deal_stages: [],
      restart_path: [],
      procurement_stage: "contractor_procurement",
      engagement_window: { from: "feasibility", to: "financing_fid" },
      lifecycle_stages: [
        { code: "feasibility", name: "F", order: 4 },
        { code: "financing_fid", name: "FID", order: 8 },
      ],
    };
    expect(windowOrders(stages)).toEqual([4, 8]);
  });
});

describe("ResourceCache", () => {
  it("shares one load for one key, keeps the data during a reload, and lets a newer load win", async () => {
    const cache = new ResourceCache();
    let n = 0;
    const fetcher = vi.fn(async () => ++n);
    cache.ensure("k", fetcher);
    cache.ensure("k", fetcher);
    await vi.waitFor(() => expect(cache.snapshot("k").data).toBe(1));
    expect(fetcher).toHaveBeenCalledTimes(1);

    let resolveSlow: (v: number) => void = () => undefined;
    const slow = cache.load("k", () => new Promise<number>((r) => (resolveSlow = r)));
    expect(cache.snapshot("k")).toMatchObject({ data: 1, refreshing: true, loading: false });
    await cache.load("k", async () => 3);
    resolveSlow(2);
    await slow;
    expect(cache.snapshot("k").data).toBe(3);
  });

  it("shows an error only when there is no data; a failed reload keeps the old data", async () => {
    const cache = new ResourceCache();
    await cache.load("a", async () => {
      throw new Error("down");
    });
    expect(cache.snapshot("a")).toMatchObject({ error: "down", data: undefined });
    await cache.load("b", async () => "ok");
    await cache.load("b", async () => {
      throw new Error("down");
    });
    expect(cache.snapshot("b")).toMatchObject({ error: undefined, data: "ok" });
  });
});

class FakeSource {
  static all: FakeSource[] = [];
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
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
  close() {}
}

describe("live batching (docs/07 criterion 7)", () => {
  it("gives a burst of events in one call after the batch window", async () => {
    vi.useFakeTimers();
    FakeSource.all = [];
    const batches: LiveEvent[][] = [];
    function Probe() {
      useLiveEvents(["SignalScored", "AlertRaised"], (evs) => batches.push(evs), 200);
      return null;
    }
    render(
      <LiveProvider getToken={() => "t"} factory={(u) => new FakeSource(u)}>
        <Probe />
      </LiveProvider>,
    );
    await act(async () => undefined);
    const src = FakeSource.all[FakeSource.all.length - 1]!;
    act(() => {
      for (let i = 0; i < 20; i++) src.emit("SignalScored", { id: `e${i}`, stream_type: "signal", stream_id: `s${i}`, event_type: "SignalScored" });
      src.emit("AlertRaised", { id: "a", stream_type: "alert", stream_id: "a1", event_type: "AlertRaised" });
    });
    expect(batches).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(210);
    });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(21);
    expect(batches[0]![20]).toMatchObject({ type: "AlertRaised", stream_id: "a1" });
    vi.useRealTimers();
  });

  it("reloads a resource once for a batch of live events and keeps the old data on screen", async () => {
    FakeSource.all = [];
    let n = 0;
    const fetcher = vi.fn(async () => ++n);
    function Probe() {
      const r = useResource("count", fetcher, { live: ["SignalScored"], batchMs: 10 });
      return <p>{r.data === undefined ? "loading" : `value ${r.data}`}</p>;
    }
    render(
      <LiveProvider getToken={() => "t"} factory={(u) => new FakeSource(u)}>
        <ResourceProvider>
          <Probe />
        </ResourceProvider>
      </LiveProvider>,
    );
    await screen.findByText("value 1");
    const src = FakeSource.all[FakeSource.all.length - 1]!;
    act(() => {
      for (let i = 0; i < 5; i++) src.emit("SignalScored", { id: `e${i}` });
    });
    await screen.findByText("value 2");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
