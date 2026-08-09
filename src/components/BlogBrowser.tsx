import { Collapsible } from '@kobalte/core/collapsible';
import { ToggleButton } from '@kobalte/core/toggle-button';
import { ToggleGroup } from '@kobalte/core/toggle-group';
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { Locale } from '../i18n/config';
import * as m from '../paraglide/messages.js';

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

export type BlogTag = {
  name: string;
  slug: string;
  count: number;
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
  const tagsByName = new Map(props.tags.map((tag) => [tag.name, tag]));
  const [selectedTags, setSelectedTags] = createSignal<string[]>([]);
  const [pageIndex, setPageIndex] = createSignal(0);

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

    setTags(validTags, false);
    setPage(initialPageIndex, false);
  };

  onMount(() => {
    restoreUrlState();
    window.addEventListener('popstate', restoreUrlState);
    onCleanup(() => window.removeEventListener('popstate', restoreUrlState));
  });

  return (
    <div
      class={
        filterable() && props.tags.length > 0
          ? 'grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start'
          : undefined
      }
    >
      <Show when={filterable() && props.tags.length > 0}>
        <aside class="lg:sticky lg:top-28 lg:max-h-[min(42rem,calc(100dvh-9rem))] lg:overflow-y-auto lg:overscroll-contain lg:pr-2">
          <Collapsible defaultOpen>
            <Collapsible.Trigger class="group flex w-full items-center justify-between gap-4 py-2 text-left text-sm font-bold text-slate-700 dark:text-slate-200">
              <span>{m.article_tags({}, { locale: props.locale })}</span>
              <span
                class="size-2.5 rotate-45 border-r-2 border-b-2 border-slate-400 transition-transform group-data-[expanded]:rotate-[225deg] dark:border-slate-500"
                aria-hidden="true"
              />
            </Collapsible.Trigger>

            <Collapsible.Content class="mt-2">
              <ToggleGroup
                multiple
                orientation="vertical"
                value={selectedTags()}
                onChange={(values) => setTags(values)}
                aria-label={m.article_tags({}, { locale: props.locale })}
                class="flex flex-col gap-1"
              >
                <For each={props.tags}>
                  {(tag) => (
                    <ToggleGroup.Item
                      value={tag.name}
                      data-tag-filter={tag.name}
                      data-tag-slug={tag.slug}
                      data-tag-count={tag.count}
                      class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border-l-2 border-transparent px-3 py-2 text-left text-sm text-slate-600 transition-colors hover:bg-cyan-500/7 hover:text-slate-950 data-[pressed]:border-cyan-500 data-[pressed]:bg-cyan-500/10 data-[pressed]:font-bold data-[pressed]:text-cyan-800 dark:text-slate-400 dark:hover:text-white dark:data-[pressed]:text-cyan-300"
                    >
                      <span class="min-w-0 truncate">{tag.name}</span>
                      <span class="font-mono text-[0.68rem] opacity-65">{tag.count}</span>
                    </ToggleGroup.Item>
                  )}
                </For>
              </ToggleGroup>
            </Collapsible.Content>
          </Collapsible>
        </aside>
      </Show>

      <div class="min-w-0 scroll-mt-28" data-blog-results>
        <p
          class="text-right font-mono text-xs text-slate-500 dark:text-slate-400"
          aria-live="polite"
        >
          {m.blog_article_count({ count: filteredCount() }, { locale: props.locale })}
        </p>

        <Show
          when={filteredCount() > 0}
          fallback={
            <p class="py-16 text-sm text-slate-500 dark:text-slate-400">
              {m.blog_empty({}, { locale: props.locale })}
            </p>
          }
        >
          <ol class="mt-2">
            <For each={visibleArticles()}>
              {(article) => {
                return (
                  <li
                    data-blog-article
                    data-article-tags={JSON.stringify(article.tags)}
                    data-reveal
                  >
                    <article class="group grid gap-4 border-b border-slate-900/10 py-7 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,18rem)_1.5rem] lg:items-start lg:gap-7 dark:border-white/10">
                      <div class="min-w-0" lang={article.contentLanguage}>
                        <h2 class="text-xl font-extrabold tracking-tight sm:text-2xl">
                          <a
                            href={article.href}
                            class="transition-colors group-hover:text-cyan-700 dark:group-hover:text-cyan-300"
                          >
                            {article.title}
                          </a>
                        </h2>
                        <Show when={article.description}>
                          {(description) => (
                            <p class="mt-2 max-w-4xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                              {description()}
                            </p>
                          )}
                        </Show>
                      </div>

                      <footer class="min-w-0">
                        <time
                          datetime={article.publishedDateTime}
                          class="mb-3 ml-2.5 block font-mono text-xs font-bold text-slate-600 dark:text-slate-300"
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
                                      class="block rounded-full bg-cyan-500/8 px-2.5 py-1 font-mono text-[0.62rem] text-cyan-700 transition-colors hover:bg-cyan-500/15 dark:text-cyan-300"
                                    >
                                      #{tag}
                                    </a>
                                  }
                                >
                                  <ToggleButton
                                    pressed={selectedTags().includes(tag)}
                                    onChange={(pressed) => setTagPressed(tag, pressed)}
                                    data-article-tag={tag}
                                    class="rounded-full bg-cyan-500/8 px-2.5 py-1 font-mono text-[0.62rem] text-cyan-700 transition-colors hover:bg-cyan-500/15 data-[pressed]:bg-cyan-600 data-[pressed]:text-white dark:text-cyan-300 dark:data-[pressed]:bg-cyan-300 dark:data-[pressed]:text-slate-950"
                                  >
                                    #{tag}
                                  </ToggleButton>
                                </Show>
                              </li>
                            )}
                          </For>
                        </ul>
                      </footer>

                      <a
                        href={article.href}
                        class="hidden text-slate-400 transition-[color,transform] group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-cyan-600 lg:block dark:group-hover:text-cyan-300"
                        aria-label={m.blog_read_article(
                          { title: article.title },
                          { locale: props.locale },
                        )}
                      >
                        <span aria-hidden="true">↗</span>
                      </a>
                    </article>
                  </li>
                );
              }}
            </For>
          </ol>
        </Show>

        <Show when={pageCount() > 1}>
          <nav
            class="mt-10 flex items-center justify-between gap-4 border-t border-slate-900/10 pt-6 dark:border-white/10"
            aria-label={m.pagination_label({}, { locale: props.locale })}
          >
            <button
              type="button"
              onClick={() => changePage(pageIndex() - 1)}
              disabled={pageIndex() === 0}
              class="inline-flex items-center gap-2 text-sm font-bold text-slate-600 transition-colors hover:text-cyan-700 disabled:pointer-events-none disabled:invisible dark:text-slate-300 dark:hover:text-cyan-300"
            >
              <span aria-hidden="true">←</span>
              {m.pagination_previous({}, { locale: props.locale })}
            </button>

            <span class="font-mono text-xs text-slate-500 dark:text-slate-400">
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
              class="inline-flex items-center gap-2 text-sm font-bold text-slate-600 transition-colors hover:text-cyan-700 disabled:pointer-events-none disabled:invisible dark:text-slate-300 dark:hover:text-cyan-300"
            >
              {m.pagination_next({}, { locale: props.locale })}
              <span aria-hidden="true">→</span>
            </button>
          </nav>
        </Show>
      </div>
    </div>
  );
}
