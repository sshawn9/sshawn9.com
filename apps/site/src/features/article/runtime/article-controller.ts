import {
  createArticleSidebarController,
  type ArticleSidebarController,
} from './article-sidebar-controller';
import { createArticleTocController, type ArticleTocController } from './article-toc-controller';
import {
  createArticleMediaController,
  type ArticleMediaController,
} from './article-media-controller';

type ArticlePageController = {
  destroy(): void;
};

function createArticlePageController(
  article: HTMLElement,
  sourceDocument: Document,
  sourceWindow: Window,
): ArticlePageController {
  const layout = article.querySelector<HTMLElement>('[data-article-sidebar-layout]');
  const sidebarController: ArticleSidebarController | undefined = layout
    ? createArticleSidebarController(layout, sourceWindow)
    : undefined;
  const tocController: ArticleTocController = createArticleTocController(
    article,
    sourceDocument,
    sourceWindow,
  );
  const mediaController: ArticleMediaController = createArticleMediaController(article);

  article.setAttribute('data-article-runtime-ready', '');
  return {
    destroy() {
      tocController.destroy();
      mediaController.destroy();
      sidebarController?.destroy();
      article.removeAttribute('data-article-runtime-ready');
    },
  };
}

export function mountArticlePage(
  sourceDocument: Document = document,
  sourceWindow: Window = window,
): ArticlePageController | undefined {
  const article = sourceDocument.querySelector<HTMLElement>('[data-article-page]');
  return article ? createArticlePageController(article, sourceDocument, sourceWindow) : undefined;
}
