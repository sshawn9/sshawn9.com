import { createBlogSidebarController, type BlogSidebarController } from './blog-sidebar-controller';
import { applyBlogViewState, createBlogViewUrl } from './blog-view-state';
import {
  persistCurrentScroll,
  readCurrentScroll,
  restoreNestedScroll,
} from '../../../runtime/scroll-state';

type BlogPageController = {
  destroy(): void;
};

function isUnmodifiedPrimaryClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function readSelectedSlugs(listing: HTMLElement): string[] {
  try {
    const value: unknown = JSON.parse(listing.dataset.selectedTags ?? '[]');
    return Array.isArray(value)
      ? value.filter((slug): slug is string => typeof slug === 'string')
      : [];
  } catch {
    return [];
  }
}

function orderSelectedSlugs(listing: HTMLElement, selected: ReadonlySet<string>): string[] {
  return [...listing.querySelectorAll<HTMLElement>('[data-blog-tag-definition]')]
    .map((element) => element.dataset.tagSlug)
    .filter((slug): slug is string => Boolean(slug && selected.has(slug)));
}

function createBlogPageController(
  listing: HTMLElement,
  sourceDocument: Document,
  sourceWindow: Window,
): BlogPageController {
  const listeners = new AbortController();
  const layout = listing.querySelector<HTMLElement>('[data-blog-sidebar-layout]');
  const sidebarController: BlogSidebarController | undefined = layout
    ? createBlogSidebarController(layout, sourceWindow)
    : undefined;
  const mobileDisclosure = listing.querySelector<HTMLButtonElement>('[data-blog-mobile-toggle]');
  const mobilePanel = listing.querySelector<HTMLElement>('[data-blog-mobile-panel]');
  const mobileMedia = sourceWindow.matchMedia('(max-width: 63.999rem)');
  let mobileExpanded = true;

  const normalizeCurrentUrl = () => {
    const state = applyBlogViewState(listing, new URL(sourceWindow.location.href));
    const current = `${sourceWindow.location.pathname}${sourceWindow.location.search}`;
    const normalized = `${state.normalizedUrl.pathname}${state.normalizedUrl.search}`;
    if (current !== normalized) {
      sourceWindow.history.replaceState(sourceWindow.history.state, '', state.normalizedUrl);
    }
    persistCurrentScroll(sourceDocument, sourceWindow);
  };

  const commitView = (url: URL, scrollToResults: boolean) => {
    persistCurrentScroll(sourceDocument, sourceWindow);
    sourceWindow.history.pushState(sourceWindow.history.state, '', url);
    applyBlogViewState(listing, url);
    persistCurrentScroll(sourceDocument, sourceWindow);
    if (scrollToResults) {
      sourceWindow.requestAnimationFrame(() => {
        listing.querySelector('[data-blog-results]')?.scrollIntoView({
          behavior: sourceWindow.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
          block: 'start',
        });
      });
    }
  };

  const handleClick = (event: MouseEvent) => {
    if (!isUnmodifiedPrimaryClick(event)) return;
    const source = event.target instanceof Element ? event.target : undefined;
    const filterLink = source?.closest<HTMLAnchorElement>('[data-blog-filter-link]');
    if (filterLink && listing.contains(filterLink) && listing.dataset.blogFilterable === 'true') {
      const slug = filterLink.dataset.tagSlug;
      if (!slug) return;
      event.preventDefault();
      const selected = new Set(readSelectedSlugs(listing));
      if (selected.has(slug)) selected.delete(slug);
      else selected.add(slug);
      const ordered = orderSelectedSlugs(listing, selected);
      commitView(createBlogViewUrl(new URL(sourceWindow.location.href), ordered, 1), false);
      return;
    }

    const pageLink = source?.closest<HTMLAnchorElement>('[data-blog-page]');
    if (!pageLink || !listing.contains(pageLink) || pageLink.hidden) return;
    event.preventDefault();
    commitView(new URL(pageLink.href), true);
  };

  const handleTraversal = () => {
    applyBlogViewState(listing, new URL(sourceWindow.location.href));
    const snapshot = readCurrentScroll(sourceWindow);
    if (snapshot) {
      sourceWindow.requestAnimationFrame(() => restoreNestedScroll(sourceDocument, snapshot));
    }
  };

  const applyMobileDisclosure = () => {
    if (!mobileDisclosure || !mobilePanel) return;
    const collapsed = mobileMedia.matches && !mobileExpanded;
    mobileDisclosure.setAttribute('aria-expanded', String(!collapsed));
    layout?.toggleAttribute('data-mobile-tags-collapsed', collapsed);
    mobilePanel.inert = collapsed;
    if (collapsed) mobilePanel.setAttribute('aria-hidden', 'true');
    else mobilePanel.removeAttribute('aria-hidden');
  };

  listing.addEventListener('click', handleClick, { signal: listeners.signal });
  sourceWindow.addEventListener('popstate', handleTraversal, { signal: listeners.signal });
  mobileDisclosure?.addEventListener(
    'click',
    () => {
      mobileExpanded = !mobileExpanded;
      applyMobileDisclosure();
    },
    { signal: listeners.signal },
  );
  mobileMedia.addEventListener('change', applyMobileDisclosure, { signal: listeners.signal });

  normalizeCurrentUrl();
  applyMobileDisclosure();
  listing.setAttribute('data-blog-runtime-ready', '');

  return {
    destroy() {
      listeners.abort();
      sidebarController?.destroy();
      listing.removeAttribute('data-blog-runtime-ready');
    },
  };
}

export function mountBlogPage(
  sourceDocument: Document = document,
  sourceWindow: Window = window,
): BlogPageController | undefined {
  const listing = sourceDocument.querySelector<HTMLElement>('[data-blog-listing]');
  return listing ? createBlogPageController(listing, sourceDocument, sourceWindow) : undefined;
}
