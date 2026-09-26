import { strataConfig } from "./src/config.js";

// The plugin is outside packages/design-system, so the raw value rule applies. The test file holds
// deliberate raw values as rule fixtures, so the rule is off for the test directory only.
export default [
  ...strataConfig({ react: false }),
  { files: ["test/**"], rules: { "strata/no-raw-values": "off" } },
  { files: ["src/raw-values.js"], rules: { "strata/no-raw-values": "off" } },
];
