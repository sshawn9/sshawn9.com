import { SITE_STORAGE_KEYS, getSiteBootstrapState } from '../lib/site-preferences';
import { claimClientRuntime } from './client-runtime';
import { whenTypographyReady } from './typography-controller';

const TOC_LINK_SELECTOR = '[data-article-toc] a[href^="#"]';
const HEADING_SELECTOR = '.js-toc-content :is(h2[id], h3[id])';

let cleanupCurrentToc = () => {};

function sectionStorageKey() {
  return `${SITE_STORAGE_KEYS.articleSectionPrefix}${location.pathname}`;
}

function linkSlug(link: HTMLAnchorElement) {
  try {
    return decodeURIComponent(new URL(link.href, location.href).hash.slice(1));
  } catch {
    return '';
  }
}

function setupArticleToc() {
  cleanupCurrentToc();

  const headings = [...document.querySelectorAll<HTMLElement>(HEADING_SELECTOR)];
  const links = [...document.querySelectorAll<HTMLAnchorElement>(TOC_LINK_SELECTOR)];
  if (headings.length === 0 || links.length === 0) {
    cleanupCurrentToc = () => {};
    return;
  }

  let activeSlug = '';
  let frame = 0;
  let disposed = false;
  let observer: IntersectionObserver | undefined;
  let fallbackScrollListener: (() => void) | undefined;
  const listeners = new AbortController();
  const headingOffset = Number.parseFloat(getComputedStyle(headings[0]).scrollMarginTop) || 0;
  const positionTolerance = 1 / Math.max(window.devicePixelRatio, 1);

  const setActive = (slug: string, persist = true) => {
    if (!slug || slug === activeSlug) return;
    activeSlug = slug;

    for (const link of links) {
      const active = linkSlug(link) === slug;
      link.classList.toggle('is-active-link', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }

    if (persist) {
      try {
        sessionStorage.setItem(sectionStorageKey(), slug);
      } catch {
        // A disabled storage backend does not prevent scroll tracking.
      }
    }
  };

  const findCurrentHeading = () => {
    let current = headings[0];
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top - headingOffset > positionTolerance) break;
      current = heading;
    }
    return current;
  };

  const reconcile = () => {
    frame = 0;
    const heading = findCurrentHeading();
    if (heading) setActive(heading.id);
  };

  const scheduleReconcile = () => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(reconcile);
  };

  const bootstrapSection = getSiteBootstrapState()?.articleSection;
  const hashSlug = location.hash ? decodeURIComponent(location.hash.slice(1)) : '';
  const initialSlug =
    hashSlug ||
    (bootstrapSection?.pathname === location.pathname ? bootstrapSection.slug : '') ||
    links.find((link) => link.classList.contains('is-active-link'))?.hash.slice(1) ||
    headings[0]?.id;
  if (initialSlug) setActive(initialSlug, false);

  for (const link of links) {
    link.addEventListener(
      'click',
      () => {
        const slug = linkSlug(link);
        if (slug) setActive(slug);
        document.querySelector<HTMLElement>('#article-toc-mobile')?.hidePopover();
      },
      { signal: listeners.signal },
    );
  }

  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(scheduleReconcile, {
      rootMargin: `-${headingOffset}px 0px -70% 0px`,
      threshold: [0, 1],
    });
    headings.forEach((heading) => observer?.observe(heading));
  } else {
    fallbackScrollListener = scheduleReconcile;
    window.addEventListener('scroll', fallbackScrollListener, { passive: true });
  }

  window.addEventListener('resize', scheduleReconcile, { signal: listeners.signal });
  window.addEventListener('pageshow', scheduleReconcile, { signal: listeners.signal });
  void whenTypographyReady().then(scheduleReconcile);
  requestAnimationFrame(() => requestAnimationFrame(reconcile));

  cleanupCurrentToc = () => {
    disposed = true;
    if (frame) cancelAnimationFrame(frame);
    listeners.abort();
    observer?.disconnect();
    if (fallbackScrollListener) window.removeEventListener('scroll', fallbackScrollListener);
    cleanupCurrentToc = () => {};
  };
}

const runtime = claimClientRuntime('article-toc');
runtime.listen(document, 'site:before-swap', () => cleanupCurrentToc());
runtime.listen(document, 'site:page-load', setupArticleToc);
runtime.onDispose(() => cleanupCurrentToc());
setupArticleToc();
