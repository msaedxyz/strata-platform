// App settings. Values that are behaviour (not visual) live here. Visual values come from the design tokens.
// The OIDC values come from the environment. They are not secrets: strata-web is a public client with PKCE.

const env = import.meta.env;

export const appConfig = {
  oidc: {
    issuer: env.VITE_OIDC_ISSUER || "http://localhost:8080/realms/strata",
    clientId: env.VITE_OIDC_CLIENT_ID || "strata-web",
    scope: "openid profile email",
    callbackPath: "/auth/callback",
    silentPath: "/auth/silent",
  },
  api: {
    /** The API base. The Vite dev server and nginx send /api to the API service. */
    baseUrl: "",
    livePath: "/api/live",
  },
  live: {
    /** Reconnect delays for the live connection, in milliseconds. */
    reconnectInitialMs: 1000,
    reconnectMaxMs: 30000,
    reconnectFactor: 2,
  },
  ticker: {
    /** PROVISIONAL scroll speed in pixels per second, until audit/behaviour.md gives the Infora speed. */
    speedPxPerSecond: 40,
  },
  shortcuts: {
    /** Time to press the second key of a sequence such as "g 1", in milliseconds. */
    sequenceTimeoutMs: 1200,
  },
  map: {
    /** The MapLibre style URL. Empty means the empty style with no tiles (docs/assumptions.md item 7). */
    styleUrl: env.VITE_MAP_STYLE_URL || "",
  },
  defaultWorkspace: "origination",
} as const;
