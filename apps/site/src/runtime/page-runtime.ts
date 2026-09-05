import { mountArticlePage } from '../features/article/runtime/article-controller';
import { prepareTargetArticleSidebarState } from '../features/article/runtime/article-sidebar-state';
import { mountBlogPage } from '../features/blog/runtime/blog-controller';
import { prepareTargetBlogSidebarState } from '../features/blog/runtime/blog-sidebar-state';
import { prepareTargetBlogView } from '../features/blog/runtime/blog-view-state';
import { mountSearchPage } from '../features/search/runtime/search-controller';
import {
  belongsToView,
  type PageController,
  type PageNavigation,
  type PageView,
} from './page-navigation';
import { readCurrentScroll } from './scroll-state';

export type PageRuntime = {
  resolveView(targetUrl: URL): PageView | undefined;
  prepareTargetDocument(targetDocument: Document, targetUrl: URL): void;
  beforeDocumentSwap(targetDocument: Document, targetUrl: URL): void;
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
    controller?.destroy();
    controller = undefined;
    mountedPage = undefined;
  };

  return {
    resolveView(targetUrl) {
      if (disposed || mountedPage !== sourceDocument.querySelector('main')) return undefined;
      const view = controller?.view;
      return view && belongsToView(view, targetUrl) ? view : undefined;
    },
    prepareTargetDocument(targetDocument, targetUrl) {
      prepareTargetBlogView(targetDocument, targetUrl);
      prepareTargetBlogSidebarState(targetDocument, sourceWindow);
      prepareTargetArticleSidebarState(targetDocument, sourceWindow);
    },
    beforeDocumentSwap(targetDocument, targetUrl) {
      destroyCurrentPage();
      pendingSearchScroll = targetDocument.querySelector('[data-site-search]')
        ? readCurrentScroll(sourceWindow, targetUrl)
        : undefined;
    },
    mountCurrentPage(navigation) {
      if (disposed) return;
      const page = sourceDocument.querySelector('main');
      if (page && page === mountedPage) return;
      destroyCurrentPage();
      mountedPage = page ?? undefined;
      controller = mountBlogPage(sourceDocument, sourceWindow, navigation);
      controller ??= mountArticlePage(sourceDocument, sourceWindow);
      controller ??= mountSearchPage(sourceDocument, sourceWindow, navigation, pendingSearchScroll);
      pendingSearchScroll = undefined;
      if (controller?.view) {
        navigation.replaceViewUrl(controller.view.normalize(new URL(sourceWindow.location.href)));
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      destroyCurrentPage();
      pendingSearchScroll = undefined;
    },
  };
}
