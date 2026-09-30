export const REQUIRED_FONT_META_NAME = 'site-font-query';
export const FONT_SURFACE_ATTRIBUTE = 'data-font-surface';

export const SITE_FONT_QUERIES = {
  bodyRegular: '400 1em var(--font-source-sans-3)',
  bodyItalic: 'italic 400 1em var(--font-source-sans-3)',
  displayBold: '700 1em var(--font-manrope)',
  monoRegular: '400 1em var(--font-jetbrains-mono)',
} as const;

const FONT_PROBE_SEED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const REQUIRED_CHINESE_CHARACTER_PATTERN =
  /[\p{Script=Han}\u3000-\u303f\ufe10-\ufe1f\ufe30-\ufe4f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff60\uffe0-\uffe6]/u;
const NOTO_SANS_SC_FONT_REQUEST = {
  query: '400 1em "Noto Sans SC Variable"',
} as const;
const SOURCE_SANS_ITALIC_FONT_REQUEST = {
  query: SITE_FONT_QUERIES.bodyItalic,
  text: FONT_PROBE_SEED,
} as const;
const KATEX_CORE_FONT_REQUESTS = [
  { query: 'normal 400 1em "KaTeX_AMS"', text: 'ABΓ∫' },
  { query: 'normal 400 1em "KaTeX_Main"', text: 'Aa09+=()' },
  { query: 'normal 700 1em "KaTeX_Main"', text: 'Aa09' },
  { query: 'italic 400 1em "KaTeX_Main"', text: 'Aa09' },
  { query: 'italic 700 1em "KaTeX_Main"', text: 'Aa09' },
  { query: 'italic 400 1em "KaTeX_Math"', text: 'xyφκ' },
  { query: 'italic 700 1em "KaTeX_Math"', text: 'xyφκ' },
  { query: 'normal 400 1em "KaTeX_Size1"', text: '()[]{}∫' },
  { query: 'normal 400 1em "KaTeX_Size2"', text: '()[]{}∫' },
  { query: 'normal 400 1em "KaTeX_Size3"', text: '()[]{}∫' },
  { query: 'normal 400 1em "KaTeX_Size4"', text: '()[]{}∫' },
] as const;
const KATEX_OPTIONAL_FONT_REQUESTS = [
  {
    selector: '.mathcal, .mathscr',
    requests: [
      { query: 'normal 400 1em "KaTeX_Caligraphic"', text: 'ABC' },
      { query: 'normal 400 1em "KaTeX_Script"', text: 'ABC' },
    ],
  },
  {
    selector: '.mathfrak, .textfrak, .mathboldfrak, .textboldfrak',
    requests: [
      { query: 'normal 400 1em "KaTeX_Fraktur"', text: 'ABC' },
      { query: 'normal 700 1em "KaTeX_Fraktur"', text: 'ABC' },
    ],
  },
  {
    selector: '.mathsf, .textsf, .mathboldsf, .textboldsf, .mathsfit, .mathitsf, .textitsf',
    requests: [
      { query: 'normal 400 1em "KaTeX_SansSerif"', text: 'ABC' },
      { query: 'normal 700 1em "KaTeX_SansSerif"', text: 'ABC' },
      { query: 'italic 400 1em "KaTeX_SansSerif"', text: 'ABC' },
    ],
  },
  {
    selector: '.mathtt, .texttt',
    requests: [{ query: 'normal 400 1em "KaTeX_Typewriter"', text: 'ABC123' }],
  },
] as const;
const CONDITIONAL_FONT_REQUEST_GROUPS = [
  {
    selector: 'address, cite, dfn, em, i, var',
    requests: [SOURCE_SANS_ITALIC_FONT_REQUEST],
  },
  {
    selector: '.katex',
    requests: KATEX_CORE_FONT_REQUESTS,
  },
  ...KATEX_OPTIONAL_FONT_REQUESTS,
] as const;

export type RequiredFontRequest = { query: string; text: string };
export type RequiredFontOptions = {
  contentRoot?: ParentNode;
  signal?: AbortSignal;
};

type FontDocument = Document & { fonts?: FontFaceSet };

function abortError(): DOMException {
  return new DOMException('Font preparation was superseded', 'AbortError');
}

function waitForAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

function withAbort<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    task.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export function resolveRequiredFontQuery(fontDocument: Document, query: string): string {
  const view = fontDocument.defaultView;
  if (!view) return query;

  return query.replace(/var\((--[a-z0-9-]+)\)/gi, (reference, property: string) => {
    const stack = view
      .getComputedStyle(fontDocument.documentElement)
      .getPropertyValue(property)
      .trim();
    const firstFamily = stack.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/);
    const family = firstFamily?.[1] ?? firstFamily?.[2] ?? firstFamily?.[3]?.trim();
    return family ? JSON.stringify(family) : reference;
  });
}

export function readRequiredFontQueries(
  declarationDocument: Document,
  fontDocument: Document = declarationDocument,
): string[] {
  return [
    ...new Set(
      Array.from(
        declarationDocument.querySelectorAll<HTMLMetaElement>(
          `meta[name="${REQUIRED_FONT_META_NAME}"]`,
        ),
      )
        .map((element) => element.content.trim())
        .filter(Boolean)
        .map((query) => resolveRequiredFontQuery(fontDocument, query)),
    ),
  ];
}

/** Reads real code points so unicode-range fonts request only matching fragments. */
export function readRequiredFontText(contentRoot: ParentNode): string {
  const characters = new Set(FONT_PROBE_SEED);
  const declaredSurfaces = Array.from(
    contentRoot.querySelectorAll<HTMLElement>(`[${FONT_SURFACE_ATTRIBUTE}]`),
  );
  const sources = declaredSurfaces.length > 0 ? declaredSurfaces : [contentRoot];
  const text = sources.map((source) => source.textContent ?? '').join(' ');

  for (const character of text.normalize('NFC')) {
    if (!/\s/u.test(character)) characters.add(character);
  }
  return [...characters].join('');
}

/** Keeps only glyphs intentionally provided by the site's Simplified Chinese face. */
export function readRequiredChineseFontText(text: string): string {
  const characters = new Set<string>();
  for (const character of text.normalize('NFC')) {
    if (REQUIRED_CHINESE_CHARACTER_PATTERN.test(character)) characters.add(character);
  }
  return [...characters].join('');
}

export function readRequiredFontRequests(
  declarationDocument: Document,
  fontDocument: Document = declarationDocument,
  contentRoot: ParentNode = declarationDocument,
): RequiredFontRequest[] {
  const pageText = readRequiredFontText(contentRoot);
  const chineseText = readRequiredChineseFontText(pageText);
  const requests = readRequiredFontQueries(declarationDocument, fontDocument).map((query) => ({
    query,
    text: pageText,
  }));

  if (chineseText) {
    requests.push({ ...NOTO_SANS_SC_FONT_REQUEST, text: chineseText });
  }

  for (const group of CONDITIONAL_FONT_REQUEST_GROUPS) {
    if (!contentRoot.querySelector(group.selector)) continue;
    requests.push(
      ...group.requests.map((request) => ({
        ...request,
        query: resolveRequiredFontQuery(fontDocument, request.query),
      })),
    );
  }

  return [
    ...new Map(requests.map((request) => [`${request.query}\n${request.text}`, request])).values(),
  ];
}

function requestedFontFamily(query: string): string | undefined {
  const quotedFamily = query.match(/(?:^|\s)(["'])([^"']+)\1\s*$/);
  if (quotedFamily) return quotedFamily[2];

  const unquotedFamily = query.match(/(?:^|\s)([a-z][a-z0-9-]*)\s*$/i);
  return unquotedFamily?.[1];
}

function areRequiredFontFamiliesDeclared(
  fonts: FontFaceSet,
  requests: readonly RequiredFontRequest[],
): boolean {
  if (typeof fonts[Symbol.iterator] !== 'function') return false;

  const declaredFamilies = new Set(
    Array.from(fonts, (fontFace) => fontFace.family.replace(/^(["'])(.*)\1$/, '$2')),
  );
  return requests.every(({ query }) => {
    const family = requestedFontFamily(query);
    return family !== undefined && declaredFamilies.has(family);
  });
}

/** Font availability, not an assumed cache hit, decides the synchronous path. */
function areRequiredFontRequestsReady(
  fontDocument: FontDocument,
  requests: readonly RequiredFontRequest[],
): boolean {
  const fonts = fontDocument.fonts;
  if (!fonts || typeof fonts.check !== 'function') return false;

  return (
    areRequiredFontFamiliesDeclared(fonts, requests) &&
    requests.every(({ query, text }) => fonts.check(query, text))
  );
}

function waitToRetry(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, 500);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** An errored FontFace cannot load again; renew only its original CSS source. */
function retryFailedFontFaces(
  fontDocument: FontDocument,
  requests: readonly RequiredFontRequest[],
): void {
  const families = new Set(requests.map(({ query }) => requestedFontFamily(query)));
  const normalize = (value: string) => value.replace(/["'\s]/g, '').toLowerCase();
  const failed = Array.from(fontDocument.fonts ?? []).filter(
    (face) => face.status === 'error' && families.has(face.family.replace(/^(["'])(.*)\1$/, '$2')),
  );
  if (failed.length === 0) return;

  const renew = (sheet: CSSStyleSheet | CSSGroupingRule, base: string): void => {
    for (let index = 0; index < sheet.cssRules.length; index++) {
      const rule = sheet.cssRules[index]!;
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        const style = (rule as CSSFontFaceRule).style;
        const matches = failed.some(
          (face) =>
            normalize(face.family) === normalize(style.fontFamily) &&
            normalize(face.style) === normalize(style.fontStyle || 'normal') &&
            normalize(face.weight) === normalize(style.fontWeight || 'normal') &&
            normalize(face.stretch) === normalize(style.fontStretch || 'normal') &&
            normalize(face.unicodeRange) ===
              normalize(style.getPropertyValue('unicode-range') || 'U+0-10FFFF'),
        );
        if (!matches) continue;
        const source = style
          .getPropertyValue('src')
          .replace(/url\(["']?([^"')]+)["']?\)/g, (reference, value: string) => {
            const url = new URL(value, base);
            if (url.protocol === 'data:') return reference;
            url.searchParams.set(
              'font-retry',
              String(Number(url.searchParams.get('font-retry')) + 1),
            );
            return `url("${url.href}")`;
          });
        // Firefox exposes @font-face descriptors as read-only. Recreate the
        // failed rule with its original descriptors and the renewed source.
        const replacement = `@font-face {${Array.from(
          style,
          (property) =>
            `${property}: ${property === 'src' ? source : style.getPropertyValue(property)};`,
        ).join('')}}`;
        sheet.deleteRule(index);
        sheet.insertRule(replacement, index);
      } else if (rule.type === CSSRule.IMPORT_RULE) {
        const imported = (rule as CSSImportRule).styleSheet;
        if (imported) renew(imported, imported.href || base);
      } else if ('cssRules' in rule) renew(rule as CSSGroupingRule, base);
    }
  };
  for (const sheet of fontDocument.styleSheets) renew(sheet, sheet.href || fontDocument.baseURI);
}

async function waitForRequiredFontRequests(
  fontDocument: FontDocument,
  requests: readonly RequiredFontRequest[],
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw abortError();
  if (areRequiredFontRequestsReady(fontDocument, requests)) return;

  const fonts = fontDocument.fonts;
  if (!fonts || typeof fonts.load !== 'function') return waitForAbort(signal);
  if (requests.length === 0) return;

  for (;;) {
    try {
      const outcomes = await withAbort(
        Promise.all(
          requests.map(async ({ query, text }) => (await fonts.load(query, text)).length > 0),
        ),
        signal,
      );
      if (outcomes.every(Boolean) && areRequiredFontRequestsReady(fontDocument, requests)) return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
    }
    await waitToRetry(signal);
    if (signal?.aborted) throw abortError();
    retryFailedFontFaces(fontDocument, requests);
  }
}

/**
 * Returns synchronously when every required face is already available.
 * A cold request resolves only after all fonts are ready. Failed resources keep
 * retrying until they load or their owning navigation/search is cancelled.
 */
export function prepareRequiredFonts(
  fontDocument: FontDocument,
  declarationDocument: Document = fontDocument,
  options: RequiredFontOptions = {},
): void | Promise<void> {
  const { contentRoot = declarationDocument, signal } = options;
  const requests = readRequiredFontRequests(declarationDocument, fontDocument, contentRoot);
  if (areRequiredFontRequestsReady(fontDocument, requests)) return;
  return waitForRequiredFontRequests(fontDocument, requests, signal);
}
