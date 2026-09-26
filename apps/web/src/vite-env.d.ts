/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OIDC_ISSUER?: string;
  readonly VITE_OIDC_CLIENT_ID?: string;
  readonly VITE_MAP_STYLE_URL?: string;
  readonly VITE_TIME_ZONE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** True only in the E2E dev server (VITE_E2E_AUTH=mock). A production build has false. */
declare const __E2E_MOCK_AUTH__: boolean;
