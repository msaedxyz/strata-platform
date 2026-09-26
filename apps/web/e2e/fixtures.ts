// Test fixtures: a mocked Strata API through Playwright route interception. No real API or Keycloak runs.
import { test as base, expect, type Locator, type Page } from "@playwright/test";

export type Role = "viewer" | "analyst" | "approver" | "admin";

export interface ApiLog {
  calls: string[];
}

export const test = base.extend<{ role: Role; api: ApiLog }>({
  role: ["analyst", { option: true }],
  api: [
    async ({ page, role }, use) => {
    const log: ApiLog = { calls: [] };
    await page.route("**/api/**", async (route) => {
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
        default:
          return route.fulfill({ status: 404, json: { detail: "not mocked" } });
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

export async function grid(page: Page, id: string) {
  const el = panel(page, id);
  const [x, y, w, h] = await Promise.all(["data-x", "data-y", "data-w", "data-h"].map((a) => el.getAttribute(a)));
  return { x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
}
