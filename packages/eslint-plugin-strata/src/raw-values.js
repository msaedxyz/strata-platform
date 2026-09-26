// Detection of raw colour and size values. Shared by the ESLint rule and the tests.
// Source of the rule: docs/07-frontend.md rule 6 and completion criterion 4.

/** The CSS named colours. Keywords such as transparent, currentColor and inherit are not raw values. */
export const NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown " +
    "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
    "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred " +
    "darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue " +
    "dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray " +
    "green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen " +
    "lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink " +
    "lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen " +
    "linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue " +
    "mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy " +
    "oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip " +
    "peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal " +
    "thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen"
  ).split(" "),
);

const HEX = /(^|[^\w&])(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4}))(?![\w-])/g;
const COLOR_FN = /\b(rgba?|hsla?|hwb|oklab|oklch|lab|lch)\(/gi;
const SIZE = /(^|[\s(,:/+*-])(-?(?:\d+\.?\d*|\.\d+)(?:px|rem|em))(?![\w%])/g;

/** CSS properties (camelCase or kebab-case) whose values are colours or sizes. */
export const STYLE_PROPERTIES = new Set(
  (
    "color background backgroundColor background-color border borderColor border-color borderTop borderRight " +
    "borderBottom borderLeft borderTopColor borderRightColor borderBottomColor borderLeftColor outline outlineColor " +
    "outline-color boxShadow box-shadow textShadow text-shadow fill stroke stopColor stop-color caretColor " +
    "caret-color accentColor accent-color textDecorationColor columnRuleColor " +
    "width height minWidth minHeight maxWidth maxHeight min-width min-height max-width max-height " +
    "margin marginTop marginRight marginBottom marginLeft marginInline marginBlock margin-top margin-right " +
    "margin-bottom margin-left padding paddingTop paddingRight paddingBottom paddingLeft paddingInline paddingBlock " +
    "padding-top padding-right padding-bottom padding-left top right bottom left inset gap rowGap columnGap " +
    "row-gap column-gap fontSize font-size lineHeight line-height letterSpacing letter-spacing borderRadius " +
    "border-radius borderWidth border-width outlineWidth outline-width outlineOffset outline-offset flexBasis " +
    "flex-basis gridTemplateColumns gridTemplateRows strokeWidth stroke-width"
  ).split(" "),
);

/** Properties where a bare number means pixels in React style objects. */
export const SIZE_PROPERTIES = new Set(
  [...STYLE_PROPERTIES].filter(
    (p) => !/color|^background|^fill$|^stroke$|shadow|^border$|^outline$|lineHeight|line-height/i.test(p),
  ),
);

/**
 * Find raw values in a piece of text.
 * @param {string} text
 * @param {{ named?: boolean }} [options] named: also report named colours (only in style contexts)
 * @returns {{ kind: "color" | "size", value: string }[]}
 */
export function findRawValues(text, options = {}) {
  /** @type {{ kind: "color" | "size", value: string }[]} */
  const found = [];
  for (const m of text.matchAll(HEX)) found.push({ kind: "color", value: m[2] ?? "" });
  for (const m of text.matchAll(COLOR_FN)) found.push({ kind: "color", value: `${m[1]}()` });
  for (const m of text.matchAll(SIZE)) found.push({ kind: "size", value: m[2] ?? "" });
  if (options.named) {
    for (const word of text.toLowerCase().split(/[^a-z]+/)) {
      if (NAMED_COLORS.has(word)) found.push({ kind: "color", value: word });
    }
  }
  return found;
}
