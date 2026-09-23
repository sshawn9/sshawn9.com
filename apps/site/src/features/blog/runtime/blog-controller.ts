import { createBlogSidebarController, type BlogSidebarController } from './blog-sidebar-controller';
import {
  BLOG_VIEW_PARAMETERS,
  deriveBlogViewState,
  type BlogIntent,
  type BlogPageSize,
} from './blog-state';
import { createBlogView } from './blog-view';
import { createBlogPageSizeController } from './blog-page-size-controller';
import { createBlogPaginationLayout } from './blog-pagination-layout';
import { bindBlogPaginationTooltips } from './blog-pagination-tooltips';
import { getBlogPageSizePreference } from './blog-page-size-preference';
import { rethrowAfterCleanup, runCleanups } from '../../../runtime/cleanup';
import {
  belongsToView,
  type PageController,
  type PageNavigation,
  type ViewUpdate,
} from '../../../runtime/page-navigation';

function isUnmodifiedPrimaryClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function createBlogPageController(
  listing: HTMLElement,
  sourceWindow: Window,
  navigation: PageNavigation,
): PageController {
  const listeners = new AbortController();
  const view = createBlogView(listing);
  const preference = getBlogPageSizePreference(sourceWindow);
  const initialState = deriveBlogViewState(
    view.catalog,
    new URL(sourceWindow.location.href),
    preference.get(),
  );
  const resource = {
    resourceUrl: initialState.normalizedUrl,
    queryParameters: BLOG_VIEW_PARAMETERS,
  };
  const layout = listing.querySelector<HTMLElement>('[data-blog-sidebar-layout]');
  let sidebarController: BlogSidebarController | undefined;
  let pageSizeController: ReturnType<typeof createBlogPageSizeController> | undefined;
  let paginationLayout: ReturnType<typeof createBlogPaginationLayout>;
  const mobileDisclosure = listing.querySelector<HTMLButtonElement>('[data-blog-mobile-toggle]');
  const mobilePanel = listing.querySelector<HTMLElement>('[data-blog-mobile-panel]');
  const mobileMedia = sourceWindow.matchMedia('(max-width: 63.999rem)');
  let mobileExpanded = false;
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
      () => pageSizeController?.destroy(),
      () => paginationLayout?.destroy(),
      restoreMobileFallback,
      () => view.pageSize?.trigger.setAttribute('disabled', ''),
      () => listing.removeAttribute('data-blog-runtime-ready'),
    );
  };

  const resolve = (url: URL, pageSize: BlogPageSize, intent?: BlogIntent): ViewUpdate => {
    const state = deriveBlogViewState(view.catalog, url, pageSize, intent);
    return {
      url: state.normalizedUrl,
      apply: () => view.render(state),
      afterApply: () => paginationLayout?.update(),
    };
  };

  const refresh = (pageSize = preference.get()) => {
    navigation.requestViewRefresh((url) => resolve(url, pageSize));
  };

  const request = (intent: BlogIntent, sourceElement: Element) => {
    // Capture this action's preference now; resolve its page after earlier actions commit.
    const pageSize = preference.get();
    navigation.requestViewUpdate((url) => resolve(url, pageSize, intent), {
      sourceElement,
      resolveScroll: intent.kind === 'page' ? paginationLayout?.resolveScroll : undefined,
    });
  };

  const handleClick = (event: MouseEvent) => {
    if (!isUnmodifiedPrimaryClick(event)) return;
    const source = event.target instanceof Element ? event.target : undefined;
    const filterLink = source?.closest<HTMLAnchorElement>('[data-blog-filter-link]');
    if (filterLink && listing.contains(filterLink) && listing.dataset.blogFilterable === 'true') {
      const slug = filterLink.dataset.tagSlug;
      if (!slug) return;
      event.preventDefault();
      request({ kind: 'tag', slug }, filterLink);
      return;
    }

    const pageLink = source?.closest<HTMLAnchorElement>('[data-blog-page]');
    if (!pageLink || !listing.contains(pageLink)) return;
    if (pageLink.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
      return;
    }
    if (!belongsToView(resource, new URL(pageLink.href))) return;
    const direction = pageLink.dataset.blogPage;
    if (direction !== 'previous' && direction !== 'next') return;
    event.preventDefault();
    request({ kind: 'page', direction }, pageLink);
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
    paginationLayout = createBlogPaginationLayout(listing, sourceWindow);
    bindBlogPaginationTooltips(listing, sourceWindow, listeners.signal);
    listing.addEventListener('click', handleClick, { signal: listeners.signal });
    if (view.pageSize) {
      const sizeView = view.pageSize;
      pageSizeController = createBlogPageSizeController(sizeView, sourceWindow, preference.set);
    }
    mobileDisclosure?.addEventListener(
      'click',
      () => {
        mobileExpanded = !mobileExpanded;
        applyMobileDisclosure();
      },
      { signal: listeners.signal },
    );
    mobileMedia.addEventListener('change', applyMobileDisclosure, { signal: listeners.signal });

    view.render(initialState);
    applyMobileDisclosure();
    paginationLayout?.update();
    listing.setAttribute('data-blog-runtime-ready', '');
    enableMobileDisclosure();
    view.pageSize?.trigger.removeAttribute('disabled');
    preference.subscribe(refresh, listeners.signal);
  } catch (error) {
    rethrowAfterCleanup(error, destroy);
  }

  return {
    view: {
      ...resource,
      resolve: (url) => resolve(url, preference.get()),
      refresh,
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
