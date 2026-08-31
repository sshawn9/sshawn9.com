import {
  persistCurrentScroll,
  readCurrentScroll,
  restorePageScroll,
} from '../../../runtime/scroll-state';
import { createSearchQueryUrl, readSearchQuery } from './search-query-state';

type PagefindComponent = HTMLElement;

type PagefindInstance = {
  getInputs(): PagefindComponent[];
  getResults(): PagefindComponent[];
  on(
    event: 'search' | 'loading' | 'results' | 'error',
    callback: (...args: unknown[]) => void,
    owner?: Element | null,
  ): void;
  triggerSearch(query: string): void;
};

type PagefindInstanceManager = {
  getInstance(name: string): PagefindInstance;
  removeInstance(name: string): void;
};

type PagefindComponentsApi = {
  getInstanceManager(): PagefindInstanceManager;
};

type SearchWindow = Window & {
  PagefindComponents?: PagefindComponentsApi;
};

type SearchPageController = {
  destroy(): void;
};

const COMPONENT_CONNECTION_TIMEOUT_MS = 5_000;
const SEARCH_RESPONSE_TIMEOUT_MS = 10_000;

function createSearchPageController(
  root: HTMLElement,
  sourceDocument: Document,
  sourceWindow: Window,
  initialScrollRestoration?: ReturnType<typeof readCurrentScroll>,
): SearchPageController {
  const listeners = new AbortController();
  const searchWindow = sourceWindow as SearchWindow;
  const instanceName = root.dataset.searchInstance ?? 'default';
  const searchPath = root.dataset.searchPath;
  const loading = root.querySelector<HTMLElement>('[data-search-loading]');
  const interactive = root.querySelector<HTMLElement>('[data-search-interactive]');
  const fallback = root.querySelector<HTMLElement>('[data-search-fallback]');
  const noScriptFallback = root.querySelector<HTMLElement>('[data-search-no-script-fallback]');
  const emptyState = root.querySelector<HTMLElement>('[data-search-empty]');
  let instanceManager: PagefindInstanceManager | undefined;
  let destroyed = false;
  let failed = false;
  let responseTimer = 0;
  let resultObserver: MutationObserver | undefined;
  let pendingScrollRestoration = initialScrollRestoration ?? readCurrentScroll(sourceWindow);

  const clearResultWait = () => {
    sourceWindow.clearTimeout(responseTimer);
    responseTimer = 0;
    resultObserver?.disconnect();
    resultObserver = undefined;
  };

  const restorePendingScroll = () => {
    const snapshot = pendingScrollRestoration;
    pendingScrollRestoration = undefined;
    if (!snapshot || (snapshot.page.x === 0 && snapshot.page.y === 0)) return;

    sourceWindow.requestAnimationFrame(() => {
      if (!destroyed && !failed) {
        restorePageScroll(sourceDocument, sourceWindow, snapshot.page);
      }
    });
  };

  const removeInstance = () => {
    instanceManager?.removeInstance(instanceName);
    instanceManager = undefined;
  };

  const showFailure = () => {
    if (destroyed || failed) return;
    failed = true;
    clearResultWait();
    listeners.abort();
    removeInstance();
    loading?.setAttribute('hidden', '');
    interactive?.setAttribute('hidden', '');
    noScriptFallback?.setAttribute('hidden', '');
    fallback?.removeAttribute('hidden');
    root.removeAttribute('data-search-ready');
    root.setAttribute('data-search-failed', '');
  };

  const connectionTimer = sourceWindow.setTimeout(showFailure, COMPONENT_CONNECTION_TIMEOUT_MS);

  const reflectQuery = (query: string, updateUrl: boolean) => {
    const nextUrl = createSearchQueryUrl(new URL(sourceWindow.location.href), query);
    emptyState?.toggleAttribute('hidden', readSearchQuery(nextUrl).length > 0);
    if (!updateUrl || nextUrl.href === sourceWindow.location.href) return;

    persistCurrentScroll(sourceDocument, sourceWindow);
    sourceWindow.history.replaceState(sourceWindow.history.state, '', nextUrl);
    persistCurrentScroll(sourceDocument, sourceWindow);
  };

  const connect = async () => {
    await Promise.all([
      sourceWindow.customElements.whenDefined('pagefind-config'),
      sourceWindow.customElements.whenDefined('pagefind-input'),
      sourceWindow.customElements.whenDefined('pagefind-summary'),
      sourceWindow.customElements.whenDefined('pagefind-results'),
    ]);
    if (destroyed || failed) return;

    sourceWindow.clearTimeout(connectionTimer);
    const components = searchWindow.PagefindComponents;
    const pagefindInput = root.querySelector<HTMLElement>('pagefind-input');
    const pagefindResults = root.querySelector<HTMLElement>('pagefind-results');
    const input = pagefindInput?.querySelector<HTMLInputElement>('input');
    if (!components || !pagefindInput || !pagefindResults || !input) {
      showFailure();
      return;
    }

    instanceManager = components.getInstanceManager();
    const instance = instanceManager.getInstance(instanceName);
    if (
      !instance.getInputs().includes(pagefindInput) ||
      !instance.getResults().includes(pagefindResults)
    ) {
      showFailure();
      return;
    }

    instance.on(
      'search',
      (query) => reflectQuery(typeof query === 'string' ? query : '', true),
      root,
    );
    instance.on(
      'loading',
      () => {
        clearResultWait();
        responseTimer = sourceWindow.setTimeout(showFailure, SEARCH_RESPONSE_TIMEOUT_MS);
      },
      root,
    );
    instance.on(
      'results',
      (result) => {
        clearResultWait();
        const count =
          typeof result === 'object' &&
          result !== null &&
          'results' in result &&
          Array.isArray(result.results)
            ? result.results.length
            : 0;
        if (count === 0) {
          restorePendingScroll();
          return;
        }

        // Result fragments are loaded lazily after the public search result
        // event. Wait for our public result template before restoring scroll;
        // otherwise the short placeholder document clamps a deep history
        // position. Pagefind 1.5.2 does not expose fragment errors, so this same
        // finite wait also releases a failed fragment load to static navigation.
        const finishFragments = () => {
          if (!pagefindResults.querySelector('.site-search-result__link')) return;
          clearResultWait();
          restorePendingScroll();
        };
        const BrowserMutationObserver = (sourceWindow as Window & typeof globalThis)
          .MutationObserver;
        const observer = new BrowserMutationObserver(finishFragments);
        resultObserver = observer;
        observer.observe(pagefindResults, { childList: true, subtree: true });
        responseTimer = sourceWindow.setTimeout(showFailure, SEARCH_RESPONSE_TIMEOUT_MS);
        finishFragments();
      },
      root,
    );
    instance.on('error', showFailure, root);

    input.addEventListener('input', () => reflectQuery(input.value, true), {
      signal: listeners.signal,
    });

    const restoreFromUrl = () => {
      if (searchPath && sourceWindow.location.pathname !== searchPath) return;
      const query = readSearchQuery(new URL(sourceWindow.location.href));
      input.value = query;
      reflectQuery(query, false);
      instance.triggerSearch(query);
    };
    sourceWindow.addEventListener('popstate', restoreFromUrl, { signal: listeners.signal });

    restoreFromUrl();
    loading?.setAttribute('hidden', '');
    fallback?.setAttribute('hidden', '');
    noScriptFallback?.setAttribute('hidden', '');
    interactive?.removeAttribute('hidden');
    root.setAttribute('data-search-ready', '');
  };

  void connect().catch(showFailure);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      sourceWindow.clearTimeout(connectionTimer);
      clearResultWait();
      listeners.abort();
      removeInstance();
    },
  };
}

export function mountSearchPage(
  sourceDocument: Document = document,
  sourceWindow: Window = window,
  initialScrollRestoration?: ReturnType<typeof readCurrentScroll>,
): SearchPageController | undefined {
  const root = sourceDocument.querySelector<HTMLElement>('[data-site-search]');
  return root
    ? createSearchPageController(root, sourceDocument, sourceWindow, initialScrollRestoration)
    : undefined;
}
