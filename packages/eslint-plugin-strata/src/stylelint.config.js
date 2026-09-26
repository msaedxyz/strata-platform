// Stylelint configuration for CSS outside packages/design-system.
// It reports raw colour values (hex, colour functions, named colours) and raw sizes (px, rem, em).
// Use the CSS custom properties from @strata/design-system instead.
/** @type {import("stylelint").Config} */
const config = {
  rules: {
    "color-no-hex": true,
    "color-named": "never",
    "function-disallowed-list": ["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch"],
    "unit-disallowed-list": ["px", "rem", "em"],
  },
};

export default config;
