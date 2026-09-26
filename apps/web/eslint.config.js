import { strataConfig } from "@strata/eslint-plugin-strata/config";

// Outside packages/design-system: the raw value rule applies to every file (docs/07 rule 6).
export default [...strataConfig({ rawValues: true }), { ignores: ["scripts/**/*.d.ts", "dist-e2e/**"] }];
