import * as csstree from 'css-tree';
import { readRequiredFontRequests } from '../../src/runtime/required-fonts.ts';

const ALL_CODE_POINTS = [0, 0x10ffff];

function declarationMap(block) {
  const declarations = new Map();
  for (const node of block?.children ?? []) {
    if (node.type === 'Declaration') declarations.set(node.property.toLowerCase(), node);
  }
  return declarations;
}

function valueText(declaration) {
  return declaration ? csstree.generate(declaration.value).trim() : '';
}

function firstValueNode(declaration, types) {
  let result;
  if (!declaration) return result;
  csstree.walk(declaration.value, (node) => {
    if (!result && types.has(node.type)) result = node;
  });
  return result;
}

function readUnicodeRange(value) {
  const match = /^u\+([\da-f?]+)(?:-([\da-f]+))?$/i.exec(value);
  if (!match) throw new Error(`Unsupported unicode-range: ${value}`);
  if (match[2]) return [parseInt(match[1], 16), parseInt(match[2], 16)];
  if (match[1].includes('?')) {
    return [
      parseInt(match[1].replaceAll('?', '0'), 16),
      parseInt(match[1].replaceAll('?', 'f'), 16),
    ];
  }
  const point = parseInt(match[1], 16);
  return [point, point];
}

function readRanges(declaration) {
  if (!declaration) return [ALL_CODE_POINTS];
  const ranges = [];
  csstree.walk(declaration.value, (node) => {
    if (node.type === 'UnicodeRange') ranges.push(readUnicodeRange(node.value));
  });
  if (!ranges.length) throw new Error(`Unable to read unicode-range: ${valueText(declaration)}`);
  return ranges;
}

function readWeight(declaration, variables) {
  if (!declaration) return [400, 400];
  const numbers = [];
  csstree.walk(declaration.value, (node) => {
    if (node.type === 'Number') numbers.push(Number(node.value));
  });
  const text = numbers.length ? '' : resolveVariables(valueText(declaration), variables);
  const values = numbers.length
    ? numbers
    : [...text.matchAll(/\d+(?:\.\d+)?/g)].map(([value]) => Number(value));
  if (values.length === 1) return [values[0], values[0]];
  if (values.length === 2) return [values[0], values[1]];
  if (text.toLowerCase() === 'normal') return [400, 400];
  if (text.toLowerCase() === 'bold') return [700, 700];
  throw new Error(`Unable to read font-weight: ${valueText(declaration)}`);
}

function readStyle(declaration) {
  if (!declaration) return 'normal';
  const value = firstValueNode(declaration, new Set(['Identifier']))?.name?.toLowerCase();
  if (value === 'normal' || value === 'italic') return value;
  throw new Error(`Unsupported font-style: ${valueText(declaration)}`);
}

function readFamily(declaration) {
  if (!declaration) throw new Error('Missing font-family declaration.');
  return firstFamily(valueText(declaration));
}

function readUrls(declaration) {
  const urls = [];
  if (!declaration) return urls;
  csstree.walk(declaration.value, (node) => {
    if (node.type === 'Url') urls.push(node.value);
  });
  return urls;
}

/** Reads declared font faces and the project's --font-* variable stacks from a CSS AST. */
export function readFontStyles(ast) {
  /** @type {Record<string, string>} */
  const variables = {};
  csstree.walk(ast, (node) => {
    if (node.type === 'Declaration' && node.property.startsWith('--font-')) {
      variables[node.property] = valueText(node);
    }
  });

  const faces = [];
  csstree.walk(ast, (node) => {
    if (node.type !== 'Atrule' || node.name.toLowerCase() !== 'font-face') return;
    const declarations = declarationMap(node.block);
    const family = readFamily(declarations.get('font-family'));
    const urls = readUrls(declarations.get('src'));
    faces.push({
      family,
      style: readStyle(declarations.get('font-style')),
      weight: readWeight(declarations.get('font-weight'), variables),
      ranges: readRanges(declarations.get('unicode-range')),
      urls,
    });
  });
  return { faces, variables };
}

function resolveVariables(value, variables, seen = new Set()) {
  return value.replace(/var\((--font-[a-z\d-]+)\)/gi, (_match, name) => {
    if (seen.has(name) || !variables[name]) throw new Error(`Undeclared font variable: ${name}`);
    return resolveVariables(variables[name], variables, new Set([...seen, name]));
  });
}

function firstFamily(value) {
  const match = value.trim().match(/^(?:"([^"]+)"|'([^']+)'|([^,]+))/);
  const family = match?.[1] ?? match?.[2] ?? match?.[3]?.trim();
  if (!family) throw new Error(`Unable to determine font family from: ${value}`);
  return family;
}

function resolveQuery(query, variables) {
  const resolved = query.replace(/var\((--font-[a-z\d-]+)\)/gi, (_match, name) =>
    JSON.stringify(firstFamily(resolveVariables(`var(${name})`, variables))),
  );
  const quotedFamily = resolved.match(/(["'])([^"']+)\1\s*$/);
  const unquotedFamily = resolved.match(/\b([a-z][a-z\d-]*)\s*$/i);
  const family = quotedFamily?.[2] ?? unquotedFamily?.[1];
  if (!family) throw new Error(`Unable to determine font family from query: ${query}`);
  const style = /\bitalic\b/i.test(resolved) ? 'italic' : 'normal';
  const weight = Number(resolved.match(/\b\d{2,4}\b/)?.[0]);
  if (!Number.isFinite(weight))
    throw new Error(`Unable to determine font weight from query: ${query}`);
  return { family, style, weight };
}

function declaredQueryFamilies(query, variables, fallback) {
  const families = new Set([fallback]);
  for (const [, name] of query.matchAll(/var\((--font-[a-z\d-]+)\)/gi)) {
    const stack = resolveVariables(`var(${name})`, variables);
    for (const part of stack.match(/(?:"[^"]*"|'[^']*'|[^,])+/g) ?? [])
      families.add(firstFamily(part));
  }
  return families;
}

function textIntersectsRanges(text, ranges) {
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (ranges.some(([start, end]) => codePoint >= start && codePoint <= end)) return true;
  }
  return false;
}

function fontRequests(document, extraText) {
  if (!extraText) return readRequiredFontRequests(document, { defaultView: null }, document.body);
  const copy = document.cloneNode(true);
  const surface = copy.createElement('span');
  if (copy.querySelector('[data-font-surface]')) surface.setAttribute('data-font-surface', '');
  surface.textContent = extraText;
  copy.body.append(surface);
  return readRequiredFontRequests(copy, { defaultView: null }, copy.body);
}

/** Maps runtime font requests onto the emitted face URLs without simulating CSS cascade. */
export function fontResourceUrls({ document, styles, extraText = '', unrestrictedInput = false }) {
  const faces = styles.flatMap((style) => style.faces);
  // The locale redirect document uses system fonts, not the site's font policy.
  if (!faces.length && !document.querySelector('meta[name="site-font-query"]')) return [];
  const variables = Object.assign({}, ...styles.map((style) => style.variables));
  const urls = new Set();
  for (const request of fontRequests(document, extraText)) {
    const required = resolveQuery(request.query, variables);
    // Font readiness requests only the primary face. Actual CSS also uses the
    // declared fallbacks, e.g. Noto supplies box-drawing glyphs in code blocks.
    const families = declaredQueryFamilies(request.query, variables, required.family);
    const matchingFaces = faces.filter(
      (face) =>
        families.has(face.family) &&
        face.style === required.style &&
        required.weight >= face.weight[0] &&
        required.weight <= face.weight[1],
    );
    if (!matchingFaces.length) {
      throw new Error(`No declared font face matches query: ${request.query}`);
    }
    for (const face of matchingFaces) {
      if (unrestrictedInput || textIntersectsRanges(request.text, face.ranges)) {
        for (const url of face.urls) urls.add(url);
      }
    }
  }
  return [...urls];
}
