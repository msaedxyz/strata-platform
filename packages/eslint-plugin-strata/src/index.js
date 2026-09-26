import noRawValues from "./no-raw-values.js";

const plugin = {
  meta: { name: "@strata/eslint-plugin-strata", version: "0.1.0" },
  rules: {
    "no-raw-values": noRawValues,
  },
};

export default plugin;
