/** Prepares the target document's declared shared fonts without owning navigation. */
export const FONT_TIMEOUT_MS = 1_800;

export type FontPreparationResult =
  'ready' | 'degraded' | 'timeout' | 'unsupported' | 'not-required';

function abortError() {
  return new DOMException('Navigation was superseded', 'AbortError');
}

type SettledFontPreparation = Exclude<FontPreparationResult, 'timeout'>;

function settlePreparation(preparation: Promise<SettledFontPreparation>, signal: AbortSignal) {
  return new Promise<FontPreparationResult>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish('timeout'), FONT_TIMEOUT_MS);
    const abort = () => finish(abortError());
    let settled = false;

    function finish(result: FontPreparationResult | DOMException) {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      if (result instanceof DOMException) {
        reject(result);
      } else {
        resolve(result);
      }
    }

    if (signal.aborted) {
      finish(abortError());
      return;
    }

    signal.addEventListener('abort', abort, { once: true });
    preparation.then(finish);
  });
}

/**
 * Loads the fonts declared by one document from another document's FontFaceSet.
 * The function is self-contained so the initial-frame script can serialize the
 * same parser and loader instead of maintaining a second implementation.
 */
export async function prepareDeclaredFonts(
  fontDocument: Document,
  declarationDocument: Document,
): Promise<SettledFontPreparation> {
  if (!('fonts' in fontDocument)) {
    return 'unsupported';
  }

  const weights =
    declarationDocument
      .querySelector('meta[name="required-fonts"]')
      ?.getAttribute('content')
      ?.split(',')
      .map((value) => Number(value.trim()))
      .filter((weight) => Number.isFinite(weight) && weight > 0) ?? [];

  if (weights.length === 0) {
    return 'not-required';
  }

  const outcomes = await Promise.all(
    weights.map(async (weight) => {
      try {
        const faces = await fontDocument.fonts.load(String(weight) + ' 1em "Manrope Variable"');
        return faces.length > 0;
      } catch {
        return false;
      }
    }),
  );

  // FontFaceSet.load() covers the declared faces. `ready` also waits for any
  // face the browser selected while laying out the already-parsed critical
  // content, so the render boundary cannot open one frame too early.
  await fontDocument.fonts.ready;

  return outcomes.every(Boolean) ? ('ready' as const) : ('degraded' as const);
}

export async function prepareTargetFonts(
  targetDocument: Document,
  signal: AbortSignal,
): Promise<FontPreparationResult> {
  return settlePreparation(prepareDeclaredFonts(document, targetDocument), signal);
}
