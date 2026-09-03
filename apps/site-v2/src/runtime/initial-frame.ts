import { createArticleTocInitialFrameSource } from '../features/article/runtime/article-toc-state';
import { createLocaleNavigationTransferSource } from './locale-navigation-transfer';
import { createRequiredFontsInlineSource } from './required-fonts';
import { createScrollRestorationSource } from './scroll-state';
import { createScrollSnapshotDecoderSource } from './state-ledger';

export const INITIAL_FRAME_READY_ID = 'initial-frame-ready';
export const INITIAL_FRAME_READY_SELECTOR = `#${INITIAL_FRAME_READY_ID}`;
export const INITIAL_SCROLL_RESTORATION_ATTRIBUTE = 'data-initial-scroll-restoration';

/**
 * Keeps automatic fragment handling from animating after state restoration.
 * The normal smooth-scroll policy resumes immediately before the first user
 * interaction, so user-initiated anchors retain their existing behavior.
 */
export function armInitialScrollRestoration(sourceDocument: Document): void {
  const attribute = 'data-initial-scroll-restoration';
  const events = ['pointerdown', 'keydown', 'click'] as const;
  const root = sourceDocument.documentElement;
  root.setAttribute(attribute, '');

  const release = (): void => {
    root.removeAttribute(attribute);
    for (const eventName of events) {
      sourceDocument.removeEventListener(eventName, release, true);
    }
  };
  for (const eventName of events) {
    sourceDocument.addEventListener(eventName, release, { capture: true, once: true });
  }
}

/**
 * Mirrors the restored point into Astro ClientRouter's existing history fields.
 * Astro reads these fields during module startup; leaving stale coordinates there
 * would make it smoothly scroll away from the point restored by StateLedger.
 */
export function synchronizeClientRouterInitialScrollState(
  sourceHistory: History,
  point: { x: number; y: number },
): void {
  try {
    const state = sourceHistory.state;
    if (typeof state !== 'object' || state === null || Array.isArray(state)) return;
    if (!Number.isFinite(state.scrollX) || !Number.isFinite(state.scrollY)) return;
    sourceHistory.replaceState({ ...state, scrollX: point.x, scrollY: point.y }, '');
  } catch {}
}

/**
 * Generates the document-state entry installed immediately before the
 * end-of-body render boundary. A warm document commits synchronously before
 * first paint; a cold document keeps typography hidden until its exact fonts
 * and final scroll placement are both ready.
 */
export function createInitialFrameScript(): string {
  const stateDecoderSource = createScrollSnapshotDecoderSource();
  const scrollRestorationSource = createScrollRestorationSource();
  const localeNavigationTransferSource = createLocaleNavigationTransferSource();
  const fontPreparationSource = createRequiredFontsInlineSource();
  const articleTocSource = createArticleTocInitialFrameSource();
  const clientRouterScrollSource = synchronizeClientRouterInitialScrollState.toString();
  const initialScrollRestorationSource = armInitialScrollRestoration.toString();

  return `(() => {
    ${stateDecoderSource}
    ${scrollRestorationSource}
    ${localeNavigationTransferSource}
    ${fontPreparationSource}
    ${articleTocSource}
    ${clientRouterScrollSource}
    ${initialScrollRestorationSource}

    try {
      const routeKey = location.pathname + location.search;
      const snapshot = decodeScrollSnapshot(history.state, routeKey);
      let localeTransfer;
      try {
        localeTransfer = consumeLocaleNavigationTransfer(window.sessionStorage, location);
      } catch {}
      const initialPoint = localeTransfer ?? snapshot?.page;
      if (initialPoint || location.hash) armInitialScrollRestoration(document);
      if (initialPoint) {
        history.scrollRestoration = 'manual';
        synchronizeClientRouterInitialScrollState(history, initialPoint);
      }

      let placementCommitted = false;
      const commitPlacement = () => {
        if (placementCommitted) return;
        placementCommitted = true;
        if (localeTransfer) restorePageScroll(document, window, localeTransfer);
        else if (snapshot) restorePageAndNestedScroll(document, window, snapshot);
        synchronizeArticleToc(document, window);
      };
      const commitReadyDocument = () => {
        commitPlacement();
        document.documentElement.dataset.fontState = 'ready';
      };

      if (areRequiredFontsReady(document)) {
        commitReadyDocument();
        return;
      }
      void waitForRequiredFonts(document).then(commitReadyDocument).catch(() => undefined);
    } catch {}
  })();`;
}
