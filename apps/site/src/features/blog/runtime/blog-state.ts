export const BLOG_DISPLAY_MODES = {
  detailed: { pageSizes: [5, 10, 20, 50], defaultPageSize: 5 },
  compact: { pageSizes: [15, 50, 100], defaultPageSize: 15 },
} as const;
export const DEFAULT_BLOG_DISPLAY_MODE = 'detailed';
export const BLOG_VIEW_PARAMETERS = ['tag', 'page'] as const;

export type BlogDisplayMode = keyof typeof BLOG_DISPLAY_MODES;
export type BlogPageSize = (typeof BLOG_DISPLAY_MODES)[BlogDisplayMode]['pageSizes'][number];
export type BlogReadingSettings = {
  readonly mode: BlogDisplayMode;
  readonly pageSizes: Readonly<Record<BlogDisplayMode, BlogPageSize>>;
};

export function readBlogDisplayMode(value: string | undefined): BlogDisplayMode {
  return value === 'compact' ? 'compact' : DEFAULT_BLOG_DISPLAY_MODE;
}

export type BlogCatalog = {
  filterable: boolean;
  tags: ReadonlyArray<{ name: string; slug: string }>;
  articleTags: ReadonlyArray<readonly string[]>;
};

export type BlogQuery = {
  selectedSlugs: string[];
  page: number;
};

export type BlogViewState = BlogQuery & {
  pageSize: BlogPageSize;
  pageCount: number;
  resultCount: number;
  rangeStart: number;
  rangeEnd: number;
  visibleIndices: number[];
  normalizedUrl: URL;
  previousUrl?: URL;
  nextUrl?: URL;
};

export type BlogIntent =
  { kind: 'page'; direction: 'previous' | 'next' } | { kind: 'tag'; slug: string };

function singleParameter(url: URL, name: string): string | undefined {
  const values = url.searchParams.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

export function readBlogPageSize(
  value: string | undefined,
  mode: BlogDisplayMode = DEFAULT_BLOG_DISPLAY_MODE,
): BlogPageSize {
  const { pageSizes, defaultPageSize } = BLOG_DISPLAY_MODES[mode];
  return pageSizes.find((size) => String(size) === value) ?? defaultPageSize;
}

function readPage(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function createBlogViewUrl(source: URL, query: BlogQuery): URL {
  const url = new URL(source.href);
  for (const name of BLOG_VIEW_PARAMETERS) url.searchParams.delete(name);
  for (const slug of query.selectedSlugs) url.searchParams.append('tag', slug);
  if (query.page > 1) url.searchParams.set('page', String(query.page));
  return url;
}

/** Route and reading preference are separate, explicit inputs to pagination. */
export function deriveBlogViewState(
  catalog: BlogCatalog,
  source: URL,
  pageSize: BlogPageSize,
  intent?: BlogIntent,
): BlogViewState {
  const requestedTags = new Set(source.searchParams.getAll('tag'));
  let tagChanged = false;
  const selectedSlugs = catalog.filterable
    ? catalog.tags
        .filter(({ name, slug }) => {
          const selected = requestedTags.has(name) || requestedTags.has(slug);
          if (intent?.kind === 'tag' && intent.slug === slug) {
            tagChanged = true;
            return !selected;
          }
          return selected;
        })
        .map(({ slug }) => slug)
    : [];
  const selected = new Set(selectedSlugs);
  const matchingIndices = catalog.articleTags.flatMap((tags, index) =>
    selected.size === 0 || tags.some((slug) => selected.has(slug)) ? [index] : [],
  );
  const resultCount = matchingIndices.length;
  const pageCount = Math.ceil(resultCount / pageSize);
  const lastPage = Math.max(1, pageCount);
  const currentPage = Math.min(readPage(singleParameter(source, 'page')), lastPage);
  const requestedPage = tagChanged
    ? 1
    : intent?.kind === 'page'
      ? currentPage + (intent.direction === 'next' ? 1 : -1)
      : currentPage;
  const page = Math.max(1, Math.min(requestedPage, lastPage));
  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, resultCount);
  const query = { selectedSlugs, page };
  const normalizedUrl = createBlogViewUrl(source, query);

  return {
    ...query,
    pageSize,
    pageCount,
    resultCount,
    rangeStart: resultCount === 0 ? 0 : start + 1,
    rangeEnd: end,
    visibleIndices: matchingIndices.slice(start, end),
    normalizedUrl,
    previousUrl: page > 1 ? createBlogViewUrl(source, { ...query, page: page - 1 }) : undefined,
    nextUrl: page < pageCount ? createBlogViewUrl(source, { ...query, page: page + 1 }) : undefined,
  };
}
