import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  areDeclaredFontsReady,
  FONT_FALLBACK_ATTRIBUTE,
  FONT_QUERY_META_NAME,
  FONT_SURFACE_ATTRIBUTE,
  prepareTargetFonts,
  readRequiredFontQueries,
  readRequiredFontRequests,
  readRequiredFontText,
  reflectFontPreparation,
  resolveFontQuery,
} from '../../apps/site-v2/src/runtime/font-coordinator';

function declarationDocument(queries: string[], text = '', selectors: string[] = []): Document {
  return {
    body: { textContent: text },
    querySelector: (selector: string) =>
      selectors.some((candidate) => selector.includes(candidate)) ? {} : null,
    querySelectorAll: (selector: string) =>
      selector === `meta[name="${FONT_QUERY_META_NAME}"]`
        ? queries.map((content) => ({ content }))
        : [],
  } as unknown as Document;
}

function fontDocument(load: (query: string, text?: string) => Promise<FontFace[]>): Document {
  return { fonts: { load } } as unknown as Document;
}

describe('v2 font coordinator', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('deduplicates the exact CSS font queries declared by the target document', () => {
    expect(
      readRequiredFontQueries(
        declarationDocument(['400 1em "Manrope Variable"', '  ', '400 1em "Manrope Variable"']),
      ),
    ).toEqual(['400 1em "Manrope Variable"']);
  });

  it('resolves Astro font variables to the generated family owned by this document', () => {
    const target = {
      documentElement: {},
      defaultView: {
        getComputedStyle: () => ({
          getPropertyValue: (property: string) =>
            property === '--font-source-sans-3'
              ? '"Source Sans 3 Variable-build-hash", sans-serif'
              : '',
        }),
      },
    } as unknown as Document;

    expect(resolveFontQuery(target, 'italic 400 1em var(--font-source-sans-3)')).toBe(
      'italic 400 1em "Source Sans 3 Variable-build-hash"',
    );
  });

  it('uses the target document code points to select unicode-range font files', () => {
    const text = readRequiredFontText(declarationDocument([], '文章文章 A\n标签'));

    expect(text).toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(text).toContain('文章标签');
    expect(text).toContain('A');
    expect([...text].filter((character) => character === '文')).toHaveLength(1);
    expect(text).not.toContain('\n');
  });

  it('recognizes an exact warm document without entering an async load', () => {
    const check = vi.fn(() => true);
    const target = declarationDocument(['400 1em "Source Sans 3 Variable"'], 'Ready');

    expect(areDeclaredFontsReady({ fonts: { check } } as unknown as Document, target)).toBe(true);
    expect(check).toHaveBeenCalledWith(
      '400 1em "Source Sans 3 Variable"',
      expect.stringContaining('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    );
  });

  it('adds the KaTeX faces required by rendered mathematics', () => {
    const requests = readRequiredFontRequests(
      declarationDocument(['400 1em "Source Sans 3 Variable"'], '公式', ['.katex', '.mathfrak']),
    );

    expect(requests).toContainEqual({
      query: 'normal 400 1em "KaTeX_Main"',
      text: 'Aa09+=()',
    });
    expect(requests).toContainEqual({
      query: 'normal 700 1em "KaTeX_Fraktur"',
      text: 'ABC',
    });
  });

  it('reports ready after every exact declared face request settles', async () => {
    let releaseLoad = (_faces: FontFace[]) => {};
    const pendingLoad = new Promise<FontFace[]>((resolve) => {
      releaseLoad = resolve;
    });
    const load = vi.fn(() => pendingLoad);
    const target = declarationDocument(
      ['400 1em "Manrope Variable"', '400 1em "Source Sans 3 Variable"'],
      '博客列表',
    );
    const preparation = prepareTargetFonts(
      fontDocument(load),
      target,
      new AbortController().signal,
    );

    let settled = false;
    void preparation.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseLoad([{} as FontFace]);
    await expect(preparation).resolves.toBe('ready');
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledWith(
      '400 1em "Manrope Variable"',
      expect.stringContaining('博客'),
    );
  });

  it.each([
    ['an empty match', async () => [] as FontFace[]],
    ['a rejected load', async () => Promise.reject(new Error('font failed'))],
  ])('reports degraded for %s', async (_label, load) => {
    await expect(
      prepareTargetFonts(
        fontDocument(load),
        declarationDocument(['400 1em "Manrope Variable"']),
        new AbortController().signal,
      ),
    ).resolves.toBe('degraded');
  });

  it('has finite timeout and router-owned cancellation paths', async () => {
    const never = () => new Promise<FontFace[]>(() => {});
    const timed = prepareTargetFonts(
      fontDocument(never),
      declarationDocument(['400 1em "Manrope Variable"']),
      new AbortController().signal,
      25,
    );
    await vi.advanceTimersByTimeAsync(25);
    await expect(timed).resolves.toBe('timeout');

    const controller = new AbortController();
    const cancelled = prepareTargetFonts(
      fontDocument(never),
      declarationDocument(['400 1em "Manrope Variable"']),
      controller.signal,
    );
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not wait when the document declares no custom fonts', async () => {
    await expect(
      prepareTargetFonts(
        fontDocument(async () => [{} as FontFace]),
        declarationDocument([]),
        new AbortController().signal,
      ),
    ).resolves.toBe('not-required');
  });

  it('fixes every typography surface to local fallbacks after degradation', () => {
    const fallback = new Set<string>();
    const surface = {
      toggleAttribute: (name: string, force: boolean) =>
        force ? fallback.add(name) : fallback.delete(name),
    };
    const root = { dataset: {} };
    const target = {
      documentElement: root,
      querySelectorAll: (selector: string) =>
        selector === `[${FONT_SURFACE_ATTRIBUTE}]` ? [surface] : [],
    } as unknown as Document;

    reflectFontPreparation(target, 'timeout');
    expect(root.dataset.fontState).toBe('degraded');
    expect(fallback.has(FONT_FALLBACK_ATTRIBUTE)).toBe(true);

    reflectFontPreparation(target, 'ready');
    expect(root.dataset.fontState).toBe('ready');
    expect(fallback.has(FONT_FALLBACK_ATTRIBUTE)).toBe(false);
  });
});
