export const FONT_QUERY_META_NAME = 'site-font-query';
export const FONT_SURFACE_ATTRIBUTE = 'data-font-surface';
export const FONT_FALLBACK_ATTRIBUTE = 'data-font-fallback';
export const FONT_TIMEOUT_MS = 1_800;

const FONT_PROBE_SEED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
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

export type FontPreparationResult =
  'ready' | 'degraded' | 'timeout' | 'unsupported' | 'not-required';
export type FontLoadRequest = { query: string; text: string };

type SettledFontPreparation = Exclude<FontPreparationResult, 'timeout'>;
type FontDocument = Document & { fonts?: FontFaceSet };

function abortError(): DOMException {
  return new DOMException('Navigation was superseded', 'AbortError');
}

// Requirement derivation ----------------------------------------------------

export function resolveFontQuery(fontDocument: Document, query: string): string {
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
          `meta[name="${FONT_QUERY_META_NAME}"]`,
        ),
      )
        .map((element) => element.content.trim())
        .filter(Boolean)
        .map((query) => resolveFontQuery(fontDocument, query)),
    ),
  ];
}

/** Uses real page code points so unicode-range faces such as CJK are selected. */
export function readRequiredFontText(declarationDocument: Document): string {
  const characters = new Set(FONT_PROBE_SEED);
  const surfaces = Array.from(
    declarationDocument.querySelectorAll<HTMLElement>(`[${FONT_SURFACE_ATTRIBUTE}]`),
  );
  const pageText = (surfaces.length > 0 ? surfaces : [declarationDocument.body])
    .filter((surface): surface is HTMLElement => Boolean(surface))
    .map((surface) => surface.textContent ?? '')
    .join(' ');
  for (const character of pageText.normalize('NFC')) {
    if (!/\s/u.test(character)) characters.add(character);
  }
  return [...characters].join('');
}

export function readRequiredFontRequests(
  declarationDocument: Document,
  fontDocument: Document = declarationDocument,
): FontLoadRequest[] {
  const pageText = readRequiredFontText(declarationDocument);
  const requests: FontLoadRequest[] = readRequiredFontQueries(
    declarationDocument,
    fontDocument,
  ).map((query) => ({ query, text: pageText }));

  if (declarationDocument.querySelector('.katex')) {
    requests.push(...KATEX_CORE_FONT_REQUESTS);
    for (const optional of KATEX_OPTIONAL_FONT_REQUESTS) {
      if (declarationDocument.querySelector(optional.selector)) requests.push(...optional.requests);
    }
  }

  return [
    ...new Map(requests.map((request) => [`${request.query}\n${request.text}`, request])).values(),
  ];
}

/**
 * A warm document must be committed synchronously. Waiting on an already
 * loaded FontFaceSet through Promise.all still yields to a later microtask,
 * which is enough for the browser to expose one hidden typography frame.
 */
export function areDeclaredFontsReady(
  fontDocument: FontDocument,
  declarationDocument: Document,
): boolean {
  const fonts = fontDocument.fonts;
  if (!fonts || typeof fonts.check !== 'function') return false;
  const requests = readRequiredFontRequests(declarationDocument, fontDocument);
  try {
    return requests.every(({ query, text }) => fonts.check(query, text));
  } catch {
    return false;
  }
}

// Preparation and projection -----------------------------------------------

export async function prepareDeclaredFonts(
  fontDocument: FontDocument,
  declarationDocument: Document,
): Promise<SettledFontPreparation> {
  const fonts = fontDocument.fonts;
  if (!fonts) return 'unsupported';

  const requests = readRequiredFontRequests(declarationDocument, fontDocument);
  if (requests.length === 0) return 'not-required';

  const outcomes = await Promise.all(
    requests.map(async ({ query, text }) => {
      try {
        return (await fonts.load(query, text)).length > 0;
      } catch {
        return false;
      }
    }),
  );
  // FontFaceSet.load() already settles only after every face matching the
  // exact query and code-point sample is loaded. FontFaceSet.ready is a
  // document-wide layout barrier: it also waits for incidental faces outside
  // this surface contract and can therefore hide a complete page for an
  // unrelated font. Keep the transaction scoped to its declared requests.
  return outcomes.every(Boolean) ? 'ready' : 'degraded';
}

export function prepareTargetFonts(
  fontDocument: FontDocument,
  targetDocument: Document,
  signal: AbortSignal,
  timeoutMs = FONT_TIMEOUT_MS,
): Promise<FontPreparationResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => finish('timeout'), timeoutMs);
    const abort = () => finish(abortError());

    function finish(result: FontPreparationResult | DOMException): void {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      if (result instanceof DOMException) reject(result);
      else resolve(result);
    }

    if (signal.aborted) {
      finish(abortError());
      return;
    }

    signal.addEventListener('abort', abort, { once: true });
    void prepareDeclaredFonts(fontDocument, targetDocument).then(finish, () => finish('degraded'));
  });
}

export function reflectFontPreparation(
  targetDocument: Document,
  result: FontPreparationResult,
): void {
  const degraded = result === 'degraded' || result === 'timeout';
  targetDocument.documentElement.dataset.fontState = degraded ? 'degraded' : 'ready';
  for (const surface of targetDocument.querySelectorAll<HTMLElement>(
    `[${FONT_SURFACE_ATTRIBUTE}]`,
  )) {
    surface.toggleAttribute(FONT_FALLBACK_ATTRIBUTE, degraded);
  }
}

/**
 * The first-frame entry executes without module imports. Keeping these pure
 * dependencies together lets it serialize the exact navigation implementation
 * instead of maintaining a second bootstrap copy.
 */
export function createDeclaredFontPreparationSource(): string {
  return [
    `const FONT_QUERY_META_NAME = ${JSON.stringify(FONT_QUERY_META_NAME)};`,
    `const FONT_SURFACE_ATTRIBUTE = ${JSON.stringify(FONT_SURFACE_ATTRIBUTE)};`,
    `const FONT_FALLBACK_ATTRIBUTE = ${JSON.stringify(FONT_FALLBACK_ATTRIBUTE)};`,
    `const FONT_PROBE_SEED = ${JSON.stringify(FONT_PROBE_SEED)};`,
    `const KATEX_CORE_FONT_REQUESTS = ${JSON.stringify(KATEX_CORE_FONT_REQUESTS)};`,
    `const KATEX_OPTIONAL_FONT_REQUESTS = ${JSON.stringify(KATEX_OPTIONAL_FONT_REQUESTS)};`,
    resolveFontQuery.toString(),
    readRequiredFontQueries.toString(),
    readRequiredFontText.toString(),
    readRequiredFontRequests.toString(),
    areDeclaredFontsReady.toString(),
    prepareDeclaredFonts.toString(),
    reflectFontPreparation.toString(),
  ].join('\n');
}
