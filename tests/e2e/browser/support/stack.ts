// Helpers for the browser tests on the running stack: tokens from Keycloak (password grant, dev users only),
// API calls for the set-up steps, the real login page, and module locators.
// The password of the dev users comes from STRATA_DEV_USER_PASSWORD or from .env. The tests never print it.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const API_URL = process.env.E2E_API_URL ?? "http://localhost:8000";
export const KEYCLOAK_URL = process.env.E2E_KEYCLOAK_URL ?? "http://localhost:8080";
export const WEB_ORIGIN = new URL(process.env.E2E_WEB_URL ?? "http://localhost:8088").origin;

export type User = "viewer" | "analyst" | "analyst2" | "approver" | "approver2" | "admin";

function devPassword(): string {
  if (process.env.STRATA_DEV_USER_PASSWORD) return process.env.STRATA_DEV_USER_PASSWORD;
  const file = process.env.E2E_ENV_FILE ?? join(REPO_ROOT, ".env");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.startsWith("STRATA_DEV_USER_PASSWORD=")) return line.slice("STRATA_DEV_USER_PASSWORD=".length).trim();
    }
  }
  throw new Error("STRATA_DEV_USER_PASSWORD is not set and .env has no value. Run make setup first.");
}

const tokens = new Map<User, { token: string; until: number }>();

export async function token(user: User): Promise<string> {
  const cached = tokens.get(user);
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: "strata-web",
    username: `${user}@strata.local`,
    password: devPassword(),
    scope: "openid",
  });
  const res = await fetchOnce(`${KEYCLOAK_URL}/realms/strata/protocol/openid-connect/token`, { method: "POST", body });
  if (!res.ok) throw new Error(`Keycloak refused the password grant for ${user}: HTTP ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokens.set(user, { token: json.access_token, until: Date.now() + json.expires_in * 1000 });
  return json.access_token;
}

/**
 * fetch with one retry on a network error (not on an HTTP error). Node reuses keep-alive sockets. A socket
 * that the server closed a moment before gives "fetch failed". Only safe requests use this: GET and the
 * token request, which has no side effect.
 */
async function fetchOnce(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    return await fetch(url, init);
  }
}

export async function apiGet<T = any>(path: string, user: User = "viewer"): Promise<T> {
  const res = await fetchOnce(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${await token(user)}` } });
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function apiPost<T = any>(path: string, user: User, body?: unknown): Promise<{ status: number; json: T }> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token(user)}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as T };
}

export async function waitFor<T>(what: string, check: () => Promise<T | null | undefined | false>, timeoutMs = 300_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      const value = await check();
      if (value) return value;
    } catch (e) {
      last = e;
    }
    if (Date.now() > until) throw new Error(`timeout: ${what}${last ? ` (last error: ${String(last)})` : ""}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export interface Signal { id: string; source_id: string; url: string; title: string; tier: number }
export interface Proposal { id: string; kind: string; status: string; title: string; source_id: string; stream_id: string; events: Array<{ payload: Record<string, unknown> }> }
export interface Deal { id: string; title: string; stage: string; stage_pending: string | null; pending_proposal_id?: string | null }

export async function signalByUrl(urlPart: string, q: string): Promise<Signal> {
  return waitFor(`a signal for ${urlPart}`, async () => {
    const res = await apiGet<{ items: Signal[] }>(`/api/signals?limit=1000&q=${encodeURIComponent(q)}`);
    return res.items.find((s) => s.url.includes(urlPart));
  });
}

export async function proposalsOf(sourceId: string, kind?: string): Promise<Proposal[]> {
  const res = await apiGet<{ items: Proposal[] }>(`/api/proposals?limit=500${kind ? `&kind=${kind}` : ""}`);
  return res.items.filter((p) => p.source_id === sourceId);
}

/** An approver approves the DealIdentified proposal of a fixture document. Returns the deal. */
export async function approvedDeal(urlPart: string, q: string, titlePrefix: string): Promise<Deal> {
  const signal = await signalByUrl(urlPart, q);
  const proposal = await waitFor(`a DealIdentified proposal ${titlePrefix}`, async () =>
    (await proposalsOf(signal.source_id, "DealIdentified")).find((p) => p.title.startsWith(titlePrefix)));
  if (proposal.status === "pending") {
    const r = await apiPost(`/api/proposals/${proposal.id}/approve`, "approver", { reason: "E2E set-up" });
    if (r.status !== 200) throw new Error(`approve ${proposal.id}: HTTP ${r.status}`);
  }
  return waitFor("the deal on the Kanban board", async () =>
    (await apiGet<{ items: Deal[] }>("/api/deals")).items.find((d) => d.id === proposal.stream_id));
}

/** Open the app and log in on the real Keycloak login page. */
export async function login(page: Page, user: User, workspace = "origination") {
  await page.goto(`/w/${workspace}`);
  await page.waitForURL(/\/realms\/strata\/protocol\/openid-connect\/auth/);
  await page.locator("#username").fill(`${user}@strata.local`);
  await page.locator("#password").fill(devPassword());
  await page.locator("#kc-login").click();
  await page.waitForURL((url) => url.origin === WEB_ORIGIN && !url.pathname.startsWith("/auth/"));
  await expect(page.locator(`[data-workspace-id="${workspace}"]`)).toBeVisible();
}

export async function openWorkspace(page: Page, workspace: string) {
  await page.locator(`[data-nav-id="${workspace}"]`).click();
  await expect(page.locator(`[data-workspace-id="${workspace}"]`)).toBeVisible();
}

export async function moduleReady(page: Page, id: string): Promise<Locator> {
  const m = page.locator(`[data-module="${id}"]`).first();
  await expect(m).toBeVisible();
  await expect(m).not.toHaveAttribute("data-module-state", "loading", { timeout: 30_000 });
  return m;
}

export async function addPanel(page: Page, id: string) {
  await page.getByRole("button", { name: "Add panel" }).first().click();
  await page.getByRole("dialog", { name: "Add panel" }).locator(`[data-module-id="${id}"]`).click();
  await expect(page.locator(`[data-panel-id="${id}"]`)).toBeVisible();
}

export const toast = (page: Page, text: string) => page.locator(".sds-toast-region").getByText(text, { exact: true });
