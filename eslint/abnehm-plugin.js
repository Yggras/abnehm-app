import { relative, sep } from 'node:path';

// Projektregeln, die ESLint nicht mitbringt. Belegt in test/lint-grenzen.test.ts.

const colorFunction = /^\s*(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const hexColor = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// Stil- und SVG-Eigenschaften, deren Wert eine Farbe ist.
const colorKey = /^(?:color|fill|stroke|boxShadow|textShadow)$|Color$/;
// Schlüsselwörter ohne eigenen Farbwert.
const keywords = new Set(['transparent', 'none', 'currentColor']);

/** Name der Eigenschaft bzw. des JSX-Attributs, dessen Wert `node` ist. */
function ownerKey(node) {
  const parent = node.parent;
  if (parent?.type === 'Property' && parent.value === node) return keyName(parent.key);
  if (parent?.type === 'JSXAttribute') return keyName(parent.name);
  if (parent?.type === 'JSXExpressionContainer' && parent.parent?.type === 'JSXAttribute') return keyName(parent.parent.name);
  return undefined;
}

function keyName(node) {
  if (!node) return undefined;
  if (node.type === 'Identifier' || node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  return undefined;
}

const tokenColors = {
  meta: {
    type: 'problem',
    docs: { description: 'Farben nur aus den Design-Tokens, nie als rohe Werte.' },
    messages: {
      raw: 'Rohe Farbe „{{value}}“: Farben kommen aus `color` in apps/mobile/src/design/tokens.ts.',
    },
    schema: [],
  },
  create(context) {
    const report = (node, value) => context.report({ node, messageId: 'raw', data: { value } });

    function checkValue(node, valueNode, key) {
      if (valueNode?.type === 'JSXExpressionContainer') return checkValue(node, valueNode.expression, key);
      if (valueNode?.type === 'Literal' && typeof valueNode.value === 'string') {
        if (key && colorKey.test(key) && !keywords.has(valueNode.value)) report(valueNode, valueNode.value);
      }
      // Zusammengesetzte Farben gibt es nur in der Token-Datei (etwa Deckkraft als Hex-Anhang).
      if (valueNode?.type === 'TemplateLiteral' && key && colorKey.test(key)) {
        report(valueNode, valueNode.quasis.map((quasi) => quasi.value.cooked).join('…'));
      }
    }

    return {
      // Farbwerte außerhalb von Farbeigenschaften, etwa in Konstanten; Farbeigenschaften prüfen die
      // beiden Besucher darunter.
      Literal(node) {
        if (typeof node.value !== 'string') return;
        const key = ownerKey(node);
        if (key && colorKey.test(key)) return;
        if (hexColor.test(node.value.trim()) || colorFunction.test(node.value)) report(node, node.value);
      },
      Property(node) {
        checkValue(node, node.value, keyName(node.key));
      },
      JSXAttribute(node) {
        checkValue(node, node.value, keyName(node.name));
      },
    };
  },
};

const libraryBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: 'Plattformbibliotheken nur hinter ihrem Projektmodul.' },
    messages: { outside: '„{{source}}“ ist nur in {{allowed}} erlaubt. {{message}}' },
    schema: [
      {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            modules: { type: 'array', items: { type: 'string' } },
            allowedIn: { type: 'array', items: { type: 'string' } },
            message: { type: 'string' },
          },
          required: ['modules', 'allowedIn', 'message'],
          additionalProperties: false,
        },
      },
    ],
  },
  create(context) {
    const boundaries = context.options[0] ?? [];
    const file = relative(context.cwd, context.filename).split(sep).join('/');

    function check(node, source) {
      if (typeof source !== 'string') return;
      for (const boundary of boundaries) {
        const matches = boundary.modules.some((module) => source === module || source.startsWith(`${module}/`));
        const allowed = boundary.allowedIn.some((path) => file === path || file.startsWith(path));
        if (matches && !allowed) {
          context.report({
            node,
            messageId: 'outside',
            data: { source, allowed: boundary.allowedIn.join(', '), message: boundary.message },
          });
        }
      }
    }

    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => check(node, node.source?.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) => check(node, node.source.value),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node, node.arguments[0]?.value);
      },
    };
  },
};

export default {
  meta: { name: 'abnehm' },
  rules: { 'token-farben': tokenColors, bibliotheksgrenzen: libraryBoundaries },
};
