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
import { restorePageAndNestedScroll, restorePageScroll } from '../scroll-state';
import { decodeScrollSnapshot } from '../state-ledger';

try {
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
    commitPlacement();
    document.documentElement.dataset.fontState = 'ready';
  };

  const preparation = prepareRequiredFonts(document);
  if (preparation) void preparation.then(commitReadyDocument).catch(() => undefined);
  else commitReadyDocument();
} catch {}
