import { prepareTargetArticleSidebarState } from '../features/article/runtime/article-sidebar-state';
import { synchronizeArticleToc } from '../features/article/runtime/article-toc-state';
import { prepareTargetBlogSidebarState } from '../features/blog/runtime/blog-sidebar-state';
import { prepareTargetBlogView } from '../features/blog/runtime/blog-view';
import { getBlogReadingPreference } from '../features/blog/runtime/blog-reading-preference';
import { prepareBlogPaginationLayout } from '../features/blog/runtime/blog-pagination-layout';
import { armInitialScrollRestoration, synchronizeClientRouterScrollState } from './initial-frame';
import {
  consumeLocaleNavigationTransfer,
  type LocaleNavigationPoint,
} from './locale-navigation-transfer';
import { reflectPageBusy } from './navigation-feedback';
import { prepareRequiredFonts } from './required-fonts';
import { restoreNestedScroll, restorePageScroll } from './scroll-state';
import { decodeScrollSnapshot } from './state-ledger';

/** Installs parser-time state preparation without letting page placement own the font gate. */
export function installInitialDocumentRuntime(
  sourceDocument: Document = document,
  sourceWindow: Window = window,
): void {
  // Astro alone cannot prepare this site's fonts and page state. Until the site
  // runtime is installed, let its documented cancellation path load full documents.
  const requireSiteRuntime = (event: Event): void => event.preventDefault();
  sourceDocument.addEventListener('astro:before-preparation', requireSiteRuntime);
  sourceDocument.addEventListener(
    'site:runtime-ready',
    () => sourceDocument.removeEventListener('astro:before-preparation', requireSiteRuntime),
    { once: true },
  );

  const initialBody = sourceDocument.body;
  const targetUrl = new URL(sourceWindow.location.href);
  let snapshot: ReturnType<typeof decodeScrollSnapshot>;
  let localeTransfer: LocaleNavigationPoint | undefined;
  let initialPoint: LocaleNavigationPoint | undefined;

  for (const prepare of [
    () =>
      prepareTargetBlogView(
        sourceDocument,
        targetUrl,
        getBlogReadingPreference(sourceWindow).get(),
      ),
    () => prepareTargetBlogSidebarState(sourceDocument, sourceWindow),
    () => prepareTargetArticleSidebarState(sourceDocument, sourceWindow),
    () => {
      const routeKey = sourceWindow.location.pathname + sourceWindow.location.search;
      snapshot = decodeScrollSnapshot(sourceWindow.history.state, routeKey);
      try {
        localeTransfer = consumeLocaleNavigationTransfer(
          sourceWindow.sessionStorage,
          sourceWindow.location,
        );
      } catch {}
      initialPoint = localeTransfer ?? snapshot?.page;
      if (initialPoint || sourceWindow.location.hash) armInitialScrollRestoration(sourceDocument);
      if (initialPoint) {
        sourceWindow.history.scrollRestoration = 'manual';
        synchronizeClientRouterScrollState(sourceWindow.history, initialPoint);
      }
    },
  ]) {
    try {
      prepare();
    } catch (error) {
      sourceWindow.reportError(error);
    }
  }

  const commitPlacement = (): void => {
    prepareBlogPaginationLayout(sourceDocument, sourceWindow);
    if (initialPoint) restorePageScroll(sourceDocument, sourceWindow, initialPoint);
    synchronizeArticleToc(sourceDocument, sourceWindow);
    // Active-link wrapping must settle before restoring nested scroll positions.
    if (!localeTransfer && snapshot) restoreNestedScroll(sourceDocument, snapshot);
  };
  const commitReadyDocument = (): void => {
    // A client navigation may have replaced this body while its fonts loaded.
    // That old preparation must not restore scroll or publish readiness for it.
    if (sourceDocument.body !== initialBody) return;
    try {
      commitPlacement();
    } catch (error) {
      sourceWindow.reportError(error);
    }
    if (sourceDocument.body !== initialBody) return;
    sourceDocument.documentElement.dataset.fontState = 'ready';
    reflectPageBusy(sourceDocument);
  };

  const preparation = prepareRequiredFonts(sourceDocument);
  // A real font failure deliberately remains in the loading state; only a
  // successful preparation is allowed to release the text gate.
  if (preparation) {
    void preparation.then(commitReadyDocument).catch((error) => sourceWindow.reportError(error));
  } else commitReadyDocument();
}
