import { readCurrentScroll, restorePageScroll } from '../../../runtime/scroll-state';
import type { PageController, PageNavigation, PageView } from '../../../runtime/page-navigation';
import { prepareRequiredFonts } from '../../../runtime/required-fonts';
import { createSearchQueryUrl, normalizeSearchQuery, readSearchQuery } from './search-query-state';
import { createSearchResultsView, type SearchResultsView } from './search-results-view';

type PagefindSection = { url: string; title: string; excerpt: string };
type PagefindResult = {
  url: string;
  meta: Record<string, string | undefined>;
  excerpt: string;
  sub_results?: PagefindSection[];
};
type PagefindResponse = { results: Array<{ data(): Promise<PagefindResult> }> };

/** Only the public Component UI capabilities used by this page. */
type PagefindInstance = {
  getInputs(): HTMLElement[];
  registerResults(
    element: HTMLElement,
    capabilities: {
      keyboardNavigation: boolean;
      announcements: boolean;
    },
  ): void;
  on(event: 'search', callback: (query: string) => void, owner: Element): void;
  on(event: 'results', callback: (result: PagefindResponse) => void, owner: Element): void;
  on(event: 'error', callback: () => void, owner: Element): void;
  triggerSearch(query: string): void;
  translate(key: string, values?: Record<string, string | number>): string;
  announceRaw(message: string, priority: 'polite'): void;
  getDisplaySubResults(result: PagefindResult, limit: number): PagefindSection[];
};
type PagefindInstanceManager = {
  getInstance(name: string): PagefindInstance;
  removeInstance(name: string): void;
};
type SearchWindow = Window & {
  PagefindComponents?: { getInstanceManager(): PagefindInstanceManager };
};
type SearchJob = {
  query: string;
  controller: AbortController;
  response?: PagefindResponse;
  rendered: number;
  loading?: Promise<void>;
};

const COMPONENT_CONNECTION_TIMEOUT_MS = 5_000;
const SEARCH_RESPONSE_TIMEOUT_MS = 10_000;
const SEARCH_LOADING_HINT_DELAY_MS = 200;
const SEARCH_BATCH_SIZE = 10;

function createSearchPageController(
  root: HTMLElement,
  sourceDocument: Document,
  sourceWindow: Window,
  navigation: PageNavigation,
  initialScrollRestoration?: ReturnType<typeof readCurrentScroll>,
): PageController {
  const listeners = new AbortController();
  const instanceName = root.dataset.searchInstance ?? 'default';
  const loading = root.querySelector<HTMLElement>('[data-search-loading]');
  const interactive = root.querySelector<HTMLElement>('[data-search-interactive]');
  const fallback = root.querySelector<HTMLElement>('[data-search-fallback]');
  let instanceManager: PagefindInstanceManager | undefined;
  let view: SearchResultsView | undefined;
  let destroyed = false;
  let failed = false;
  let composing = false;
  let responseTimer = 0;
  let hintTimer = 0;
  // The input can supersede a search before Pagefind's debounce submits its successor.
  let currentJob: SearchJob | undefined;
  let submittedJob: SearchJob | undefined;
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
    clearTimers();
  };

  const removeInstance = () => {
    instanceManager?.removeInstance(instanceName);
    instanceManager = undefined;
  };

  const showFailure = () => {
    if (destroyed || failed) return;
    failed = true;
    invalidate();
    listeners.abort();
    view?.destroy();
    removeInstance();
    loading?.setAttribute('hidden', '');
    interactive?.setAttribute('hidden', '');
    fallback?.removeAttribute('hidden');
    root.removeAttribute('data-search-ready');
    root.setAttribute('data-search-failed', '');
  };

  const connectionTimer = sourceWindow.setTimeout(showFailure, COMPONENT_CONNECTION_TIMEOUT_MS);

  const reflectQuery = (query: string) => {
    const nextUrl = createSearchQueryUrl(new URL(sourceWindow.location.href), query);
    if (nextUrl.href === sourceWindow.location.href) return;
    navigation.replaceViewUrl(nextUrl);
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
    await Promise.all([
      sourceWindow.customElements.whenDefined('pagefind-config'),
      sourceWindow.customElements.whenDefined('pagefind-input'),
    ]);
    if (destroyed || failed) return;

    const components = (sourceWindow as SearchWindow).PagefindComponents;
    const pagefindInput = root.querySelector<HTMLElement>('pagefind-input');
    const input = pagefindInput?.querySelector<HTMLInputElement>('input');
    if (!components || !pagefindInput || !input) {
      showFailure();
      return;
    }

    instanceManager = components.getInstanceManager();
    const instance = instanceManager.getInstance(instanceName);
    if (!instance.getInputs().includes(pagefindInput)) {
      showFailure();
      return;
    }

    const resultsView = createSearchResultsView(root, input, {
      announce: (message) => instance.announceRaw(message, 'polite'),
      loadMore: () => loadBatch(currentJob),
    });
    view = resultsView;
    resultsView.element.setAttribute('aria-label', instance.translate('results_label'));
    instance.registerResults(resultsView.element, {
      keyboardNavigation: true,
      announcements: true,
    });

    const failJob = (job: SearchJob) => {
      if (!isCurrent(job)) return;
      job.controller.abort();
      clearTimers();
      // A failed refinement must not remove a previously usable search.
      if (resultsView.query) resultsView.fail(instance.translate('error_search'));
      else showFailure();
    };

    const startWait = (job: SearchJob, message: string) => {
      clearTimers();
      hintTimer = sourceWindow.setTimeout(() => {
        if (isCurrent(job)) resultsView.showLoading(message);
      }, SEARCH_LOADING_HINT_DELAY_MS);
      responseTimer = sourceWindow.setTimeout(() => failJob(job), SEARCH_RESPONSE_TIMEOUT_MS);
    };

    const selectQuery = (rawQuery: string, preserveScroll = false) => {
      if (destroyed || failed) return;
      const query = normalizeSearchQuery(rawQuery);
      reflectQuery(query);
      if (isCurrent(currentJob) && currentJob.query === query) return;
      invalidate();
      if (!preserveScroll) pendingScrollRestoration = undefined;
      if (!query) {
        resultsView.clear();
        restorePendingScroll();
        return;
      }
      currentJob = { query, controller: new AbortController(), rendered: 0 };
      resultsView.pending();
    };

    function loadBatch(job: SearchJob | undefined): Promise<void> {
      if (!isCurrent(job) || !job.response) return Promise.resolve();
      if (job.loading) return job.loading;
      if (job.rendered > 0 && job.rendered >= job.response.results.length) {
        return Promise.resolve();
      }

      const hits = job.response.results;
      const append = job.rendered > 0;
      // History needs complete geometry before restoring a deep scroll position.
      // Normal searches retain bounded, on-demand batches.
      const size = pendingScrollRestoration?.page.y
        ? hits.length
        : append
          ? SEARCH_BATCH_SIZE
          : Math.max(SEARCH_BATCH_SIZE, resultsView.count);
      const batch = hits.slice(job.rendered, job.rendered + size);
      if (append) startWait(job, instance.translate('loading'));

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
              sections: instance.getDisplaySubResults(data, 3),
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
          hits.length === 0 ? 'zero_results' : hits.length === 1 ? 'one_result' : 'many_results';
        const summary = instance.translate(key, { SEARCH_TERM: job.query, COUNT: hits.length });
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

    instance.on(
      'search',
      (rawQuery) => {
        if (composing || normalizeSearchQuery(rawQuery) !== normalizeSearchQuery(input.value))
          return;
        selectQuery(rawQuery, true);
        const job = currentJob;
        if (!isCurrent(job) || submittedJob === job) return;
        submittedJob = job;
        startWait(job, instance.translate('searching', { SEARCH_TERM: job.query }));
      },
      root,
    );

    instance.on(
      'results',
      (response) => {
        const job = submittedJob;
        if (!isCurrent(job) || job.response) return;
        job.response = response;
        void loadBatch(job);
      },
      root,
    );
    instance.on(
      'error',
      () => {
        if (isCurrent(currentJob)) failJob(currentJob);
        else if (!resultsView.query) showFailure();
      },
      root,
    );

    // Invalidate on input, before Pagefind's debounce can submit the next search.
    input.addEventListener(
      'input',
      () => {
        if (!composing) selectQuery(input.value);
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
        selectQuery(input.value);
        instance.triggerSearch(input.value);
      },
      { signal: listeners.signal },
    );

    applyViewUrl = (url) => {
      const query = readSearchQuery(url);
      input.value = query;
      selectQuery(query, true);
      instance.triggerSearch(query);
    };

    sourceWindow.clearTimeout(connectionTimer);
    applyViewUrl(new URL(sourceWindow.location.href));
    loading?.setAttribute('hidden', '');
    fallback?.setAttribute('hidden', '');
    interactive?.removeAttribute('hidden');
    root.setAttribute('data-search-ready', '');
  };

  void connect().catch(showFailure);

  return {
    view: pageView,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      sourceWindow.clearTimeout(connectionTimer);
      invalidate();
      listeners.abort();
      view?.destroy();
      removeInstance();
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
