import strata from "@strata/eslint-plugin-strata/stylelint";

// Component CSS uses only the token variables. The generated src/tokens.css holds the raw values.
export default {
  ...strata,
  ignoreFiles: ["src/tokens.css"],
};
