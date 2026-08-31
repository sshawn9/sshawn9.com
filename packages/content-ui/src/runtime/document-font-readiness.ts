export type SettledDocumentFontState = 'ready' | 'degraded';

function settledState(root: HTMLElement): SettledDocumentFontState | undefined {
  const state = root.dataset.fontState;
  return state === 'ready' || state === 'degraded' ? state : undefined;
}

function abortError(signal: AbortSignal): DOMException {
  return signal.reason instanceof DOMException
    ? signal.reason
    : new DOMException('Font readiness wait was cancelled', 'AbortError');
}

/**
 * Waits for the document-level font coordinator without loading fonts itself.
 * Both site generations project their authoritative result to data-font-state.
 */
export function waitForDocumentFonts(
  root: HTMLElement = document.documentElement,
  signal?: AbortSignal,
): Promise<SettledDocumentFontState> {
  const current = settledState(root);
  if (current) return Promise.resolve(current);
  if (signal?.aborted) return Promise.reject(abortError(signal));

  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      const state = settledState(root);
      if (state) finish(state);
    });
    const abort = () => finish(abortError(signal!));

    function finish(result: SettledDocumentFontState | DOMException): void {
      observer.disconnect();
      signal?.removeEventListener('abort', abort);
      if (result instanceof DOMException) reject(result);
      else resolve(result);
    }

    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-font-state'],
    });
    signal?.addEventListener('abort', abort, { once: true });

    // Close the gap between the initial read and observer installation.
    const state = settledState(root);
    if (state) finish(state);
  });
}
