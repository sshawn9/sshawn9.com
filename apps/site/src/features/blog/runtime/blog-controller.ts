import { createBlogSidebarController, type BlogSidebarController } from './blog-sidebar-controller';
import { applyBlogViewState, createBlogViewUrl, deriveBlogViewState } from './blog-view-state';
import { rethrowAfterCleanup, runCleanups } from '../../../runtime/cleanup';
import type { PageController, PageNavigation } from '../../../runtime/page-navigation';

function isUnmodifiedPrimaryClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function orderSelectedSlugs(listing: HTMLElement, selected: ReadonlySet<string>): string[] {
  return [...listing.querySelectorAll<HTMLElement>('[data-blog-tag-definition]')]
    .map((element) => element.dataset.tagSlug)
    .filter((slug): slug is string => Boolean(slug && selected.has(slug)));
}

function createBlogPageController(
  listing: HTMLElement,
  sourceWindow: Window,
  navigation: PageNavigation,
): PageController {
  const listeners = new AbortController();
  const layout = listing.querySelector<HTMLElement>('[data-blog-sidebar-layout]');
  let sidebarController: BlogSidebarController | undefined;
  const mobileDisclosure = listing.querySelector<HTMLButtonElement>('[data-blog-mobile-toggle]');
  const mobilePanel = listing.querySelector<HTMLElement>('[data-blog-mobile-panel]');
  const mobileMedia = sourceWindow.matchMedia('(max-width: 63.999rem)');
  let mobileExpanded = true;
  let destroyed = false;

  const restoreMobileFallback = () => {
    mobileDisclosure?.setAttribute('disabled', '');
    mobileDisclosure?.setAttribute('aria-disabled', 'true');
    mobileDisclosure?.setAttribute('aria-expanded', 'true');
    if (mobilePanel) mobilePanel.inert = false;
    mobilePanel?.removeAttribute('aria-hidden');
    layout?.removeAttribute('data-mobile-tags-collapsed');
  };

  const enableMobileDisclosure = () => {
    mobileDisclosure?.removeAttribute('disabled');
    mobileDisclosure?.removeAttribute('aria-disabled');
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    const sidebar = sidebarController;
    sidebarController = undefined;
    runCleanups(
      () => listeners.abort(),
      () => sidebar?.destroy(),
      restoreMobileFallback,
      () => listing.removeAttribute('data-blog-runtime-ready'),
    );
  };

  const handleClick = (event: MouseEvent) => {
    if (!isUnmodifiedPrimaryClick(event)) return;
    const source = event.target instanceof Element ? event.target : undefined;
    const filterLink = source?.closest<HTMLAnchorElement>('[data-blog-filter-link]');
    if (filterLink && listing.contains(filterLink) && listing.dataset.blogFilterable === 'true') {
      const slug = filterLink.dataset.tagSlug;
      if (!slug) return;
      event.preventDefault();
      navigation.requestViewUpdate(
        (url) => {
          const selected = new Set(deriveBlogViewState(listing, url).selectedSlugs);
          if (selected.has(slug)) selected.delete(slug);
          else selected.add(slug);
          return createBlogViewUrl(url, orderSelectedSlugs(listing, selected), 1);
        },
        { sourceElement: filterLink },
      );
      return;
    }

    const pageLink = source?.closest<HTMLAnchorElement>('[data-blog-page]');
    if (!pageLink || !listing.contains(pageLink) || pageLink.hidden) return;
    event.preventDefault();
    navigation.requestViewUpdate(() => new URL(pageLink.href), {
      sourceElement: pageLink,
      scrollTarget: listing.querySelector<HTMLElement>('[data-blog-results]') ?? undefined,
    });
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

  try {
    sidebarController = layout ? createBlogSidebarController(layout, sourceWindow) : undefined;
    listing.addEventListener('click', handleClick, { signal: listeners.signal });
    mobileDisclosure?.addEventListener(
      'click',
      () => {
        mobileExpanded = !mobileExpanded;
        applyMobileDisclosure();
      },
      { signal: listeners.signal },
    );
    mobileMedia.addEventListener('change', applyMobileDisclosure, { signal: listeners.signal });

    applyBlogViewState(listing, new URL(sourceWindow.location.href));
    applyMobileDisclosure();
    listing.setAttribute('data-blog-runtime-ready', '');
    enableMobileDisclosure();
  } catch (error) {
    rethrowAfterCleanup(error, destroy);
  }

  return {
    view: {
      resourceUrl: new URL(sourceWindow.location.href),
      // Static tag pages also own `tag`: their existing normalizer removes it.
      queryParameters: ['tag', 'page'],
      normalize: (url) => deriveBlogViewState(listing, url).normalizedUrl,
      apply: (url) => {
        applyBlogViewState(listing, url);
      },
    },
    destroy,
  };
}

export function mountBlogPage(
  sourceDocument: Document,
  sourceWindow: Window,
  navigation: PageNavigation,
): PageController | undefined {
  const listing = sourceDocument.querySelector<HTMLElement>('[data-blog-listing]');
  return listing ? createBlogPageController(listing, sourceWindow, navigation) : undefined;
}
