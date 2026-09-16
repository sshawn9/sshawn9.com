import { parseHTML } from 'linkedom';
import { expect, test, vi } from 'vitest';
import { mountBlogPage } from '../../../apps/site/src/features/blog/runtime/blog-controller';
import { createBlogSidebarController } from '../../../apps/site/src/features/blog/runtime/blog-sidebar-controller';
import { applyBlogViewState } from '../../../apps/site/src/features/blog/runtime/blog-view-state';

vi.mock('../../../apps/site/src/features/blog/runtime/blog-sidebar-controller', () => ({
  createBlogSidebarController: vi.fn(),
}));

const failure = new Error('Blog view initialization failed');
vi.mock('../../../apps/site/src/features/blog/runtime/blog-view-state', () => ({
  applyBlogViewState: vi.fn(),
  createBlogViewUrl: (url: URL) => url,
  deriveBlogViewState: () => ({ normalizedUrl: new URL('https://example.test/') }),
}));

test('releases a returned sidebar when subsequent blog initialization fails', () => {
  vi.mocked(applyBlogViewState).mockImplementation(() => {
    throw failure;
  });
  const dom = parseHTML(`<!doctype html><html><body>
    <main data-blog-listing><div data-blog-sidebar-layout>
      <button data-blog-mobile-toggle aria-expanded="false"></button>
      <div data-blog-mobile-panel aria-hidden="true"></div>
    </div></main>
  </body></html>`);
  const document = dom.document as unknown as Document;
  const media = Object.assign(new EventTarget(), { matches: false });
  const sourceWindow = Object.assign(new EventTarget(), {
    location: new URL('https://example.test/en/blog/'),
    matchMedia: vi.fn(() => media),
  });
  const listing = document.querySelector<HTMLElement>('[data-blog-listing]')!;
  const mobileDisclosure = listing.querySelector<HTMLButtonElement>('[data-blog-mobile-toggle]')!;
  const mobilePanel = listing.querySelector<HTMLElement>('[data-blog-mobile-panel]')!;
  const signals: AbortSignal[] = [];
  const add = listing.addEventListener.bind(listing);
  vi.spyOn(listing, 'addEventListener').mockImplementation((type, listener, options) => {
    const signal = typeof options === 'object' ? options?.signal : undefined;
    if (signal) signals.push(signal);
    add(type, listener, options);
  });
  const destroy = vi.fn();
  vi.mocked(createBlogSidebarController).mockReturnValue({ destroy });

  expect(() =>
    mountBlogPage(document, sourceWindow as unknown as Window, {
      replaceViewUrl: vi.fn(),
      requestViewUpdate: vi.fn(),
    }),
  ).toThrow(failure);
  expect(destroy).toHaveBeenCalledOnce();
  expect(signals).toHaveLength(1);
  expect(signals[0]?.aborted).toBe(true);
  expect(listing.hasAttribute('data-blog-runtime-ready')).toBe(false);
  expect(mobileDisclosure.disabled).toBe(true);
  expect(mobileDisclosure.getAttribute('aria-expanded')).toBe('true');
  expect(mobilePanel.inert).toBe(false);
  expect(mobilePanel.hasAttribute('aria-hidden')).toBe(false);
});

test('the page owner restores mobile fallback on destroy and enables it for a later mount', () => {
  vi.mocked(applyBlogViewState).mockReset();
  const dom = parseHTML(`<!doctype html><html><body>
    <main data-blog-listing><div data-blog-sidebar-layout>
      <button data-blog-mobile-toggle disabled aria-disabled="true"></button>
      <div data-blog-mobile-panel aria-hidden="true"></div>
    </div></main>
  </body></html>`);
  const document = dom.document as unknown as Document;
  const media = Object.assign(new EventTarget(), { matches: false });
  const sourceWindow = Object.assign(new EventTarget(), {
    location: new URL('https://example.test/en/blog/'),
    matchMedia: vi.fn(() => media),
  });
  const listing = document.querySelector<HTMLElement>('[data-blog-listing]')!;
  const mobileDisclosure = listing.querySelector<HTMLButtonElement>('[data-blog-mobile-toggle]')!;
  const mobilePanel = listing.querySelector<HTMLElement>('[data-blog-mobile-panel]')!;
  const firstSidebarDestroy = vi.fn();
  vi.mocked(createBlogSidebarController)
    .mockReset()
    .mockReturnValueOnce({ destroy: firstSidebarDestroy })
    .mockReturnValueOnce({ destroy: vi.fn() });
  const navigation = { replaceViewUrl: vi.fn(), requestViewUpdate: vi.fn() };

  const first = mountBlogPage(document, sourceWindow as unknown as Window, navigation)!;
  expect(mobileDisclosure.disabled).toBe(false);
  first.destroy();
  expect(firstSidebarDestroy).toHaveBeenCalledOnce();
  expect(mobileDisclosure.disabled).toBe(true);
  expect(mobilePanel.inert).toBe(false);
  expect(mobilePanel.hasAttribute('aria-hidden')).toBe(false);

  mountBlogPage(document, sourceWindow as unknown as Window, navigation);
  expect(mobileDisclosure.disabled).toBe(false);
  expect(mobileDisclosure.hasAttribute('aria-disabled')).toBe(false);
});
