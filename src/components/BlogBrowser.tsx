import { ToggleButton } from '@kobalte/core/toggle-button';
import { For, Show, batch, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { Locale } from '../i18n/config';
import * as m from '../paraglide/messages.js';
import BlogSidebarLayout from './BlogSidebarLayout';
import BlogTagFilters, { type BlogTag } from './BlogTagFilters';

export type { BlogTag } from './BlogTagFilters';

export type BlogListArticle = {
  id: string;
  href: string;
  contentLanguage: string;
  title: string;
  description?: string;
  publishedDateTime: string;
  publishedLabel: string;
  tags: string[];
  tagHrefs: Record<string, string>;
};

type Props = {
  articles: BlogListArticle[];
  tags: BlogTag[];
  locale: Locale;
  filterable?: boolean;
};

const PAGE_SIZE = 8;
const TAG_PARAMETER = 'tag';
const PAGE_PARAMETER = 'page';

export default function BlogBrowser(props: Props) {
  const filterable = () => props.filterable !== false;
  const hasSidebar = () => filterable() && props.tags.length > 0;
  const tagsByName = new Map(props.tags.map((tag) => [tag.name, tag]));
  const [selectedTags, setSelectedTags] = createSignal<string[]>([]);
  const [pageIndex, setPageIndex] = createSignal(0);
  let browserElement!: HTMLDivElement;

  const filteredArticles = createMemo(() => {
    const selected = selectedTags();
    if (selected.length === 0) return props.articles;
    return props.articles.filter((article) => selected.some((tag) => article.tags.includes(tag)));
  });
  const filteredCount = createMemo(() => filteredArticles().length);
  const pageCount = createMemo(() => Math.ceil(filteredCount() / PAGE_SIZE));
  const visibleArticles = createMemo(() => {
    const start = pageIndex() * PAGE_SIZE;
    return filteredArticles().slice(start, start + PAGE_SIZE);
  });

  const orderTags = (values: Iterable<string>) => {
    const selected = new Set(values);
    return props.tags.map((tag) => tag.name).filter((tag) => selected.has(tag));
  };

  const createUrl = (tags: string[], nextPageIndex: number) => {
    const url = new URL(window.location.href);
    url.searchParams.delete(TAG_PARAMETER);
    url.searchParams.delete(PAGE_PARAMETER);

    tags.forEach((tag) => {
      const tagSlug = tagsByName.get(tag)?.slug;
      if (tagSlug) url.searchParams.append(TAG_PARAMETER, tagSlug);
    });
    if (nextPageIndex > 0) url.searchParams.set(PAGE_PARAMETER, String(nextPageIndex + 1));
    return url;
  };

  const replaceUrl = (tags: string[], nextPageIndex: number) => {
    const url = createUrl(tags, nextPageIndex);
    window.history.replaceState(window.history.state, '', url);
  };

  const setTags = (values: string[], updateUrl = true) => {
    const tags = orderTags(values);
    setSelectedTags(tags);
    setPageIndex(0);
    if (updateUrl) replaceUrl(tags, 0);
  };

  const setTagPressed = (tag: string, pressed: boolean) => {
    const tags = new Set(selectedTags());
    if (pressed) tags.add(tag);
    else tags.delete(tag);
    setTags([...tags]);
  };

  const setPage = (requestedPageIndex: number, updateUrl = true) => {
    const lastPageIndex = Math.max(0, pageCount() - 1);
    const nextPageIndex = Math.min(Math.max(0, requestedPageIndex), lastPageIndex);
    setPageIndex(nextPageIndex);
    if (updateUrl) {
      window.history.pushState(window.history.state, '', createUrl(selectedTags(), nextPageIndex));
    }
  };

  const scrollToResults = () => {
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';
    document.querySelector('[data-blog-results]')?.scrollIntoView({ behavior, block: 'start' });
  };

  const changePage = (nextPageIndex: number) => {
    setPage(nextPageIndex);
    requestAnimationFrame(scrollToResults);
  };

  const restoreUrlState = () => {
    const parameters = new URLSearchParams(window.location.search);
    const requestedTags = new Set(parameters.getAll(TAG_PARAMETER));
    const validTags = props.tags
      .filter((tag) => requestedTags.has(tag.slug) || requestedTags.has(tag.name))
      .map((tag) => tag.name);
    const requestedPage = Number.parseInt(parameters.get(PAGE_PARAMETER) ?? '1', 10);
    const initialPageIndex =
      Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage - 1 : 0;
    const matchingArticleCount =
      validTags.length === 0
        ? props.articles.length
        : props.articles.filter((article) => validTags.some((tag) => article.tags.includes(tag)))
            .length;
    const lastPageIndex = Math.max(0, Math.ceil(matchingArticleCount / PAGE_SIZE) - 1);

    batch(() => {
      setSelectedTags(validTags);
      setPageIndex(Math.min(initialPageIndex, lastPageIndex));
    });
  };

  onMount(() => {
    const listing = browserElement.closest<HTMLElement>('[data-blog-listing]');
    const parameters = new URLSearchParams(window.location.search);
    if (parameters.has(TAG_PARAMETER) || parameters.has(PAGE_PARAMETER)) {
      listing?.setAttribute('data-blog-browser-pending', '');
    }

    restoreUrlState();
    listing?.setAttribute('data-blog-browser-ready', '');
    if (listing?.hasAttribute('data-blog-browser-pending')) {
      requestAnimationFrame(() => {
        if (listing.isConnected) {
          // Solid has now updated the DOM; commit its final styles before revealing the listing.
          void listing.offsetWidth;
          listing.removeAttribute('data-blog-browser-pending');
        }
        document.documentElement.removeAttribute('data-blog-browser-pending');
      });
    } else {
      document.documentElement.removeAttribute('data-blog-browser-pending');
    }
    window.addEventListener('popstate', restoreUrlState);
    onCleanup(() => window.removeEventListener('popstate', restoreUrlState));
  });

  const ArticleResults = () => (
    <div class="@container min-w-0 scroll-mt-28" data-blog-results>
      <p class="text-supporting text-right font-mono text-xs" aria-live="polite">
        {m.blog_article_count({ count: filteredCount() }, { locale: props.locale })}
      </p>

      <Show
        when={filteredCount() > 0}
        fallback={
          <p class="text-supporting py-16 text-sm">{m.blog_empty({}, { locale: props.locale })}</p>
        }
      >
        <ol class="mt-2">
          <For each={visibleArticles()}>
            {(article) => (
              <li data-blog-article data-article-tags={JSON.stringify(article.tags)} data-reveal>
                <article class="group grid gap-4 border-b border-slate-900/10 py-7 @2xl:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)] @2xl:items-start @2xl:gap-7 dark:border-white/10">
                  <div class="min-w-0" lang={article.contentLanguage}>
                    <h2 class="text-xl font-extrabold tracking-tight sm:text-2xl">
                      <a href={article.href} class="interactive-heading">
                        {article.title}
                      </a>
                    </h2>
                    <Show when={article.description}>
                      {(description) => (
                        <p class="text-default mt-2 max-w-4xl text-sm leading-6">{description()}</p>
                      )}
                    </Show>
                  </div>

                  <footer class="min-w-0">
                    <time
                      datetime={article.publishedDateTime}
                      class="text-supporting mb-3 ml-2.5 block font-mono text-xs font-bold"
                    >
                      {article.publishedLabel}
                    </time>
                    <ul
                      class="flex flex-wrap items-center gap-2"
                      aria-label={m.article_tags({}, { locale: props.locale })}
                    >
                      <For each={article.tags}>
                        {(tag) => (
                          <li>
                            <Show
                              when={filterable()}
                              fallback={
                                <a
                                  href={article.tagHrefs[tag]}
                                  data-article-tag-link={tag}
                                  class="tag-chip block rounded-full px-2.5 py-1 font-mono text-[0.62rem]"
                                >
                                  #{tag}
                                </a>
                              }
                            >
                              <ToggleButton
                                pressed={selectedTags().includes(tag)}
                                onChange={(pressed) => setTagPressed(tag, pressed)}
                                data-article-tag={tag}
                                class="tag-chip rounded-full px-2.5 py-1 font-mono text-[0.62rem]"
                              >
                                #{tag}
                              </ToggleButton>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </footer>
                </article>
              </li>
            )}
          </For>
        </ol>
      </Show>

      <Show when={pageCount() > 1}>
        <nav
          class="mt-8 flex items-center justify-between gap-4"
          aria-label={m.pagination_label({}, { locale: props.locale })}
        >
          <button
            type="button"
            onClick={() => changePage(pageIndex() - 1)}
            disabled={pageIndex() === 0}
            class="interactive-supporting inline-flex items-center gap-2 text-sm font-bold disabled:pointer-events-none disabled:invisible"
          >
            <span aria-hidden="true">←</span>
            {m.pagination_previous({}, { locale: props.locale })}
          </button>

          <span class="text-supporting font-mono text-xs">
            {m.blog_page_count(
              {
                count: filteredCount(),
                current: pageIndex() + 1,
                total: pageCount(),
              },
              { locale: props.locale },
            )}
          </span>

          <button
            type="button"
            onClick={() => changePage(pageIndex() + 1)}
            disabled={pageIndex() >= pageCount() - 1}
            class="interactive-supporting inline-flex items-center gap-2 text-sm font-bold disabled:pointer-events-none disabled:invisible"
          >
            {m.pagination_next({}, { locale: props.locale })}
            <span aria-hidden="true">→</span>
          </button>
        </nav>
      </Show>
    </div>
  );

  return (
    <div ref={browserElement} data-blog-browser class="contents">
      <Show when={hasSidebar()} fallback={<ArticleResults />}>
        <BlogSidebarLayout
          locale={props.locale}
          sidebar={
            <BlogTagFilters
              tags={props.tags}
              selectedTags={selectedTags()}
              locale={props.locale}
              onChange={(values) => setTags(values)}
            />
          }
        >
          <ArticleResults />
        </BlogSidebarLayout>
      </Show>
    </div>
  );
}
