import { formatUiCopy } from '@sshawn9/site-i18n/copy';
import {
  deriveBlogViewState,
  type BlogCatalog,
  type BlogPageSize,
  type BlogViewState,
} from './blog-state';
import { createBlogPageSizeView } from './blog-page-size-view';

function articleTags(article: HTMLElement): string[] {
  try {
    const value: unknown = JSON.parse(article.dataset.articleTagSlugs ?? '[]');
    return Array.isArray(value)
      ? value.filter((slug): slug is string => typeof slug === 'string')
      : [];
  } catch {
    return [];
  }
}

function setText(element: HTMLElement | null, value: string): void {
  if (element && element.textContent !== value) element.textContent = value;
}

function setPageLink(
  link: HTMLAnchorElement | null,
  url: URL | undefined,
  targetPage: number,
  targetTemplate: string,
): void {
  if (!link) return;
  const tooltip = link.querySelector<HTMLElement>('[role="tooltip"]');
  setText(
    link.querySelector('[data-blog-page-target]'),
    url ? formatUiCopy(targetTemplate, { page: targetPage }) : '',
  );
  if (url) {
    link.href = url.href;
    link.removeAttribute('aria-disabled');
    link.removeAttribute('tabindex');
    if (tooltip) link.setAttribute('aria-describedby', tooltip.id);
  } else {
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
    link.tabIndex = -1;
    link.removeAttribute('aria-describedby');
  }
}

/** Bind immutable article metadata once; DOM visibility is output, never input. */
export function createBlogView(listing: HTMLElement) {
  const articles = [...listing.querySelectorAll<HTMLElement>('[data-blog-article]')];
  const catalog: BlogCatalog = {
    filterable: listing.dataset.blogFilterable === 'true',
    tags: [...listing.querySelectorAll<HTMLElement>('[data-blog-tag-definition]')].flatMap(
      (element) => {
        const name = element.dataset.tagName;
        const slug = element.dataset.tagSlug;
        return name && slug ? [{ name, slug }] : [];
      },
    ),
    articleTags: articles.map(articleTags),
  };
  const filters = [...listing.querySelectorAll<HTMLElement>('[data-blog-filter-link]')].map(
    (link) => ({
      link,
      selectedCopy: link.querySelector<HTMLElement>('[data-blog-selected-copy]'),
    }),
  );
  const count = listing.querySelector<HTMLElement>('[data-blog-result-count]');
  const pageStatus = listing.querySelector<HTMLElement>('[data-blog-page-status]');
  const currentPage = listing.querySelector<HTMLElement>('[data-blog-page-current]');
  const totalPages = listing.querySelector<HTMLElement>('[data-blog-page-total]');
  const pageSize = createBlogPageSizeView(listing);
  const empty = listing.querySelector<HTMLElement>('[data-blog-empty]');
  const pagination = listing.querySelector<HTMLElement>('[data-blog-pagination]');
  const pageTargetTemplate = pagination?.dataset.pageTargetTemplate ?? '{page}';
  const previous = listing.querySelector<HTMLAnchorElement>('[data-blog-page="previous"]');
  const next = listing.querySelector<HTMLAnchorElement>('[data-blog-page="next"]');

  return {
    catalog,
    pageSize,
    render(state: BlogViewState): void {
      const paginationHadFocus = pagination?.contains(listing.ownerDocument.activeElement);
      const visible = new Set(state.visibleIndices);
      articles.forEach((article, index) => {
        const hidden = !visible.has(index);
        if (article.hidden !== hidden) article.hidden = hidden;
      });
      const selected = new Set(state.selectedSlugs);
      for (const { link, selectedCopy } of filters) {
        const isSelected = selected.has(link.dataset.tagSlug ?? '');
        link.toggleAttribute('data-selected', isSelected);
        selectedCopy?.toggleAttribute('hidden', !isSelected);
      }

      const range =
        state.rangeStart === state.rangeEnd
          ? String(state.rangeStart)
          : `${state.rangeStart}–${state.rangeEnd}`;
      setText(
        count,
        formatUiCopy(
          (state.resultCount
            ? listing.dataset.articleRangeTemplate
            : listing.dataset.articleCountTemplate) ?? '{count}',
          { count: state.resultCount, range },
        ),
      );
      setText(
        pageStatus,
        state.pageCount > 0
          ? formatUiCopy(listing.dataset.pageCountTemplate ?? '{current} / {total}', {
              current: state.page,
              total: state.pageCount,
            })
          : '',
      );
      pageSize?.render(state.pageSize);
      setText(currentPage, String(state.page));
      setText(totalPages, String(state.pageCount));
      if (empty) empty.hidden = state.resultCount !== 0;
      if (pagination) pagination.hidden = state.pageCount <= 1;
      setPageLink(previous, state.previousUrl, state.page - 1, pageTargetTemplate);
      setPageLink(next, state.nextUrl, state.page + 1, pageTargetTemplate);
      listing.dataset.selectedTags = JSON.stringify(state.selectedSlugs);
      listing.dataset.currentPage = String(state.page);
      listing.dataset.pageSize = String(state.pageSize);
      listing.setAttribute('data-blog-view-ready', '');
      if (paginationHadFocus && pagination?.hidden && count) {
        count.tabIndex = -1;
        count.focus({ preventScroll: true });
      }
    },
  };
}

export function prepareTargetBlogView(
  targetDocument: Document,
  targetUrl: URL,
  pageSize: BlogPageSize,
): void {
  const listing = targetDocument.querySelector<HTMLElement>('[data-blog-listing]');
  if (!listing) return;
  const view = createBlogView(listing);
  view.render(deriveBlogViewState(view.catalog, targetUrl, pageSize));
}
