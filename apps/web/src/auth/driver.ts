/** How the app gets and ends a session. The OIDC driver is the real one. The mock driver exists only in E2E builds. */
export type InitResult = { kind: "ready"; freshLogin: boolean } | { kind: "redirecting" } | { kind: "silent-callback" };

export interface AuthDriver {
  init(): Promise<InitResult>;
  getToken(): string | null;
  /** Called after POST /api/session/logout. It ends the identity provider session. */
  endSession(): Promise<void>;
  /** Start a new login. */
  login(): Promise<void>;
}
