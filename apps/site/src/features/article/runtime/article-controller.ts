import {
  createArticleSidebarController,
  type ArticleSidebarController,
} from './article-sidebar-controller';
import { createArticleTocController, type ArticleTocController } from './article-toc-controller';
import {
  createArticleMediaController,
  type ArticleMediaController,
} from './article-media-controller';
import { rethrowAfterCleanup, runCleanups } from '../../../runtime/cleanup';

type ArticlePageController = {
  destroy(): void;
};

function createArticlePageController(
  article: HTMLElement,
  sourceDocument: Document,
  sourceWindow: Window,
): ArticlePageController {
  let sidebarController: ArticleSidebarController | undefined;
  let tocController: ArticleTocController | undefined;
  let mediaController: ArticleMediaController | undefined;
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    runCleanups(
      () => mediaController?.destroy(),
      () => tocController?.destroy(),
      () => sidebarController?.destroy(),
      () => article.removeAttribute('data-article-runtime-ready'),
    );
  };

  try {
    const layout = article.querySelector<HTMLElement>('[data-article-sidebar-layout]');
    sidebarController = layout ? createArticleSidebarController(layout, sourceWindow) : undefined;
    tocController = createArticleTocController(article, sourceDocument, sourceWindow);
    mediaController = createArticleMediaController(article);
    article.setAttribute('data-article-runtime-ready', '');
    return { destroy };
  } catch (error) {
    rethrowAfterCleanup(error, destroy);
  }
}

export function mountArticlePage(
  sourceDocument: Document = document,
  sourceWindow: Window = window,
): ArticlePageController | undefined {
  const article = sourceDocument.querySelector<HTMLElement>('[data-article-page]');
  return article ? createArticlePageController(article, sourceDocument, sourceWindow) : undefined;
}
