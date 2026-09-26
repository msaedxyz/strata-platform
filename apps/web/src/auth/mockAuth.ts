// TEST ONLY. The E2E tests use this driver instead of Keycloak. The build puts it in the bundle only when
// VITE_E2E_AUTH=mock. scripts/check-no-mock-auth.mjs fails a production build that contains this marker.
import type { AuthDriver } from "./driver";

export const E2E_MOCK_AUTH_MARKER = "E2E_MOCK_AUTH_MARKER_DO_NOT_SHIP";

export function createMockDriver(): AuthDriver {
  let token: string | null = `e2e-mock-token.${E2E_MOCK_AUTH_MARKER}`;
  return {
    async init() {
      return { kind: "ready", freshLogin: true };
    },
    getToken: () => token,
    async endSession() {
      token = null;
    },
    async login() {
      window.location.assign("/");
    },
  };
}
