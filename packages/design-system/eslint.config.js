import { strataConfig } from "@strata/eslint-plugin-strata/config";

// The raw value rule also applies inside the design system. Only the token files may hold raw values.
// Generated token files (src/tokens.ts, src/tokens.css) are ignored by the shared config.
export default [
  ...strataConfig({ rawValues: true }),
  { ignores: ["scripts/**", "tokens/**"] },
  // The token tool tests hold raw token values as fixtures.
  { files: ["test/sync-tokens.test.ts"], rules: { "strata/no-raw-values": "off" } },
];
