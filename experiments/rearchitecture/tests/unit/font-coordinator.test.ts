import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareTargetFonts } from '../../apps/astro/src/runtime/font-coordinator';

function targetDocument(requiredFonts = '400,700') {
  return {
    querySelector: () => ({
      getAttribute: () => requiredFonts,
    }),
  } as unknown as Document;
}

function installFontSet(
  load: (query: string) => Promise<FontFace[]>,
  ready: Promise<FontFaceSet> = Promise.resolve({} as FontFaceSet),
) {
  vi.stubGlobal('document', { fonts: { load, ready } });
}

describe('Astro font coordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports ready only when every declared font query resolves to a face', async () => {
    installFontSet(async () => [{} as FontFace]);

    await expect(prepareTargetFonts(targetDocument(), new AbortController().signal)).resolves.toBe(
      'ready',
    );
  });

  it('waits for every face selected by critical-content layout', async () => {
    let releaseReady = (_fontSet: FontFaceSet) => {};
    const ready = new Promise<FontFaceSet>((resolve) => {
      releaseReady = resolve;
    });
    installFontSet(async () => [{} as FontFace], ready);

    let settled = false;
    const preparation = prepareTargetFonts(targetDocument(), new AbortController().signal).then(
      (result) => {
        settled = true;
        return result;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseReady({} as FontFaceSet);
    await expect(preparation).resolves.toBe('ready');
  });

  it.each([
    ['an empty match', async () => [] as FontFace[]],
    ['a rejected load', async () => Promise.reject(new Error('font failed'))],
  ])('reports degraded for %s', async (_label, load) => {
    installFontSet(load);

    await expect(
      prepareTargetFonts(targetDocument('400'), new AbortController().signal),
    ).resolves.toBe('degraded');
  });

  it('times out a font operation that never settles', async () => {
    installFontSet(() => new Promise(() => {}));
    const preparation = prepareTargetFonts(targetDocument('400'), new AbortController().signal);

    await vi.advanceTimersByTimeAsync(1_800);
    await expect(preparation).resolves.toBe('timeout');
  });

  it('uses the router signal as the sole cancellation authority', async () => {
    installFontSet(() => new Promise(() => {}));
    const controller = new AbortController();
    const preparation = prepareTargetFonts(targetDocument('400'), controller.signal);

    controller.abort();
    await expect(preparation).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('has explicit fallbacks for unsupported and font-free documents', async () => {
    vi.stubGlobal('document', {});
    await expect(prepareTargetFonts(targetDocument(), new AbortController().signal)).resolves.toBe(
      'unsupported',
    );

    installFontSet(async () => [{} as FontFace]);
    await expect(
      prepareTargetFonts(targetDocument(''), new AbortController().signal),
    ).resolves.toBe('not-required');
  });
});
