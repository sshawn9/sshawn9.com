import photoSwipeStylesheetHref from 'photoswipe/style.css?url';

export type ArticleMediaController = {
  destroy(): void;
};

type Lightbox = {
  pswp?: {
    opener: { isOpening: boolean };
    close(): void;
  };
  init(): void;
  destroy(): void;
  on(eventName: string, listener: () => void): void;
};

let stylesheetPreparation: { link: HTMLLinkElement; ready: Promise<void> } | undefined;

function preparePhotoSwipeStylesheet(sourceDocument: Document): Promise<void> {
  // A failed request or an Astro head swap removes the resource. A settled
  // Promise from that old link must not stand in for the current document's CSS.
  if (
    stylesheetPreparation?.link.isConnected &&
    stylesheetPreparation.link.ownerDocument === sourceDocument
  ) {
    return stylesheetPreparation.ready;
  }

  const link = sourceDocument.createElement('link');
  link.rel = 'stylesheet';
  link.href = photoSwipeStylesheetHref;
  link.dataset.articleMediaStylesheet = '';
  const ready = new Promise<void>((resolve, reject) => {
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener(
      'error',
      () => {
        link.remove();
        reject(new Error('PhotoSwipe stylesheet failed to load.'));
      },
      { once: true },
    );
  });
  stylesheetPreparation = { link, ready };
  sourceDocument.head.append(link);
  return ready;
}

/** Enhances explicit image attachments while preserving their ordinary anchor fallback. */
export function createArticleMediaController(article: HTMLElement): ArticleMediaController {
  const gallery = article.querySelector<HTMLElement>('.article-prose');
  if (!gallery?.querySelector('a[data-article-media-item]')) {
    return { destroy() {} };
  }

  let destroyed = false;
  let lightbox: Lightbox | undefined;
  let closeRequested = false;
  const sourceDocument = article.ownerDocument;
  const closeViewer = () => {
    closeRequested = true;
    const viewer = lightbox?.pswp;
    if (viewer && !viewer.opener.isOpening) viewer.close();
  };
  gallery.dataset.articleMediaRuntime = 'loading';
  sourceDocument.addEventListener('astro:before-preparation', closeViewer);

  void Promise.all([
    import('photoswipe/lightbox'),
    preparePhotoSwipeStylesheet(article.ownerDocument),
  ])
    .then(([{ default: PhotoSwipeLightbox }]) => {
      if (destroyed || !gallery.isConnected) return;

      lightbox = new PhotoSwipeLightbox({
        gallery,
        children: 'a[data-article-media-item]',
        pswpModule: () => import('photoswipe'),
        bgOpacity: 0.92,
      });
      lightbox.on('openingAnimationEnd', () => {
        if (destroyed) return;
        if (closeRequested) {
          lightbox?.pswp?.close();
          return;
        }
        gallery.dataset.articleMediaViewer = 'open';
      });
      lightbox.on('closingAnimationStart', () => {
        if (!destroyed) gallery.dataset.articleMediaViewer = 'closing';
      });
      lightbox.on('destroy', () => {
        closeRequested = false;
        delete gallery.dataset.articleMediaViewer;
      });
      lightbox.init();
      gallery.dataset.articleMediaRuntime = 'ready';
    })
    .catch(() => {
      if (!destroyed) gallery.dataset.articleMediaRuntime = 'fallback';
    });

  return {
    destroy() {
      destroyed = true;
      closeRequested = false;
      sourceDocument.removeEventListener('astro:before-preparation', closeViewer);
      lightbox?.destroy();
      lightbox = undefined;
      delete gallery.dataset.articleMediaRuntime;
      delete gallery.dataset.articleMediaViewer;
    },
  };
}
