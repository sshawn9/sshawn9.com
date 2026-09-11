import { parseHTML } from 'linkedom';
import * as csstree from 'css-tree';
import parseSrcset from 'parse-srcset';
import { init, parse as parseModule } from 'es-module-lexer';
import ts from 'typescript';
import { readFontStyles } from './fonts.mjs';

const assetLinkRels = new Set([
  'stylesheet',
  'preload',
  'modulepreload',
  'manifest',
  'icon',
  'apple-touch-icon',
  'mask-icon',
]);

/** Fonts are selected per document, not traversed as unconditional stylesheet URLs. */
export function readStylesheet(css, context = 'stylesheet') {
  const ast = csstree.parse(css, { context, parseCustomProperty: true });
  const references = [];
  csstree.walk(ast, function (node) {
    if (node.type === 'Raw' && /(?:\burl\(|@import\b)/i.test(node.value)) {
      throw new SyntaxError('CSS contains resource syntax that could not be parsed.');
    }
    if (node.type === 'Atrule' && node.name.toLowerCase() === 'import') {
      const source = node.prelude?.children?.first;
      if (!source || !['Url', 'String'].includes(source.type))
        throw new SyntaxError('Unable to read an @import target.');
      references.push(source.value);
    }
    if (node.type === 'Url' && this.atrule?.name.toLowerCase() !== 'font-face')
      references.push(node.value);
  });
  return { references: [...new Set(references)], ...readFontStyles(ast) };
}

export async function readModuleReferences(code) {
  await init;
  const references = [];
  let imports;
  try {
    [imports] = parseModule(code);
  } catch {
    return { references, unresolved: true };
  }
  let unresolved = false;
  for (const entry of imports) {
    if (entry.d === -2) continue;
    if (entry.n == null || !/^(?:\.{1,2}\/|\/|[a-z][a-z\d+.-]*:)/i.test(entry.n)) {
      unresolved = true;
    } else references.push(entry.n);
  }
  return { references, unresolved };
}

/** Fixed island UI text, including escaped strings and template segments; never executes JS. */
export function readModuleText(code) {
  const characters = new Set();
  const source = ts.createSourceFile(
    'island.js',
    code,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS,
  );
  function visit(node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
      for (const character of node.text) characters.add(character);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...characters].join('');
}

export async function readHtmlReferences(html) {
  let { document } = parseHTML(html);
  if (document.documentElement?.localName !== 'html') {
    ({ document } = parseHTML('<html><head></head><body>' + html + '</body></html>'));
  }
  const references = [];
  const styles = [];
  const warnings = [];
  const islands = [];
  let pagefind = null;
  const add = (value) => {
    if (value) references.push(value);
  };
  const srcset = (value) => {
    if (value) for (const item of parseSrcset(value)) add(item.url);
  };
  const css = (value, context) => {
    const style = readStylesheet(value, context);
    styles.push(style);
    references.push(...style.references);
  };
  async function visit(node) {
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
    const tag = node.localName;
    const attrs = Object.fromEntries(
      Array.from(node.attributes ?? [], ({ name, value }) => [name, value]),
    );
    if (attrs.style) css(attrs.style, 'declarationList');
    if (tag === 'style') css(node.textContent);
    if (tag === 'link') {
      const rels = (attrs.rel ?? '').toLowerCase().split(/\s+/);
      if (rels.some((rel) => assetLinkRels.has(rel))) add(attrs.href);
      if (rels.includes('preload')) srcset(attrs.imagesrcset);
    } else if (tag === 'script') {
      const type = (attrs.type ?? '').split(';')[0].trim().toLowerCase();
      if (!type || type === 'module' || /^(?:text|application)\/(?:java|ecma)script$/.test(type))
        add(attrs.src);
      if (type === 'module' && !attrs.src) {
        const module = await readModuleReferences(node.textContent);
        references.push(...module.references);
        if (module.unresolved) warnings.push('Inline module contains an unresolved import.');
      }
    } else if (
      ['img', 'source', 'iframe', 'audio', 'video', 'track', 'embed', 'object'].includes(tag)
    ) {
      add(attrs.src ?? attrs.data);
      srcset(attrs.srcset);
      if (tag === 'video') add(attrs.poster);
    } else if (tag === 'a' && ('data-article-media-item' in attrs || 'download' in attrs)) {
      add(attrs.href);
    } else if (tag === 'astro-island') {
      add(attrs['component-url']);
      add(attrs['renderer-url']);
      if (attrs['component-url'])
        islands.push({ componentUrl: attrs['component-url'], props: attrs.props ?? '' });
    } else if (tag === 'pagefind-config' && attrs['bundle-path']) {
      pagefind = {
        bundlePath: attrs['bundle-path'],
        language: attrs.lang ?? document.documentElement.lang ?? 'en',
        cacheTag: attrs['meta-cache-tag'] ?? null,
      };
    }
    // Template and noscript assets belong to the page, regardless of when used.
    for (const child of tag === 'template' ? node.content.childNodes : node.childNodes)
      await visit(child);
  }
  await visit(document);
  return {
    document,
    references,
    styles,
    warnings,
    islands,
    pagefind,
    gallery: Boolean(
      document.querySelector('[data-article-page] .article-prose a[data-article-media-item]'),
    ),
    baseHref: document.querySelector('base[href]')?.getAttribute('href') ?? null,
    buildId: document.querySelector('meta[name="site-build-id"]')?.getAttribute('content') ?? null,
    title: document.querySelector('title')?.textContent.trim() ?? '',
    language: document.documentElement.getAttribute('lang'),
  };
}
