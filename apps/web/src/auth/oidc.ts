// OIDC login with Keycloak: authorisation code flow with PKCE (S256), silent renew, and end-session logout.
import { UserManager, type UserManagerSettings, WebStorageStateStore } from "oidc-client-ts";
import { appConfig } from "../config/app.config";
import type { AuthDriver, InitResult } from "./driver";

export function oidcSettings(origin: string): UserManagerSettings {
  const { oidc } = appConfig;
  return {
    authority: oidc.issuer,
    client_id: oidc.clientId,
    redirect_uri: `${origin}${oidc.callbackPath}`,
    silent_redirect_uri: `${origin}${oidc.silentPath}`,
    post_logout_redirect_uri: `${origin}/`,
    response_type: "code",
    scope: oidc.scope,
    automaticSilentRenew: true,
    // The tokens stay in the tab (sessionStorage), not in localStorage.
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    loadUserInfo: false,
  };
}

export function createOidcDriver(): AuthDriver {
  const manager = new UserManager(oidcSettings(window.location.origin));
  let token: string | null = null;
  let idToken: string | undefined;

  manager.events.addUserLoaded((user) => {
    token = user.access_token;
    idToken = user.id_token;
  });
  manager.events.addUserUnloaded(() => {
    token = null;
  });
  manager.events.addSilentRenewError(() => {
    // The session at the identity provider ended. Log in again.
    void manager.signinRedirect({ state: { returnTo: window.location.pathname } });
  });

  return {
    async init(): Promise<InitResult> {
      const path = window.location.pathname;
      if (path === appConfig.oidc.silentPath) {
        await manager.signinSilentCallback();
        return { kind: "silent-callback" };
      }
      if (path === appConfig.oidc.callbackPath) {
        const user = await manager.signinRedirectCallback();
        token = user.access_token;
        idToken = user.id_token;
        const state = user.state as { returnTo?: string } | undefined;
        const returnTo = state?.returnTo && state.returnTo.startsWith("/") ? state.returnTo : "/";
        window.history.replaceState(null, "", returnTo);
        return { kind: "ready", freshLogin: true };
      }
      const user = await manager.getUser();
      if (!user || user.expired) {
        await manager.signinRedirect({ state: { returnTo: `${window.location.pathname}${window.location.search}` } });
        return { kind: "redirecting" };
      }
      token = user.access_token;
      idToken = user.id_token;
      return { kind: "ready", freshLogin: false };
    },
    getToken: () => token,
    async endSession() {
      await manager.removeUser();
      await manager.signoutRedirect({ id_token_hint: idToken });
    },
    async login() {
      await manager.signinRedirect({ state: { returnTo: window.location.pathname } });
    },
  };
}
