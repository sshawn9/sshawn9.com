import { expect, test, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createSearchResultsView } from '../../../apps/site/src/features/search/runtime/search-results-view';

function createFixture() {
  const { document, window } = parseHTML(`<!doctype html><html><body>
    <main data-site-search>
      <input data-search-input>
      <p data-search-summary></p><p data-search-status></p><p data-search-empty></p>
      <section data-search-results><ol data-search-list></ol><ol data-search-placeholder></ol><p data-search-more></p></section>
      <template data-search-card-template><li><span data-result-type></span><span data-result-published></span><a class="site-search-result__link"></a><p class="site-search-result__excerpt"></p><ul class="site-search-result__sections"></ul></li></template>
      <template data-search-section-template><li><a class="site-search-result__section-link"></a><p class="site-search-result__section-excerpt"></p></li></template>
    </main>
  </body></html>`);
  return { document, window, root: document.querySelector<HTMLElement>('[data-site-search]')! };
}

test('releases an observer created before observation fails', () => {
  const { window, root } = createFixture();
  let disconnected = 0;
  const signals: AbortSignal[] = [];
  const list = root.querySelector<HTMLOListElement>('[data-search-list]')!;
  const add = list.addEventListener.bind(list);
  vi.spyOn(list, 'addEventListener').mockImplementation((type, listener, options) => {
    const signal = typeof options === 'object' ? options?.signal : undefined;
    if (signal) signals.push(signal);
    add(type, listener, options);
  });
  class FailingObserver {
    constructor(_callback: IntersectionObserverCallback, _options: IntersectionObserverInit) {}
    observe() {
      throw new Error('observation failed');
    }
    disconnect() {
      disconnected += 1;
    }
  }
  Object.defineProperty(window, 'IntersectionObserver', {
    configurable: true,
    value: FailingObserver,
  });

  expect(() =>
    createSearchResultsView(root, root.querySelector<HTMLInputElement>('[data-search-input]')!, {
      announce: () => undefined,
      loadMore: async () => undefined,
    }),
  ).toThrow('observation failed');
  expect(disconnected).toBe(1);
  expect(signals).toHaveLength(1);
  expect(signals[0]?.aborted).toBe(true);

  Object.defineProperty(window, 'IntersectionObserver', { configurable: true, value: undefined });
  const view = createSearchResultsView(
    root,
    root.querySelector<HTMLInputElement>('[data-search-input]')!,
    {
      announce: () => undefined,
      loadMore: async () => undefined,
    },
  );
  view.destroy();
});
