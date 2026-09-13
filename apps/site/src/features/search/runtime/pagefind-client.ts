export type PagefindSection = {
  url: string;
  title: string;
  excerpt: string;
  locations?: number[];
};
export type PagefindResult = {
  url: string;
  meta: Record<string, string | undefined>;
  excerpt: string;
  sub_results?: PagefindSection[];
};
export type PagefindResponse = { results: Array<{ data(): Promise<PagefindResult> }> };
type PagefindInstance = {
  init(): Promise<void>;
  filters(): Promise<unknown>;
  search(query: string): Promise<PagefindResponse>;
  destroy(): Promise<void>;
};
type PagefindModule = {
  createInstance(options: {
    basePath: string;
    metaCacheTag: string;
    excerptLength: number;
  }): PagefindInstance;
};

/** One page owns one index. Module caching is left to the browser. */
export function createPagefindClient(bundle: URL, cacheTag: string) {
  let disposed = false;
  let releaseInstance = () => {};
  const pendingQueries = new Set<Promise<PagefindResponse>>();
  const ready = (async (): Promise<Pick<PagefindInstance, 'search'> | undefined> => {
    const moduleUrl = new URL('pagefind.js', bundle).href;
    const pagefind: PagefindModule = await import(/* @vite-ignore */ moduleUrl);
    if (disposed) return;
    const instance = pagefind.createInstance({
      basePath: bundle.href,
      metaCacheTag: cacheTag,
      excerptLength: 36,
    });
    const initialized = instance.init();
    // Pagefind registers result callbacks when a query resolves. Destroy after
    // those queries settle so a late response cannot recreate released data in
    // a Worker shared with a new page. Navigation never waits for this cleanup.
    releaseInstance = () => {
      void initialized
        .catch(() => undefined)
        .then(() => Promise.allSettled(pendingQueries))
        .then(() => instance.destroy())
        .catch((error: unknown) => console.error('Failed to release the search index', error));
    };
    await initialized;
    if (disposed) return;
    // Match the previous index preload without producing an empty query result.
    await instance.filters();
    if (disposed) return;
    return {
      search(query) {
        if (disposed)
          return Promise.reject(new DOMException('Search page was destroyed', 'AbortError'));
        const task = instance.search(query);
        pendingQueries.add(task);
        void task.then(
          () => pendingQueries.delete(task),
          () => pendingQueries.delete(task),
        );
        return task;
      },
    };
  })();
  return {
    ready,
    destroy() {
      if (disposed) return;
      disposed = true;
      releaseInstance();
    },
  };
}

/** Keep the strongest section matches, in their original document order. */
export function getDisplaySubResults(result: PagefindResult, limit = 3): PagefindSection[] {
  const sections = result.sub_results ?? [];
  const candidates =
    sections[0]?.url === (result.meta.url || result.url) ? sections.slice(1) : sections;
  if (candidates.length <= limit) return candidates;
  const selected = new Set(
    [...candidates]
      .sort((a, b) => (b.locations?.length ?? 0) - (a.locations?.length ?? 0))
      .slice(0, limit),
  );
  return candidates.filter((section) => selected.has(section));
}
