import { readCurrentScroll, restorePageScroll } from '../../../runtime/scroll-state';
import { runCleanups } from '../../../runtime/cleanup';
import type { PageController, PageNavigation, PageView } from '../../../runtime/page-navigation';
import { prepareRequiredFonts } from '../../../runtime/required-fonts';
import { createSearchQueryUrl, normalizeSearchQuery, readSearchQuery } from './search-query-state';
import { createSearchResultsView, type SearchResultsView } from './search-results-view';
import {
  createPagefindClient,
  getDisplaySubResults,
  type PagefindResponse,
} from './pagefind-client';

type SearchJob = {
  query: string;
  controller: AbortController;
  response?: PagefindResponse;
  rendered: number;
  loading?: Promise<void>;
};

const SEARCH_RESPONSE_TIMEOUT_MS = 10_000;
const SEARCH_LOADING_HINT_DELAY_MS = 200;
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_BATCH_SIZE = 10;

function createSearchPageController(
  root: HTMLElement,
  sourceDocument: Document,
  sourceWindow: Window,
  navigation: PageNavigation,
  initialScrollRestoration?: ReturnType<typeof readCurrentScroll>,
): PageController {
  const listeners = new AbortController();
  const loading = root.querySelector<HTMLElement>('[data-search-loading]');
  const interactive = root.querySelector<HTMLElement>('[data-search-interactive]');
  const fallback = root.querySelector<HTMLElement>('[data-search-fallback]');
  let client: ReturnType<typeof createPagefindClient> | undefined;
  let view: SearchResultsView | undefined;
  let destroyed = false;
  let failed = false;
  let composing = false;
  let responseTimer = 0;
  let hintTimer = 0;
  let debounceTimer = 0;
  let currentJob: SearchJob | undefined;
  let pendingScrollRestoration = initialScrollRestoration ?? readCurrentScroll(sourceWindow);
  let applyViewUrl: ((url: URL) => void) | undefined;
  const pageView: PageView = {
    resourceUrl: new URL(sourceWindow.location.href),
    queryParameters: ['q'],
    normalize: (url) => createSearchQueryUrl(url, readSearchQuery(url)),
    apply(url, context) {
      pendingScrollRestoration = context.scroll;
      applyViewUrl?.(url);
    },
  };

  const isCurrent = (job: SearchJob | undefined): job is SearchJob =>
    Boolean(job && job === currentJob && !job.controller.signal.aborted && !destroyed && !failed);

  const clearTimers = () => {
    sourceWindow.clearTimeout(responseTimer);
    sourceWindow.clearTimeout(hintTimer);
    responseTimer = hintTimer = 0;
  };

  const invalidate = () => {
    currentJob?.controller.abort();
    currentJob = undefined;
    sourceWindow.clearTimeout(debounceTimer);
    clearTimers();
  };

  const cleanup = () => {
    const resultsView = view;
    const pagefindClient = client;
    view = undefined;
    client = undefined;
    applyViewUrl = undefined;
    runCleanups(
      () => sourceWindow.clearTimeout(startupTimer),
      invalidate,
      () => listeners.abort(),
      () => resultsView?.destroy(),
      () => pagefindClient?.destroy(),
    );
  };

  const restoreStaticFallback = () => {
    loading?.setAttribute('hidden', '');
    interactive?.setAttribute('hidden', '');
    fallback?.removeAttribute('hidden');
    root.removeAttribute('data-search-ready');
    root.removeAttribute('data-search-failed');
  };

  const showFailure = (error: unknown = new Error('Search initialization failed')) => {
    if (destroyed || failed) return;
    failed = true;
    try {
      runCleanups(cleanup, () => {
        restoreStaticFallback();
        root.setAttribute('data-search-failed', '');
      });
    } catch (cleanupError) {
      sourceWindow.reportError(
        new AggregateError([error, cleanupError], 'Search initialization failed during cleanup'),
      );
      return;
    }
    sourceWindow.reportError(error);
  };
  const startupTimer = sourceWindow.setTimeout(
    () => showFailure(new Error('Search initialization timed out')),
    SEARCH_RESPONSE_TIMEOUT_MS,
  );

  const reflectQuery = (query: string) => {
    const nextUrl = createSearchQueryUrl(new URL(sourceWindow.location.href), query);
    if (nextUrl.href !== sourceWindow.location.href) navigation.replaceViewUrl(nextUrl);
  };

  const restorePendingScroll = () => {
    const scroll = pendingScrollRestoration;
    pendingScrollRestoration = undefined;
    if (!scroll) return;
    const job = currentJob;
    sourceWindow.requestAnimationFrame(() => {
      if (destroyed || failed || currentJob !== job || job?.controller.signal.aborted) return;
      restorePageScroll(sourceDocument, sourceWindow, scroll.page);
    });
  };

  const connect = async () => {
    const input = root.querySelector<HTMLInputElement>('[data-search-input]');
    const clear = root.querySelector<HTMLButtonElement>('[data-search-clear]');
    const announcement = root.querySelector<HTMLElement>('[data-search-announcement]');
    if (
      !input ||
      !clear ||
      !announcement ||
      !root.dataset.searchBundle ||
      !root.dataset.searchGeneration
    ) {
      showFailure();
      return;
    }
    const message = (name: string, values: Record<string, string | number> = {}) => {
      const template = root.getAttribute('data-search-' + name) ?? '';
      return template.replace(/{(query|count)}/g, (match, key: string) =>
        String(values[key] ?? match),
      );
    };
    const resultsView = createSearchResultsView(root, input, {
      announce: (text) => {
        announcement.textContent = text;
      },
      loadMore: () => loadBatch(currentJob),
    });
    view = resultsView;
    client = createPagefindClient(
      new URL(root.dataset.searchBundle, sourceWindow.location.href),
      root.dataset.searchGeneration,
    );
    const engine = client;

    const failJob = (job: SearchJob) => {
      if (!isCurrent(job)) return;
      job.controller.abort();
      clearTimers();
      if (resultsView.query) resultsView.fail(message('error-message'));
      else showFailure();
    };
    const startWait = (job: SearchJob, text: string) => {
      clearTimers();
      hintTimer = sourceWindow.setTimeout(() => {
        if (isCurrent(job)) resultsView.showLoading(text);
      }, SEARCH_LOADING_HINT_DELAY_MS);
      responseTimer = sourceWindow.setTimeout(() => failJob(job), SEARCH_RESPONSE_TIMEOUT_MS);
    };

    const search = async (job: SearchJob) => {
      if (!isCurrent(job)) return;
      startWait(job, message('searching-template', { query: job.query }));
      try {
        const instance = await engine.ready;
        if (!isCurrent(job) || !instance) return;
        const response = await instance.search(job.query);
        if (!isCurrent(job)) return;
        job.response = response;
        await loadBatch(job);
      } catch {
        failJob(job);
      }
    };

    const selectQuery = (rawQuery: string, immediate = false, preserveScroll = false) => {
      if (destroyed || failed) return;
      const query = normalizeSearchQuery(rawQuery);
      clear.hidden = input.value.length === 0;
      if (isCurrent(currentJob) && currentJob.query === query) return;
      invalidate();
      if (!preserveScroll) pendingScrollRestoration = undefined;
      if (!query) {
        announcement.textContent = '';
        resultsView.clear();
        restorePendingScroll();
        return;
      }
      const job: SearchJob = { query, controller: new AbortController(), rendered: 0 };
      currentJob = job;
      resultsView.pending();
      if (immediate) void search(job);
      else debounceTimer = sourceWindow.setTimeout(() => void search(job), SEARCH_DEBOUNCE_MS);
    };

    function loadBatch(job: SearchJob | undefined): Promise<void> {
      if (!isCurrent(job) || !job.response) return Promise.resolve();
      if (job.loading) return job.loading;
      if (job.rendered > 0 && job.rendered >= job.response.results.length) return Promise.resolve();
      const hits = job.response.results;
      const append = job.rendered > 0;
      // Restore deep history positions only after the required result geometry exists.
      const size = pendingScrollRestoration?.page.y
        ? hits.length
        : append
          ? SEARCH_BATCH_SIZE
          : Math.max(SEARCH_BATCH_SIZE, resultsView.count);
      const batch = hits.slice(job.rendered, job.rendered + size);
      if (append) startWait(job, message('loading-message'));
      job.loading = (async () => {
        const items = await Promise.all(
          batch.map(async (hit) => {
            const data = await hit.data();
            return {
              url: data.meta.url || data.url,
              title: data.meta.title ?? '',
              type: data.meta.type ?? '',
              published: data.meta.published ?? '',
              excerpt: data.excerpt,
              sections: getDisplaySubResults(data),
            };
          }),
        );
        if (!isCurrent(job)) return;
        const prepared = resultsView.prepare(items);
        await prepareRequiredFonts(sourceDocument, sourceDocument, {
          contentRoot: prepared,
          signal: job.controller.signal,
        });
        if (!isCurrent(job)) return;
        const key =
          hits.length === 0 ? 'zero-results' : hits.length === 1 ? 'one-result' : 'many-results';
        const summary = message(key + '-template', { query: job.query, count: hits.length });
        clearTimers();
        resultsView.commit(job.query, hits.length, prepared, summary, append);
        job.rendered += batch.length;
        restorePendingScroll();
      })()
        .catch(() => failJob(job))
        .finally(() => {
          job.loading = undefined;
        });
      return job.loading;
    }

    const submitInput = (immediate = false) => {
      reflectQuery(input.value);
      selectQuery(input.value, immediate);
    };
    const clearQuery = () => {
      input.value = '';
      submitInput(true);
      input.focus();
    };
    clear.addEventListener('click', clearQuery, { signal: listeners.signal });
    input.addEventListener(
      'input',
      () => {
        clear.hidden = input.value.length === 0;
        if (!composing) submitInput();
      },
      { signal: listeners.signal },
    );
    input.addEventListener(
      'keydown',
      (event) => {
        if (
          event.isComposing ||
          composing ||
          event.defaultPrevented ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        if (event.key === 'Escape') {
          event.preventDefault();
          clearQuery();
        } else if (event.key === 'ArrowDown') {
          const first = Array.from(
            resultsView.element.querySelectorAll<HTMLAnchorElement>('a[href]'),
          ).find((link) => link.getClientRects().length > 0);
          if (first) {
            event.preventDefault();
            first.focus();
          }
        }
      },
      { signal: listeners.signal },
    );
    input.addEventListener(
      'compositionstart',
      () => {
        composing = true;
        invalidate();
        resultsView.pending();
      },
      { signal: listeners.signal },
    );
    input.addEventListener(
      'compositionend',
      () => {
        composing = false;
        submitInput(true);
      },
      { signal: listeners.signal },
    );

    applyViewUrl = (url) => {
      // Applying an existing URL does not write history. PageRuntime owns
      // initial canonicalization, after this controller has been registered.
      input.value = readSearchQuery(url);
      selectQuery(input.value, true, true);
    };
    applyViewUrl(new URL(sourceWindow.location.href));
    loading?.setAttribute('hidden', '');
    fallback?.setAttribute('hidden', '');
    interactive?.removeAttribute('hidden');
    root.setAttribute('data-search-ready', '');
    // Inputs and navigation are usable while the index prepares asynchronously.
    await engine.ready;
    sourceWindow.clearTimeout(startupTimer);
  };
  void connect().catch(showFailure);

  return {
    view: pageView,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      runCleanups(cleanup, restoreStaticFallback);
    },
  };
}

export function mountSearchPage(
  sourceDocument: Document,
  sourceWindow: Window,
  navigation: PageNavigation,
  initialScrollRestoration?: ReturnType<typeof readCurrentScroll>,
): PageController | undefined {
  const root = sourceDocument.querySelector<HTMLElement>('[data-site-search]');
  return root
    ? createSearchPageController(
        root,
        sourceDocument,
        sourceWindow,
        navigation,
        initialScrollRestoration,
      )
    : undefined;
}
