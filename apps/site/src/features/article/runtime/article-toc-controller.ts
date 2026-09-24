import {
  ARTICLE_TOC_LINK_SELECTOR,
  findReadingArticleHeading,
  readArticleFragmentTarget,
  readInitialArticleTarget,
  reflectArticleTocTarget,
  setActiveArticleToc,
} from './article-toc-state';
import { rethrowAfterCleanup, runCleanups } from '../../../runtime/cleanup';
import { routeKey } from '../../../runtime/scroll-state';

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
  const articleRoute = routeKey(sourceWindow.location);
  let destroyed = false;
  let frame = 0;
  let target: HTMLElement | undefined;
  let manualScrollStart: number | undefined;
  const readingY = () => sourceWindow.scrollY + (sourceWindow.visualViewport?.offsetTop ?? 0);
  let lastScrollY = readingY();
  let activeSlug: string | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const updateTarget = (next: HTMLElement | undefined) => {
    target = next;
    reflectArticleTocTarget(sourceDocument, next);
  };

  const render = () => {
    if (target && !target.isConnected) updateTarget(undefined);
    const slug = target?.id ?? findReadingArticleHeading(sourceDocument, sourceWindow)?.id;
    if (slug !== activeSlug) {
      setActiveArticleToc(sourceDocument, slug);
      ensureActiveLinkVisible(sourceDocument);
      activeSlug = slug;
    }
  };

  const scheduleRender = () => {
    if (destroyed || frame !== 0) return;
    frame = sourceWindow.requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  };

  const selectTarget = (next: HTMLElement | undefined) => {
    updateTarget(next);
    manualScrollStart = undefined;
    // Selection follows the action immediately, including same-position links.
    render();
  };

  const recordManualScroll = (event: Event, direction = 0) => {
    if (!target || event.defaultPrevented) return;
    // A nested scroller owns its input until it can chain to the document.
    // Its wheel/touch/key events still bubble to Window during a chapter jump.
    for (const node of event.composedPath()) {
      if (node === sourceDocument.scrollingElement) break;
      if (!(node instanceof Element)) continue;
      const style = sourceWindow.getComputedStyle(node);
      if (!['auto', 'scroll'].includes(style.overflowY)) continue;
      if (['contain', 'none'].includes(style.overscrollBehaviorY)) return;
      if (
        node.scrollHeight > node.clientHeight &&
        (direction === 0 ||
          (direction < 0 && node.scrollTop > 0) ||
          (direction > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1))
      )
        return;
    }
    // Passive wheel events can arrive after the compositor has already moved.
    // Compare against the last observed document position, not that new value.
    manualScrollStart = lastScrollY;
  };

  const handlePositionChange = () => {
    const position = readingY();
    if (manualScrollStart !== undefined && position !== manualScrollStart) {
      updateTarget(undefined);
      manualScrollStart = undefined;
    }
    lastScrollY = position;
    scheduleRender();
  };

  const handleScroll = (event: Event) => {
    if (event.target === sourceDocument) handlePositionChange();
  };

  const handleViewportResize = () => {
    manualScrollStart = undefined;
    lastScrollY = readingY();
    scheduleRender();
  };

  const handleHistoryTraversal = (event: PopStateEvent) => {
    // Link clicks already select their target; Astro's null-state notification
    // must not restore a previous reading mode over that selection.
    if (event.state === null) return;
    // A cross-page traversal changes the address before this article unmounts.
    if (routeKey(sourceWindow.location) !== articleRoute) return;
    selectTarget(readInitialArticleTarget(sourceDocument, sourceWindow));
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
    const link = source?.closest<HTMLAnchorElement>('a[href]');
    if (
      !link ||
      !article.contains(link) ||
      (link.target && link.target !== '_self') ||
      link.hasAttribute('download')
    )
      return;
    let destination: URL;
    try {
      destination = new URL(link.href);
    } catch {
      return;
    }
    const current = sourceWindow.location;
    if (
      destination.origin !== current.origin ||
      destination.pathname !== current.pathname ||
      destination.search !== current.search
    )
      return;
    const heading = readArticleFragmentTarget(sourceDocument, destination.href);
    if (!heading || !article.contains(heading)) return;
    if (link.dataset.tocSlug && link.dataset.tocSlug !== heading.id) return;
    selectTarget(heading);

    // Only activating a link inside the mobile TOC can close that popover.
    // Desktop TOC interactions do not depend on the Popover API.
    const mobileToc = link.closest<HTMLElement>('[data-article-mobile-toc]');
    if (mobileToc && typeof mobileToc.hidePopover === 'function') {
      mobileToc.hidePopover();
    }
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    runCleanups(
      () => listeners.abort(),
      () => resizeObserver?.disconnect(),
      () => {
        if (frame !== 0) sourceWindow.cancelAnimationFrame(frame);
        frame = 0;
      },
    );
  };

  try {
    article.addEventListener('click', handleClick, { signal: listeners.signal });
    sourceDocument.addEventListener('scroll', handleScroll, {
      capture: true,
      passive: true,
      signal: listeners.signal,
    });
    sourceWindow.addEventListener('popstate', handleHistoryTraversal, { signal: listeners.signal });
    sourceWindow.addEventListener('resize', handleViewportResize, { signal: listeners.signal });
    sourceWindow.visualViewport?.addEventListener('resize', handleViewportResize, {
      signal: listeners.signal,
    });
    sourceWindow.visualViewport?.addEventListener('scroll', handlePositionChange, {
      signal: listeners.signal,
    });
    sourceWindow.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey && event.deltaY !== 0) recordManualScroll(event, event.deltaY);
      },
      {
        passive: true,
        signal: listeners.signal,
      },
    );
    sourceWindow.addEventListener('touchmove', recordManualScroll, {
      passive: true,
      signal: listeners.signal,
    });
    sourceWindow.addEventListener('pointerdown', recordManualScroll, {
      passive: true,
      signal: listeners.signal,
    });
    sourceWindow.addEventListener(
      'keydown',
      (event) => {
        if (
          !event.defaultPrevented &&
          ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)
        ) {
          const source = event.target instanceof Element ? event.target : undefined;
          if (
            source?.closest(
              'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
            )
          )
            return;
          if (event.key === ' ' && source?.closest('button, [role="button"]')) return;
          const direction =
            ['ArrowUp', 'PageUp', 'Home'].includes(event.key) ||
            (event.key === ' ' && event.shiftKey)
              ? -1
              : 1;
          recordManualScroll(event, direction);
        }
      },
      { signal: listeners.signal },
    );
    updateTarget(readInitialArticleTarget(sourceDocument, sourceWindow));
    activeSlug = target?.id ?? findReadingArticleHeading(sourceDocument, sourceWindow)?.id;
    // Mounting must preserve a sidebar position already restored by navigation.
    setActiveArticleToc(sourceDocument, activeSlug);
    const Resize = (sourceWindow as Window & typeof globalThis).ResizeObserver;
    const prose = article.querySelector<HTMLElement>('.article-prose');
    if (Resize && prose) {
      resizeObserver = new Resize(scheduleRender);
      resizeObserver.observe(prose);
    }

    return { destroy };
  } catch (error) {
    rethrowAfterCleanup(error, destroy);
  }
}
