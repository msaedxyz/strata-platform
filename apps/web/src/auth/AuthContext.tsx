import { Button, ErrorState, LoadingState } from "@strata/design-system";
import type { Role } from "@strata/panel-framework";
import { createStrataClient, type StrataClient } from "@strata/api-client";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { appConfig } from "../config/app.config";
import type { AuthDriver } from "./driver";

export interface SessionUser {
  id: string;
  name: string | null;
  email: string | null;
  roles: string[];
  role: Role | null;
}

export interface Session {
  user: SessionUser;
  getToken: () => string | null;
  api: StrataClient;
  logout: () => Promise<void>;
}

type State =
  | { status: "loading" }
  | { status: "ready"; session: Session }
  | { status: "error"; message: string }
  | { status: "logged-out"; driver: AuthDriver };

const SessionContext = createContext<Session | null>(null);

async function loadDriver(): Promise<AuthDriver> {
  // __E2E_MOCK_AUTH__ is a build constant. In a production build it is false, so the bundler removes the mock.
  if (__E2E_MOCK_AUTH__) {
    const { createMockDriver } = await import("./mockAuth");
    return createMockDriver();
  }
  const { createOidcDriver } = await import("./oidc");
  return createOidcDriver();
}

/** Gets the session: OIDC login, then POST /api/session/login and GET /api/me. The API gives the role. */
export function AuthProvider({ children, driverFactory = loadDriver }: { children: ReactNode; driverFactory?: () => Promise<AuthDriver> }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let live = true;
    (async () => {
      const driver = await driverFactory();
      const result = await driver.init();
      if (result.kind !== "ready") return;
      const api = createStrataClient(appConfig.api.baseUrl || window.location.origin, driver.getToken);
      if (result.freshLogin) await api.POST("/api/session/login");
      const me = await api.GET("/api/me");
      const status = me.response.status;
      if (!me.response.ok || !me.data) throw new Error(status === 403 ? "Your account has no Strata role." : `The session did not start (HTTP ${status}).`);
      const data = me.data as unknown as { id: string; name?: string | null; email?: string | null; roles?: string[]; role?: Role | null };
      const logout = async () => {
        try {
          await api.POST("/api/session/logout");
        } finally {
          await driver.endSession();
          if (live) setState({ status: "logged-out", driver });
        }
      };
      if (live)
        setState({
          status: "ready",
          session: {
            user: { id: data.id, name: data.name ?? null, email: data.email ?? null, roles: data.roles ?? [], role: data.role ?? null },
            getToken: driver.getToken,
            api,
            logout,
          },
        });
    })().catch((err: unknown) => {
      if (live) setState({ status: "error", message: err instanceof Error ? err.message : "The session did not start." });
    });
    return () => {
      live = false;
    };
  }, [driverFactory]);

  if (state.status === "loading") return <LoadingState label="Starting the session" />;
  if (state.status === "error") return <ErrorState title="You are not logged in" description={state.message} onRetry={() => window.location.reload()} />;
  if (state.status === "logged-out")
    return (
      <div className="app-logged-out">
        <p>You are logged out.</p>
        <Button variant="primary" onClick={() => void state.driver.login()}>
          Log in
        </Button>
      </div>
    );
  return <SessionContext.Provider value={state.session}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession needs an AuthProvider");
  return s;
}

/** For tests and stories: give a session without a login. */
export function SessionProvider({ session, children }: { session: Session; children: ReactNode }) {
  const value = useMemo(() => session, [session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
