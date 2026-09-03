export const REQUIRED_FONT_META_NAME = 'site-font-query';
export const FONT_SURFACE_ATTRIBUTE = 'data-font-surface';

const FONT_PROBE_SEED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CJK_CHARACTER_PATTERN = /\p{Script=Han}/u;
const CJK_FONT_REQUEST = {
  query: '400 1em "Noto Sans SC Variable"',
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

export function readRequiredFontRequests(
  declarationDocument: Document,
  fontDocument: Document = declarationDocument,
  contentRoot: ParentNode = declarationDocument,
): RequiredFontRequest[] {
  const pageText = readRequiredFontText(contentRoot);
  const requests = readRequiredFontQueries(declarationDocument, fontDocument).map((query) => ({
    query,
    text: pageText,
  }));

  if (CJK_CHARACTER_PATTERN.test(pageText)) {
    requests.push({ ...CJK_FONT_REQUEST, text: pageText });
  }

  if (contentRoot.querySelector('.katex')) {
    requests.push(...KATEX_CORE_FONT_REQUESTS);
    for (const optional of KATEX_OPTIONAL_FONT_REQUESTS) {
      if (contentRoot.querySelector(optional.selector)) requests.push(...optional.requests);
    }
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
  if (typeof fonts.values !== 'function') return false;

  const declaredFamilies = new Set(
    Array.from(fonts.values(), (fontFace) => fontFace.family.replace(/^(["'])(.*)\1$/, '$2')),
  );
  return requests.every(({ query }) => {
    const family = requestedFontFamily(query);
    return family !== undefined && declaredFamilies.has(family);
  });
}

/** The synchronous warm path prevents a cached reload from exposing a loading frame. */
export function areRequiredFontsReady(
  fontDocument: FontDocument,
  declarationDocument: Document = fontDocument,
  contentRoot: ParentNode = declarationDocument,
): boolean {
  const fonts = fontDocument.fonts;
  if (!fonts || typeof fonts.check !== 'function') return false;

  try {
    const requests = readRequiredFontRequests(declarationDocument, fontDocument, contentRoot);
    return (
      areRequiredFontFamiliesDeclared(fonts, requests) &&
      requests.every(({ query, text }) => fonts.check(query, text))
    );
  } catch {
    return false;
  }
}

/**
 * Resolves only when every font needed by the supplied content is available.
 * Failure intentionally remains pending; an AbortSignal is the sole escape for
 * superseded client-navigation or dynamic-content transactions.
 */
export async function waitForRequiredFonts(
  fontDocument: FontDocument,
  declarationDocument: Document = fontDocument,
  options: RequiredFontOptions = {},
): Promise<void> {
  const { contentRoot = declarationDocument, signal } = options;
  if (signal?.aborted) throw abortError();
  if (areRequiredFontsReady(fontDocument, declarationDocument, contentRoot)) return;

  const fonts = fontDocument.fonts;
  if (!fonts || typeof fonts.load !== 'function') return waitForAbort(signal);
  const requests = readRequiredFontRequests(declarationDocument, fontDocument, contentRoot);
  if (requests.length === 0) return;

  try {
    const outcomes = await withAbort(
      Promise.all(
        requests.map(async ({ query, text }) => (await fonts.load(query, text)).length > 0),
      ),
      signal,
    );
    if (outcomes.every(Boolean)) return;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
  }

  return waitForAbort(signal);
}

/**
 * The parser-executed initial-frame seam uses the same functions as navigation.
 * Serialization avoids a second handwritten bootstrap implementation.
 */
export function createRequiredFontsInlineSource(): string {
  return [
    `const REQUIRED_FONT_META_NAME = ${JSON.stringify(REQUIRED_FONT_META_NAME)};`,
    `const FONT_SURFACE_ATTRIBUTE = ${JSON.stringify(FONT_SURFACE_ATTRIBUTE)};`,
    `const FONT_PROBE_SEED = ${JSON.stringify(FONT_PROBE_SEED)};`,
    `const CJK_CHARACTER_PATTERN = ${CJK_CHARACTER_PATTERN.toString()};`,
    `const CJK_FONT_REQUEST = ${JSON.stringify(CJK_FONT_REQUEST)};`,
    `const KATEX_CORE_FONT_REQUESTS = ${JSON.stringify(KATEX_CORE_FONT_REQUESTS)};`,
    `const KATEX_OPTIONAL_FONT_REQUESTS = ${JSON.stringify(KATEX_OPTIONAL_FONT_REQUESTS)};`,
    abortError.toString(),
    waitForAbort.toString(),
    withAbort.toString(),
    resolveRequiredFontQuery.toString(),
    readRequiredFontQueries.toString(),
    readRequiredFontText.toString(),
    readRequiredFontRequests.toString(),
    requestedFontFamily.toString(),
    areRequiredFontFamiliesDeclared.toString(),
    areRequiredFontsReady.toString(),
    waitForRequiredFonts.toString(),
  ].join('\n');
}
