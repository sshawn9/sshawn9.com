function fontsAreReady(root: HTMLElement): boolean {
  return root.dataset.fontState === 'ready';
}

function abortError(signal: AbortSignal): DOMException {
  return signal.reason instanceof DOMException
    ? signal.reason
    : new DOMException('Font readiness wait was cancelled', 'AbortError');
}

/**
 * Waits for the document-level font boundary without loading fonts itself.
 * Consumers can measure text only after the document publishes `ready`.
 */
export function waitForDocumentFonts(
  root: HTMLElement = document.documentElement,
  signal?: AbortSignal,
): Promise<void> {
  if (fontsAreReady(root)) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(abortError(signal));

  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (fontsAreReady(root)) finish();
    });
    const abort = () => finish(abortError(signal!));

    function finish(error?: DOMException): void {
      observer.disconnect();
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    }

    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-font-state'],
    });
    signal?.addEventListener('abort', abort, { once: true });

    // Close the gap between the initial read and observer installation.
    if (fontsAreReady(root)) finish();
  });
}
