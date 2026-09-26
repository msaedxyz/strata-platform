// The base token names that the components use. The audit token file must have each of them.
const groups = {
  "color.bg": ["base", "surface-1", "surface-2", "surface-3", "overlay"],
  "color.border": ["subtle", "default", "strong"],
  "color.text": ["primary", "secondary", "tertiary", "disabled", "inverse"],
  "color.focus": ["ring"],
  "color.state": ["positive", "negative", "neutral", "accent", "warning"],
  "font.family": ["sans", "mono"],
  "font.size": ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"],
  "font.weight": ["regular", "medium", "semibold", "bold"],
  "font.line-height": ["tight", "normal", "relaxed"],
  "font.letter-spacing": ["tight", "normal", "wide"],
  space: ["0", "1", "2", "3", "4", "5", "6", "8", "10", "12", "16"],
  radius: ["none", "sm", "md", "lg", "full"],
  shadow: ["sm", "md", "lg"],
  z: ["base", "panel", "sticky", "dropdown", "drawer", "modal", "toast", "tooltip"],
  "motion.duration": ["fast", "normal", "slow"],
  "motion.easing": ["standard", "emphasized"],
};

export const REQUIRED_TOKENS = [
  ...Object.entries(groups).flatMap(([group, names]) => names.map((n) => `${group}.${n}`)),
  "font.numeric",
];
