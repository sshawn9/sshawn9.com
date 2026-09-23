import { mountArticlePage } from '../features/article/runtime/article-controller';
import { prepareTargetArticleSidebarState } from '../features/article/runtime/article-sidebar-state';
import { synchronizeArticleToc } from '../features/article/runtime/article-toc-state';
import { mountBlogPage } from '../features/blog/runtime/blog-controller';
import { prepareTargetBlogSidebarState } from '../features/blog/runtime/blog-sidebar-state';
import { prepareTargetBlogView } from '../features/blog/runtime/blog-view';
import { getBlogReadingPreference } from '../features/blog/runtime/blog-reading-preference';
import { prepareBlogPaginationLayout } from '../features/blog/runtime/blog-pagination-layout';
import { mountSearchPage } from '../features/search/runtime/search-controller';
import {
  belongsToView,
  type PageController,
  type PageNavigation,
  type PageView,
} from './page-navigation';
import { readCurrentScroll } from './scroll-state';
import { rethrowAfterCleanup } from './cleanup';

export type PageRuntime = {
  resolveView(targetUrl: URL): PageView | undefined;
  prepareTargetDocument(targetDocument: Document, targetUrl: URL): void;
  beforeDocumentSwap(targetDocument: Document, targetUrl: URL): void;
  prepareCurrentLayout?(): void;
  prepareCurrentDocument(): void;
  mountCurrentPage(navigation: PageNavigation): void;
  dispose(): void;
};

/** Owns the mounted page. The navigation coordinator decides when a document changes. */
export function createPageRuntime(
  sourceDocument: Document = document,
  sourceWindow: Window = window,
): PageRuntime {
  let controller: PageController | undefined;
  let mountedPage: Element | undefined;
  let pendingSearchScroll: ReturnType<typeof readCurrentScroll>;
  let disposed = false;

  const destroyCurrentPage = (): void => {
    const previous = controller;
    controller = undefined;
    mountedPage = undefined;
    previous?.destroy();
  };

  return {
    resolveView(targetUrl) {
      if (disposed || mountedPage !== sourceDocument.querySelector('main')) return undefined;
      const view = controller?.view;
      return view && belongsToView(view, targetUrl) ? view : undefined;
    },
    prepareTargetDocument(targetDocument, targetUrl) {
      prepareTargetBlogView(
        targetDocument,
        targetUrl,
        getBlogReadingPreference(sourceWindow).get(),
      );
      prepareTargetBlogSidebarState(targetDocument, sourceWindow);
      prepareTargetArticleSidebarState(targetDocument, sourceWindow);
    },
    beforeDocumentSwap(targetDocument, targetUrl) {
      destroyCurrentPage();
      // Settings may change while the incoming document waits for its fonts.
      prepareTargetBlogView(
        targetDocument,
        targetUrl,
        getBlogReadingPreference(sourceWindow).get(),
      );
      pendingSearchScroll = targetDocument.querySelector('[data-site-search]')
        ? readCurrentScroll(sourceWindow, targetUrl)
        : undefined;
    },
    prepareCurrentDocument() {
      // Root placement determines the active link; its wrapping affects nested scroll.
      synchronizeArticleToc(sourceDocument, sourceWindow);
    },
    prepareCurrentLayout() {
      prepareBlogPaginationLayout(sourceDocument, sourceWindow);
    },
    mountCurrentPage(navigation) {
      if (disposed) return;
      const page = sourceDocument.querySelector('main');
      if (page && page === mountedPage) return;
      destroyCurrentPage();
      try {
        const next: PageController | undefined =
          mountBlogPage(sourceDocument, sourceWindow, navigation) ??
          mountArticlePage(sourceDocument, sourceWindow) ??
          mountSearchPage(sourceDocument, sourceWindow, navigation, pendingSearchScroll);
        // Canonicalization resolves the mounted view, so publish it first.
        controller = next;
        mountedPage = page ?? undefined;
        if (next?.view) {
          const update = next.view.resolve(new URL(sourceWindow.location.href));
          if (update.url.href !== sourceWindow.location.href) {
            // Mounting has already rendered this canonical view. Only commit its
            // address; do not restart search work or overwrite its pending scroll.
            navigation.requestViewRefresh(() => ({ url: update.url, apply() {} }));
          }
        }
        pendingSearchScroll = undefined;
      } catch (error) {
        rethrowAfterCleanup(error, destroyCurrentPage);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pendingSearchScroll = undefined;
      destroyCurrentPage();
    },
  };
}
