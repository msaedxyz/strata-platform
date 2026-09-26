import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useSession } from "../src/auth/AuthContext";
import type { AuthDriver } from "../src/auth/driver";
import { oidcSettings } from "../src/auth/oidc";

function driver(overrides: Partial<AuthDriver> = {}): AuthDriver {
  return {
    init: async () => ({ kind: "ready", freshLogin: true }),
    getToken: () => "token-1",
    endSession: vi.fn(async () => undefined),
    login: vi.fn(async () => undefined),
    ...overrides,
  };
}

function mockFetch(me: { status: number; body: unknown }) {
  const calls: Array<{ method: string; url: string; auth: string | null }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request) => {
      const url = new URL(input.url);
      calls.push({ method: input.method, url: url.pathname, auth: input.headers.get("authorization") });
      if (url.pathname === "/api/me") return new Response(JSON.stringify(me.body), { status: me.status, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

function Who() {
  const s = useSession();
  return (
    <div>
      <span>
        {s.user.name} {s.user.role}
      </span>
      <button onClick={() => void s.logout()}>Log out</button>
    </div>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AuthProvider", () => {
  it("after login calls POST /api/session/login, then GET /api/me with the bearer token", async () => {
    const calls = mockFetch({ status: 200, body: { id: "u1", name: "Ada", email: "a@example.com", roles: ["analyst"], role: "analyst" } });
    const d = driver();
    render(
      <AuthProvider driverFactory={async () => d}>
        <Who />
      </AuthProvider>,
    );
    expect(await screen.findByText("Ada analyst")).toBeInTheDocument();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/session/login", "GET /api/me"]);
    expect(calls.every((c) => c.auth === "Bearer token-1")).toBe(true);
  });

  it("does not call session/login when the session already exists", async () => {
    const calls = mockFetch({ status: 200, body: { id: "u1", name: "Ada", roles: ["viewer"], role: "viewer" } });
    render(
      <AuthProvider driverFactory={async () => driver({ init: async () => ({ kind: "ready", freshLogin: false }) })}>
        <Who />
      </AuthProvider>,
    );
    await screen.findByText("Ada viewer");
    expect(calls.map((c) => c.url)).toEqual(["/api/me"]);
  });

  it("logout calls POST /api/session/logout and then ends the identity provider session", async () => {
    const user = userEvent.setup();
    const calls = mockFetch({ status: 200, body: { id: "u1", name: "Ada", roles: ["analyst"], role: "analyst" } });
    const d = driver();
    render(
      <AuthProvider driverFactory={async () => d}>
        <Who />
      </AuthProvider>,
    );
    await user.click(await screen.findByRole("button", { name: "Log out" }));
    await waitFor(() => expect(d.endSession).toHaveBeenCalled());
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: "/api/session/logout" });
    expect(await screen.findByText("You are logged out.")).toBeInTheDocument();
  });

  it("shows an error when the account has no Strata role", async () => {
    mockFetch({ status: 403, body: { detail: "no Strata role" } });
    render(
      <AuthProvider driverFactory={async () => driver()}>
        <Who />
      </AuthProvider>,
    );
    expect(await screen.findByText("Your account has no Strata role.")).toBeInTheDocument();
  });

  it("waits while the driver redirects to the identity provider", async () => {
    const calls = mockFetch({ status: 200, body: {} });
    render(
      <AuthProvider driverFactory={async () => driver({ init: async () => ({ kind: "redirecting" }) })}>
        <Who />
      </AuthProvider>,
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Starting the session");
    expect(calls).toHaveLength(0);
  });
});

describe("OIDC settings", () => {
  it("uses the authorisation code flow with PKCE, silent renew and the Strata client", () => {
    const s = oidcSettings("http://localhost:5173");
    expect(s.response_type).toBe("code");
    expect(s.client_id).toBe("strata-web");
    expect(s.authority).toBe("http://localhost:8080/realms/strata");
    expect(s.redirect_uri).toBe("http://localhost:5173/auth/callback");
    expect(s.silent_redirect_uri).toBe("http://localhost:5173/auth/silent");
    expect(s.automaticSilentRenew).toBe(true);
    expect((s as { disablePKCE?: boolean }).disablePKCE).not.toBe(true);
  });
});
