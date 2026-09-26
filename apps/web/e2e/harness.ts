// Test harness: a mocked Strata API through Playwright route interception, over a fixture dataset.
// No real API or Keycloak runs. The fake EventSource lets a test push live events (window.__liveEmit).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { buildDataset, type Dataset } from "./fixtures/dataset";
import { type LiveOut, MockApi, type Role } from "./mock-api";

export type { Role } from "./mock-api";
export type DatasetName = "small" | "large" | "empty";

export interface ApiLog {
  calls: string[];
  /** Request bodies of the writes, in order. */
  writes: Array<{ path: string; body: unknown }>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
let large: Dataset | null = null;

/** The small dataset is the committed JSON. The large dataset (10 000 signals, 500 deals) is built once per worker. */
export function loadDataset(name: DatasetName): Dataset {
  if (name === "large") {
    large ??= buildDataset({ signals: 10000, deals: 500 });
    return structuredClone(large);
  }
  const small = JSON.parse(readFileSync(join(HERE, "fixtures", "small-dataset.json"), "utf8")) as Dataset;
  if (name === "empty") {
    return { ...small, signals: [], alerts: [], drivers: [], projects: [], deals: [], relationships: [], engagement: [], proposals: [], quarantine: [], sites: [], sources: [], knownGaps: [], events: [] };
  }
  return small;
}

/** Push live events into the page, as the API does after a database commit. */
export async function emitLive(page: Page, events: LiveOut[]) {
  if (!events.length) return;
  await page.evaluate((evs) => {
    const emit = (window as unknown as { __liveEmit?: (t: string, d: unknown) => void }).__liveEmit;
    evs.forEach((e) => emit?.(e.type, e.data));
  }, events);
}

export const test = base.extend<{ role: Role; dataset: DatasetName; autoLive: boolean; mock: MockApi; api: ApiLog }>({
  role: ["analyst", { option: true }],
  dataset: ["small", { option: true }],
  /** Send the live events of each write back to the page, as the database trigger does. */
  autoLive: [true, { option: true }],
  mock: async ({ role, dataset }, provide) => {
    await provide(new MockApi(loadDataset(dataset), role, `e2e-${role}`));
  },
  api: [
    async ({ page, role, mock, autoLive }, use) => {
      const log: ApiLog = { calls: [], writes: [] };
      // Only the API paths. Source files such as /src/api/http.ts must reach the dev server.
      await page.route((u) => u.pathname.startsWith("/api/"), async (route) => {
        const req = route.request();
        const url = new URL(req.url());
        log.calls.push(`${req.method()} ${url.pathname}`);
        const auth = req.headers()["authorization"] ?? url.searchParams.get("access_token") ?? "";
        if (!auth) return route.fulfill({ status: 401, json: { detail: "missing bearer token" } });
        switch (`${req.method()} ${url.pathname}`) {
          case "GET /api/me":
            return route.fulfill({
              json: { id: `e2e-${role}`, email: `${role}@example.com`, name: `E2E ${role[0]!.toUpperCase()}${role.slice(1)}`, roles: [role], role },
            });
          case "POST /api/session/login":
            return route.fulfill({ json: { status: "logged_in", role } });
          case "POST /api/session/logout":
            return route.fulfill({ json: { status: "logged_out" } });
          case "GET /api/live":
            return route.fulfill({
              status: 200,
              headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
              body: `event: hello\ndata: {"user":"e2e-${role}"}\n\nevent: ping\ndata: {}\n\n`,
            });
          default: {
            let body: unknown = undefined;
            if (req.method() === "POST") {
              try {
                body = req.postDataJSON();
              } catch {
                body = undefined;
              }
              log.writes.push({ path: url.pathname, body });
            }
            const res = mock.handle(req.method(), url.pathname, url.searchParams, body);
            await route.fulfill({ status: res.status, json: res.json });
            if (autoLive && res.live?.length) {
              try {
                await emitLive(page, res.live);
              } catch {
                // The page can be gone at the end of a test.
              }
            }
            return undefined;
          }
        }
      });
      // A fake EventSource that stays open. Tests push live events with window.__liveEmit(type, data).
      await page.addInitScript(() => {
        type Listener = (e: { data: string }) => void;
        const w = window as unknown as Record<string, unknown>;
        const sources: FakeEventSource[] = [];
        w.__liveUrls = [] as string[];
        class FakeEventSource {
          url: string;
          onopen: ((e: Event) => void) | null = null;
          onerror: ((e: Event) => void) | null = null;
          closed = false;
          private listeners: Record<string, Listener[]> = {};
          constructor(url: string) {
            this.url = url;
            (w.__liveUrls as string[]).push(url);
            sources.push(this);
            setTimeout(() => {
              this.onopen?.(new Event("open"));
              this.emit("hello", JSON.stringify({ user: "e2e" }));
            }, 0);
          }
          addEventListener(type: string, fn: Listener) {
            (this.listeners[type] ??= []).push(fn);
          }
          emit(type: string, data: string) {
            if (!this.closed) (this.listeners[type] ?? []).forEach((fn) => fn({ data }));
          }
          close() {
            this.closed = true;
          }
        }
        w.EventSource = FakeEventSource;
        w.__liveEmit = (type: string, data: unknown) => sources.forEach((s) => s.emit(type, JSON.stringify(data)));
      });
      await use(log);
    },
    { auto: true },
  ],
});

export { expect };

/** Open the app at a workspace and wait for the grid. */
export async function openWorkspace(page: Page, workspace = "origination") {
  await page.goto(`/w/${workspace}`);
  await expect(page.locator(`[data-workspace-id="${workspace}"]`)).toBeVisible();
  await expect(page.locator(".react-grid-item").first()).toBeVisible();
}

export const panel = (page: Page, id: string): Locator => page.locator(`[data-panel-id="${id}"]`);

/** The module inside a panel, after it has its data (not loading). */
export async function moduleReady(page: Page, id: string, scope: Locator | Page = page) {
  const m = scope.locator(`[data-module="${id}"]`).first();
  await expect(m).toBeVisible();
  await expect(m).not.toHaveAttribute("data-module-state", "loading", { timeout: 15_000 });
  return m;
}

/** Add a panel to the open workspace through the panel picker. */
export async function addPanel(page: Page, id: string) {
  await page.getByRole("button", { name: "Add panel" }).first().click();
  await page.getByRole("dialog", { name: "Add panel" }).locator(`[data-module-id="${id}"]`).click();
  await expect(panel(page, id)).toBeVisible();
}

export async function grid(page: Page, id: string) {
  const el = panel(page, id);
  const [x, y, w, h] = await Promise.all(["data-x", "data-y", "data-w", "data-h"].map((a) => el.getAttribute(a)));
  return { x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
}
