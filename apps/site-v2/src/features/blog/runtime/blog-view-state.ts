export const BLOG_PAGE_SIZE = 8;
export const BLOG_TAG_PARAMETER = 'tag';
export const BLOG_PAGE_PARAMETER = 'page';

export type BlogViewState = {
  selectedSlugs: string[];
  page: number;
  pageCount: number;
  resultCount: number;
  normalizedUrl: URL;
};

type BlogTagRecord = {
  name: string;
  slug: string;
};

function readArticleTagSlugs(element: HTMLElement): string[] {
  try {
    const value: unknown = JSON.parse(element.dataset.articleTagSlugs ?? '[]');
    return Array.isArray(value)
      ? value.filter((slug): slug is string => typeof slug === 'string')
      : [];
  } catch {
    return [];
  }
}

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}

export function createBlogViewUrl(source: URL, selectedSlugs: string[], page: number): URL {
  const url = new URL(source.href);
  url.searchParams.delete(BLOG_TAG_PARAMETER);
  url.searchParams.delete(BLOG_PAGE_PARAMETER);
  for (const slug of selectedSlugs) url.searchParams.append(BLOG_TAG_PARAMETER, slug);
  if (page > 1) url.searchParams.set(BLOG_PAGE_PARAMETER, String(page));
  return url;
}

function readTagRecords(listing: HTMLElement): BlogTagRecord[] {
  return [...listing.querySelectorAll<HTMLElement>('[data-blog-tag-definition]')].flatMap(
    (element) => {
      const name = element.dataset.tagName;
      const slug = element.dataset.tagSlug;
      return name && slug ? [{ name, slug }] : [];
    },
  );
}

export function deriveBlogViewState(listing: HTMLElement, sourceUrl: URL): BlogViewState {
  const filterable = listing.dataset.blogFilterable === 'true';
  const tagRecords = readTagRecords(listing);
  const requestedTags = sourceUrl.searchParams.getAll(BLOG_TAG_PARAMETER);
  const selectedSlugs = filterable
    ? tagRecords
        .filter(({ name, slug }) => requestedTags.includes(slug) || requestedTags.includes(name))
        .map(({ slug }) => slug)
    : [];
  const selected = new Set(selectedSlugs);
  const articles = [...listing.querySelectorAll<HTMLElement>('[data-blog-article]')];
  const resultCount = articles.filter((article) => {
    const articleTags = readArticleTagSlugs(article);
    return selected.size === 0 || articleTags.some((slug) => selected.has(slug));
  }).length;
  const pageCount = Math.max(1, Math.ceil(resultCount / BLOG_PAGE_SIZE));
  const requestedPage = Number.parseInt(sourceUrl.searchParams.get(BLOG_PAGE_PARAMETER) ?? '1', 10);
  const page = Math.min(pageCount, Math.max(1, Number.isFinite(requestedPage) ? requestedPage : 1));

  return {
    selectedSlugs,
    page,
    pageCount,
    resultCount,
    normalizedUrl: createBlogViewUrl(sourceUrl, selectedSlugs, page),
  };
}

/** Applies one URL-derived snapshot atomically to an already parsed static listing. */
export function applyBlogViewState(listing: HTMLElement, sourceUrl: URL): BlogViewState {
  const state = deriveBlogViewState(listing, sourceUrl);
  const selected = new Set(state.selectedSlugs);
  let matchingIndex = 0;

  for (const article of listing.querySelectorAll<HTMLElement>('[data-blog-article]')) {
    const articleTags = readArticleTagSlugs(article);
    const matches = selected.size === 0 || articleTags.some((slug) => selected.has(slug));
    const visibleOnPage =
      matches &&
      matchingIndex >= (state.page - 1) * BLOG_PAGE_SIZE &&
      matchingIndex < state.page * BLOG_PAGE_SIZE;
    article.hidden = !visibleOnPage;
    if (matches) matchingIndex += 1;
  }

  for (const link of listing.querySelectorAll<HTMLElement>('[data-blog-filter-link]')) {
    const isSelected = selected.has(link.dataset.tagSlug ?? '');
    link.toggleAttribute('data-selected', isSelected);
    link
      .querySelector<HTMLElement>('[data-blog-selected-copy]')
      ?.toggleAttribute('hidden', !isSelected);
  }

  const count = listing.querySelector<HTMLElement>('[data-blog-result-count]');
  if (count) {
    const template =
      state.pageCount > 1
        ? listing.dataset.pageCountTemplate
        : listing.dataset.articleCountTemplate;
    count.textContent = interpolate(template ?? '{count}', {
      count: state.resultCount,
      current: state.page,
      total: state.pageCount,
    });
  }

  const empty = listing.querySelector<HTMLElement>('[data-blog-empty]');
  if (empty) empty.hidden = state.resultCount !== 0;

  const pagination = listing.querySelector<HTMLElement>('[data-blog-pagination]');
  if (pagination) pagination.hidden = state.pageCount <= 1;

  const previous = listing.querySelector<HTMLAnchorElement>('[data-blog-page="previous"]');
  if (previous) {
    previous.hidden = state.page <= 1;
    previous.href = createBlogViewUrl(sourceUrl, state.selectedSlugs, state.page - 1).href;
  }
  const next = listing.querySelector<HTMLAnchorElement>('[data-blog-page="next"]');
  if (next) {
    next.hidden = state.page >= state.pageCount;
    next.href = createBlogViewUrl(sourceUrl, state.selectedSlugs, state.page + 1).href;
  }

  listing.dataset.selectedTags = JSON.stringify(state.selectedSlugs);
  listing.dataset.currentPage = String(state.page);
  listing.setAttribute('data-blog-view-ready', '');
  return state;
}

export function prepareTargetBlogView(targetDocument: Document, targetUrl: URL): void {
  const listing = targetDocument.querySelector<HTMLElement>('[data-blog-listing]');
  if (listing) applyBlogViewState(listing, targetUrl);
}

/** Emits the same state derivation and DOM transaction used after hydration. */
export function createBlogViewPrepaintScript(): string {
  return `(() => {
    const BLOG_PAGE_SIZE = ${BLOG_PAGE_SIZE};
    const BLOG_TAG_PARAMETER = ${JSON.stringify(BLOG_TAG_PARAMETER)};
    const BLOG_PAGE_PARAMETER = ${JSON.stringify(BLOG_PAGE_PARAMETER)};
    const readArticleTagSlugs = ${readArticleTagSlugs.toString()};
    const interpolate = ${interpolate.toString()};
    const createBlogViewUrl = ${createBlogViewUrl.toString()};
    const readTagRecords = ${readTagRecords.toString()};
    const deriveBlogViewState = ${deriveBlogViewState.toString()};
    const applyBlogViewState = ${applyBlogViewState.toString()};
    const listing = document.currentScript?.closest('[data-blog-listing]');
    if (listing) applyBlogViewState(listing, new URL(location.href));
  })();`;
}
