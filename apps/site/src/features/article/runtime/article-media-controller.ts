import type PhotoSwipe from 'photoswipe';
import type PhotoSwipeLightbox from 'photoswipe/lightbox';
import photoSwipeStylesheetHref from 'photoswipe/style.css?url';

export type ArticleMediaController = {
  destroy(): void;
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
  let lightbox: PhotoSwipeLightbox | undefined;
  let closingViewer: PhotoSwipe | undefined;
  const sourceDocument = article.ownerDocument;
  const closeViewer = () => {
    if (!lightbox) return;
    // Cancel only an already requested open. The next click starts a new one.
    lightbox.shouldOpen = false;
    const viewer = lightbox.pswp;
    if (!viewer || viewer === closingViewer) return;

    // A cancelled viewer must not take focus during its late opening/closing events.
    viewer.options.trapFocus = false;
    viewer.options.returnFocus = false;
    if (!viewer.opener.isOpening) {
      viewer.close();
      return;
    }

    // PhotoSwipe ignores close/destroy during opening. Keep this cleanup on the
    // exact instance, even if the article is destroyed before its animation ends.
    closingViewer = viewer;
    const closeAfterOpening = () => {
      viewer.off('openingAnimationEnd', closeAfterOpening);
      if (closingViewer === viewer) closingViewer = undefined;
      viewer.close();
    };
    viewer.on('openingAnimationEnd', closeAfterOpening);
  };
  gallery.dataset.articleMediaRuntime = 'loading';
  sourceDocument.addEventListener('astro:before-preparation', closeViewer);

  void Promise.all([
    import('photoswipe/lightbox'),
    import('photoswipe'),
    preparePhotoSwipeStylesheet(article.ownerDocument),
  ])
    .then(([{ default: PhotoSwipeLightbox }, { default: PhotoSwipe }]) => {
      if (destroyed || !gallery.isConnected) return;

      lightbox = new PhotoSwipeLightbox({
        gallery,
        children: 'a[data-article-media-item]',
        pswpModule: PhotoSwipe,
        bgOpacity: 0.92,
      });
      lightbox.on('openingAnimationEnd', () => {
        if (destroyed) return;
        gallery.dataset.articleMediaViewer = 'open';
      });
      lightbox.on('closingAnimationStart', () => {
        if (!destroyed) gallery.dataset.articleMediaViewer = 'closing';
      });
      lightbox.on('destroy', () => {
        if (!destroyed) delete gallery.dataset.articleMediaViewer;
      });
      // Do not intercept image links until every viewer dependency is ready.
      lightbox.init();
      gallery.dataset.articleMediaRuntime = 'ready';
    })
    .catch((error: unknown) => {
      if (destroyed) return;
      gallery.dataset.articleMediaRuntime = 'fallback';
      console.error('Failed to prepare the article image viewer', error);
    });

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      sourceDocument.removeEventListener('astro:before-preparation', closeViewer);
      closeViewer();
      lightbox?.destroy();
      lightbox = undefined;
      delete gallery.dataset.articleMediaRuntime;
      delete gallery.dataset.articleMediaViewer;
    },
  };
}
