// ESLint rule: no raw colour or size values outside packages/design-system.
// Components and apps must use the design tokens (CSS custom properties) instead.
import { findRawValues, SIZE_PROPERTIES, STYLE_PROPERTIES } from "./raw-values.js";

const STYLE_ATTRIBUTES = new Set(["fill", "stroke", "color", "stopColor", "floodColor", "lightingColor"]);
const SKIP_ATTRIBUTES = new Set(["href", "src", "to", "action"]);

/** @param {any} key */
function keyName(key) {
  if (!key) return undefined;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return undefined;
}

/** @param {any} node */
function jsxAttributeName(node) {
  return node && node.type === "JSXAttribute" && node.name && node.name.type === "JSXIdentifier"
    ? node.name.name
    : undefined;
}

/** True when the object expression is the value of a JSX style attribute. @param {any} objectNode */
function isJsxStyleObject(objectNode) {
  const container = objectNode && objectNode.parent;
  if (!container || container.type !== "JSXExpressionContainer") return false;
  return jsxAttributeName(container.parent) === "style";
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow raw colour and size values. Use the design tokens from @strata/design-system.",
    },
    schema: [],
    messages: {
      rawColor: "Raw colour value '{{value}}'. Use a colour token from @strata/design-system.",
      rawSize: "Raw size value '{{value}}'. Use a size or space token from @strata/design-system.",
    },
  },
  create(context) {
    /**
     * @param {any} node
     * @param {string} text
     * @param {boolean} styleContext
     */
    function check(node, text, styleContext) {
      for (const hit of findRawValues(text, { named: styleContext })) {
        context.report({ node, messageId: hit.kind === "color" ? "rawColor" : "rawSize", data: { value: hit.value } });
      }
    }

    /** @param {any} node */
    function styleContextOf(node) {
      let target = node.parent;
      if (target && target.type === "TemplateLiteral") target = target.parent;
      if (target && target.type === "Property" && target.value === (node.parent.type === "TemplateLiteral" ? node.parent : node)) {
        const name = keyName(target.key);
        return name !== undefined && STYLE_PROPERTIES.has(name);
      }
      if (target && target.type === "JSXAttribute") {
        const name = jsxAttributeName(target);
        return name !== undefined && STYLE_ATTRIBUTES.has(name);
      }
      return false;
    }

    /** @param {any} node */
    function skipped(node) {
      const parent = node.parent;
      if (!parent) return false;
      if (
        parent.type === "ImportDeclaration" ||
        parent.type === "ExportNamedDeclaration" ||
        parent.type === "ExportAllDeclaration" ||
        parent.type === "ImportExpression"
      ) {
        return true;
      }
      const attr = jsxAttributeName(parent);
      return attr !== undefined && SKIP_ATTRIBUTES.has(attr);
    }

    return {
      /** @param {any} node */
      Literal(node) {
        if (typeof node.value === "string") {
          if (skipped(node)) return;
          check(node, node.value, styleContextOf(node));
          return;
        }
        if (typeof node.value === "number" && node.value !== 0) {
          let valueNode = node;
          if (node.parent && node.parent.type === "UnaryExpression") valueNode = node.parent;
          const property = valueNode.parent;
          if (!property || property.type !== "Property" || property.value !== valueNode) return;
          const name = keyName(property.key);
          if (name === undefined || !SIZE_PROPERTIES.has(name)) return;
          if (!isJsxStyleObject(property.parent)) return;
          context.report({ node, messageId: "rawSize", data: { value: String(node.value) } });
        }
      },
      /** @param {any} node */
      TemplateElement(node) {
        const text = node.value && (node.value.cooked ?? node.value.raw);
        if (typeof text === "string") check(node, text, styleContextOf(node));
      },
    };
  },
};

export default rule;
