import type { TransitionBeforeSwapEvent } from 'astro:transitions/client';
import { mountArticlePage } from '../features/article/runtime/article-controller';
import { mountBlogPage } from '../features/blog/runtime/blog-controller';
import { mountSearchPage } from '../features/search/runtime/search-controller';
import { readCurrentScroll } from './scroll-state';

type PageController = {
  destroy(): void;
};

/**
 * Owns the single page-scoped lifecycle beneath the persistent site shell.
 * Feature controllers mount against the current server-rendered page and are
 * destroyed before Astro removes that page from the document.
 */
export function installPageRuntime(
  sourceDocument: Document = document,
  sourceWindow: Window = window,
): () => void {
  let controller: PageController | undefined;
  let mountedPage: Element | undefined;
  let pendingSearchScroll: ReturnType<typeof readCurrentScroll>;
  let disposed = false;

  const destroyCurrentPage = (): void => {
    controller?.destroy();
    controller = undefined;
    mountedPage = undefined;
  };

  const mountCurrentPage = (): void => {
    if (disposed) return;
    const page = sourceDocument.querySelector('main');
    if (page && page === mountedPage) return;
    destroyCurrentPage();
    mountedPage = page ?? undefined;
    controller = mountBlogPage(sourceDocument, sourceWindow);
    controller ??= mountArticlePage(sourceDocument, sourceWindow);
    controller ??= mountSearchPage(sourceDocument, sourceWindow, pendingSearchScroll);
    pendingSearchScroll = undefined;
  };

  const preparePageSwap = (rawEvent: Event): void => {
    const event = rawEvent as TransitionBeforeSwapEvent;
    destroyCurrentPage();
    pendingSearchScroll = event.newDocument.querySelector('[data-site-search]')
      ? readCurrentScroll(sourceWindow, event.to)
      : undefined;
  };

  sourceDocument.addEventListener('astro:before-swap', preparePageSwap);
  sourceDocument.addEventListener('astro:page-load', mountCurrentPage);
  mountCurrentPage();

  return () => {
    if (disposed) return;
    disposed = true;
    sourceDocument.removeEventListener('astro:before-swap', preparePageSwap);
    sourceDocument.removeEventListener('astro:page-load', mountCurrentPage);
    destroyCurrentPage();
    pendingSearchScroll = undefined;
  };
}
