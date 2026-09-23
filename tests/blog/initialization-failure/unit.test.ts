import { parseHTML } from 'linkedom';
import { expect, test, vi } from 'vitest';
import { mountBlogPage } from '../../../apps/site/src/features/blog/runtime/blog-controller';
import { createBlogSidebarController } from '../../../apps/site/src/features/blog/runtime/blog-sidebar-controller';
const render = vi.hoisted(() => vi.fn());

vi.mock('../../../apps/site/src/features/blog/runtime/blog-sidebar-controller', () => ({
  createBlogSidebarController: vi.fn(),
}));

const failure = new Error('Blog view initialization failed');
vi.mock('../../../apps/site/src/features/blog/runtime/blog-view', async () => {
  const { createBlogPageSizeView } =
    await import('../../../apps/site/src/features/blog/runtime/blog-page-size-view');
  return {
    createBlogView: (listing: HTMLElement) => ({
      catalog: { filterable: false, tags: [], articleTags: [] },
      pageSize: createBlogPageSizeView(listing),
      render,
    }),
  };
});

const sizeMarkup = `<button data-blog-page-size data-page-size-template="{count} per page" disabled value="5"><span data-blog-page-size-value>5 per page</span></button>
  <div data-blog-page-size-menu id="size-menu" hidden>
    <div data-blog-page-size-option data-value="5" id="size-5"><span data-blog-page-size-option-label>5</span></div>
  </div>`;

test('releases a returned sidebar when subsequent blog initialization fails', () => {
  render.mockImplementation(() => {
    throw failure;
  });
  const dom = parseHTML(`<!doctype html><html><body>
    <main data-blog-listing><div data-blog-sidebar-layout>
      <button data-blog-mobile-toggle aria-expanded="false"></button>
      <div data-blog-mobile-panel aria-hidden="true"></div>
      ${sizeMarkup}
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
      requestViewRefresh: vi.fn(),
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
  expect(listing.querySelector('[data-blog-page-size]')?.hasAttribute('disabled')).toBe(true);
  expect(listing.querySelector('[data-blog-page-size-menu]')).not.toBeNull();
});

test('the page owner restores mobile fallback on destroy and enables it for a later mount', () => {
  render.mockReset();
  const dom = parseHTML(`<!doctype html><html><body>
    <main data-blog-listing><div data-blog-sidebar-layout>
      <button data-blog-mobile-toggle disabled aria-disabled="true"></button>
      <div data-blog-mobile-panel aria-hidden="true"></div>
      ${sizeMarkup}
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
  const navigation = {
    replaceViewUrl: vi.fn(),
    requestViewRefresh: vi.fn(),
    requestViewUpdate: vi.fn(),
  };

  const first = mountBlogPage(document, sourceWindow as unknown as Window, navigation)!;
  expect(mobileDisclosure.disabled).toBe(false);
  expect(listing.querySelector('[data-blog-page-size]')?.hasAttribute('disabled')).toBe(false);
  first.destroy();
  expect(firstSidebarDestroy).toHaveBeenCalledOnce();
  expect(mobileDisclosure.disabled).toBe(true);
  expect(listing.querySelector('[data-blog-page-size]')?.hasAttribute('disabled')).toBe(true);
  expect(listing.querySelector('[data-blog-page-size-menu]')).not.toBeNull();
  expect(mobilePanel.inert).toBe(false);
  expect(mobilePanel.hasAttribute('aria-hidden')).toBe(false);

  mountBlogPage(document, sourceWindow as unknown as Window, navigation);
  expect(mobileDisclosure.disabled).toBe(false);
  expect(mobileDisclosure.hasAttribute('aria-disabled')).toBe(false);
});
