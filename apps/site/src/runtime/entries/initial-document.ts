import { prepareTargetArticleSidebarState } from '../../features/article/runtime/article-sidebar-state';
import { synchronizeArticleToc } from '../../features/article/runtime/article-toc-state';
import { prepareTargetBlogSidebarState } from '../../features/blog/runtime/blog-sidebar-state';
import { prepareTargetBlogView } from '../../features/blog/runtime/blog-view-state';
import {
  armInitialScrollRestoration,
  synchronizeClientRouterInitialScrollState,
} from '../initial-frame';
import {
  consumeLocaleNavigationTransfer,
  type LocaleNavigationPoint,
} from '../locale-navigation-transfer';
import { prepareRequiredFonts } from '../required-fonts';
import { reflectPageBusy } from '../navigation-feedback';
import { restorePageAndNestedScroll, restorePageScroll } from '../scroll-state';
import { decodeScrollSnapshot } from '../state-ledger';

// Astro alone cannot prepare this site's fonts and page state. Until the site
// runtime is installed, let its documented cancellation path load full documents.
const requireSiteRuntime = (event: Event): void => event.preventDefault();
document.addEventListener('astro:before-preparation', requireSiteRuntime);
document.addEventListener(
  'site:runtime-ready',
  () => document.removeEventListener('astro:before-preparation', requireSiteRuntime),
  { once: true },
);

try {
  const initialBody = document.body;
  const targetUrl = new URL(location.href);
  prepareTargetBlogView(document, targetUrl);
  prepareTargetBlogSidebarState(document, window);
  prepareTargetArticleSidebarState(document, window);

  const routeKey = location.pathname + location.search;
  const snapshot = decodeScrollSnapshot(history.state, routeKey);
  let localeTransfer: LocaleNavigationPoint | undefined;
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
  const commitPlacement = (): void => {
    if (placementCommitted) return;
    placementCommitted = true;
    if (localeTransfer) restorePageScroll(document, window, localeTransfer);
    else if (snapshot) restorePageAndNestedScroll(document, window, snapshot);
    synchronizeArticleToc(document, window);
  };
  const commitReadyDocument = (): void => {
    // A client navigation may have replaced this body while its fonts loaded.
    // That old preparation must not restore scroll or publish readiness for it.
    if (document.body !== initialBody) return;
    commitPlacement();
    document.documentElement.dataset.fontState = 'ready';
    reflectPageBusy(document);
  };

  const preparation = prepareRequiredFonts(document);
  if (preparation) void preparation.then(commitReadyDocument).catch(() => undefined);
  else commitReadyDocument();
} catch {}
