import { parseHTML } from 'linkedom';
import { expect, test, vi } from 'vitest';
import { mountSearchPage } from '../../../apps/site/src/features/search/runtime/search-controller';
import { createPagefindClient } from '../../../apps/site/src/features/search/runtime/pagefind-client';
import { createSearchResultsView } from '../../../apps/site/src/features/search/runtime/search-results-view';

vi.mock('../../../apps/site/src/features/search/runtime/pagefind-client', () => ({
  createPagefindClient: vi.fn(),
  getDisplaySubResults: vi.fn(),
}));
vi.mock('../../../apps/site/src/features/search/runtime/search-results-view', () => ({
  createSearchResultsView: vi.fn(),
}));

test('ordinary destruction restores fallback after search became ready', async () => {
  const dom = parseHTML(`<!doctype html><html><body>
    <main data-site-search data-search-bundle="/pagefind/" data-search-generation="test">
      <p data-search-loading></p><section data-search-interactive hidden></section>
      <aside data-search-fallback></aside><input data-search-input><button data-search-clear></button>
      <p data-search-announcement></p><section data-search-results></section>
    </main>
  </body></html>`);
  const document = dom.document as unknown as Document;
  const sourceWindow = Object.assign(new EventTarget(), {
    document,
    location: new URL('https://example.test/en/search/'),
    history: { state: null },
    clearTimeout: vi.fn(),
    setTimeout,
    requestAnimationFrame: vi.fn(),
    reportError: vi.fn(),
  });
  Object.defineProperty(document, 'defaultView', { value: sourceWindow });
  const root = document.querySelector<HTMLElement>('[data-site-search]')!;
  const clientDestroy = vi.fn();
  const viewDestroy = vi.fn();
  vi.mocked(createSearchResultsView).mockReturnValue({
    element: root.querySelector<HTMLElement>('[data-search-results]')!,
    get query() {
      return undefined;
    },
    get count() {
      return 0;
    },
    prepare: vi.fn(),
    commit: vi.fn(),
    pending: vi.fn(),
    showLoading: vi.fn(),
    fail: vi.fn(),
    clear: vi.fn(),
    destroy: viewDestroy,
  });
  vi.mocked(createPagefindClient).mockReturnValue({
    ready: Promise.resolve(undefined),
    destroy: clientDestroy,
  });

  const controller = mountSearchPage(document, sourceWindow as unknown as Window, {
    replaceViewUrl: vi.fn(),
    requestViewRefresh: vi.fn(),
    requestViewUpdate: vi.fn(),
  })!;
  await vi.waitFor(() => expect(root.hasAttribute('data-search-ready')).toBe(true));
  controller.destroy();

  expect(viewDestroy).toHaveBeenCalledOnce();
  expect(clientDestroy).toHaveBeenCalledOnce();
  expect(root.hasAttribute('data-search-ready')).toBe(false);
  expect(root.querySelector('[data-search-interactive]')?.hasAttribute('hidden')).toBe(true);
  expect(root.querySelector('[data-search-fallback]')?.hasAttribute('hidden')).toBe(false);
});
