import {
  ARTICLE_HEADING_SELECTOR,
  ARTICLE_TOC_LINK_SELECTOR,
  readArticleHeadingOffset,
  setActiveArticleToc,
  synchronizeArticleToc,
} from './article-toc-state';

export type ArticleTocController = {
  destroy(): void;
};

function ensureActiveLinkVisible(sourceDocument: Document): void {
  for (const link of sourceDocument.querySelectorAll<HTMLElement>(
    `${ARTICLE_TOC_LINK_SELECTOR}[data-active]`,
  )) {
    if (link.offsetParent === null) continue;
    const region = link.closest<HTMLElement>('[data-scroll-region]');
    if (!region) continue;

    const linkBox = link.getBoundingClientRect();
    const regionBox = region.getBoundingClientRect();
    if (linkBox.top < regionBox.top) {
      region.scrollTo({ top: region.scrollTop + linkBox.top - regionBox.top });
    } else if (linkBox.bottom > regionBox.bottom) {
      region.scrollTo({ top: region.scrollTop + linkBox.bottom - regionBox.bottom });
    }
  }
}

export function createArticleTocController(
  article: HTMLElement,
  sourceDocument: Document,
  sourceWindow: Window,
): ArticleTocController {
  const listeners = new AbortController();
  let frame = 0;
  let pendingTarget: { slug: string; y: number } | undefined;

  const reconcile = () => {
    frame = 0;
    if (pendingTarget) {
      setActiveArticleToc(sourceDocument, pendingTarget.slug);
      if (Math.abs(sourceWindow.scrollY - pendingTarget.y) <= 1) pendingTarget = undefined;
    }
    if (!pendingTarget) synchronizeArticleToc(sourceDocument, sourceWindow);
    ensureActiveLinkVisible(sourceDocument);
  };

  const scheduleReconcile = () => {
    if (frame !== 0) return;
    frame = sourceWindow.requestAnimationFrame(reconcile);
  };

  const cancelPendingTarget = () => {
    pendingTarget = undefined;
    scheduleReconcile();
  };

  const handleClick = (event: MouseEvent) => {
    // Check before changing state. Astro's later document listener also prevents
    // the default action when it handles an otherwise valid navigation.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;

    const source = event.target instanceof Element ? event.target : undefined;
    const link = source?.closest<HTMLAnchorElement>(ARTICLE_TOC_LINK_SELECTOR);
    if (
      !link ||
      !article.contains(link) ||
      (link.target && link.target !== '_self') ||
      link.hasAttribute('download')
    )
      return;
    const slug = link.dataset.tocSlug;
    const heading = slug ? sourceDocument.getElementById(slug) : undefined;
    if (
      !slug ||
      !heading ||
      !article.contains(heading) ||
      !heading.matches(ARTICLE_HEADING_SELECTOR)
    )
      return;

    try {
      const destination = new URL(link.href);
      const current = sourceWindow.location;
      if (
        destination.origin !== current.origin ||
        destination.pathname !== current.pathname ||
        destination.search !== current.search ||
        decodeURIComponent(destination.hash.slice(1)) !== slug
      )
        return;
    } catch {
      return;
    }

    const offset = readArticleHeadingOffset(heading, sourceWindow);
    const requestedY = sourceWindow.scrollY + heading.getBoundingClientRect().top - offset;
    const maximumY = Math.max(
      0,
      sourceDocument.documentElement.scrollHeight - sourceWindow.innerHeight,
    );
    pendingTarget = { slug, y: Math.min(maximumY, Math.max(0, requestedY)) };
    setActiveArticleToc(sourceDocument, slug);

    // Only activating a link inside the mobile TOC can close that popover.
    // Desktop TOC interactions do not depend on the Popover API.
    const mobileToc = link.closest<HTMLElement>('[data-article-mobile-toc]');
    if (mobileToc && typeof mobileToc.hidePopover === 'function') {
      mobileToc.hidePopover();
    }
    scheduleReconcile();
  };

  article.addEventListener('click', handleClick, { signal: listeners.signal });
  sourceDocument.addEventListener('scroll', scheduleReconcile, {
    capture: true,
    passive: true,
    signal: listeners.signal,
  });
  sourceWindow.addEventListener('resize', scheduleReconcile, { signal: listeners.signal });
  sourceWindow.addEventListener('scrollend', scheduleReconcile, { signal: listeners.signal });
  sourceWindow.addEventListener('wheel', cancelPendingTarget, {
    passive: true,
    signal: listeners.signal,
  });
  sourceWindow.addEventListener('touchstart', cancelPendingTarget, {
    passive: true,
    signal: listeners.signal,
  });
  sourceWindow.addEventListener(
    'keydown',
    (event) => {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) {
        cancelPendingTarget();
      }
    },
    { signal: listeners.signal },
  );
  synchronizeArticleToc(sourceDocument, sourceWindow);

  return {
    destroy() {
      if (frame !== 0) sourceWindow.cancelAnimationFrame(frame);
      listeners.abort();
    },
  };
}
