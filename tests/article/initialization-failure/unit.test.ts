import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountArticlePage } from '../../../apps/site/src/features/article/runtime/article-controller';
import { createArticleSidebarController } from '../../../apps/site/src/features/article/runtime/article-sidebar-controller';
import { createArticleTocController } from '../../../apps/site/src/features/article/runtime/article-toc-controller';
import { createArticleMediaController } from '../../../apps/site/src/features/article/runtime/article-media-controller';

vi.mock('../../../apps/site/src/features/article/runtime/article-sidebar-controller', () => ({
  createArticleSidebarController: vi.fn(),
}));
vi.mock('../../../apps/site/src/features/article/runtime/article-toc-controller', () => ({
  createArticleTocController: vi.fn(),
}));
vi.mock('../../../apps/site/src/features/article/runtime/article-media-controller', () => ({
  createArticleMediaController: vi.fn(),
}));

type Lightbox = {
  options: { gallery: HTMLElement };
  intercept: (event: Event) => void;
  pswp?: unknown;
};
const photoswipe = vi.hoisted(() => ({
  instances: [] as Lightbox[],
  init: vi.fn<(lightbox: Lightbox) => void>(),
  destroy: vi.fn<(lightbox: Lightbox) => void>(),
}));
vi.mock('photoswipe/lightbox', () => ({
  default: class {
    intercept = (event: Event) => event.preventDefault();
    constructor(public options: { gallery: HTMLElement }) {
      photoswipe.instances.push(this);
    }
    on() {}
    init() {
      photoswipe.init(this);
    }
    destroy() {
      this.options.gallery.removeEventListener('click', this.intercept);
      photoswipe.destroy(this);
    }
  },
}));
vi.mock('photoswipe', () => ({ default: class {} }));
vi.mock('photoswipe/style.css?url', () => ({ default: '/photoswipe-test.css' }));

const sidebarModule = await vi.importActual<
  typeof import('../../../apps/site/src/features/article/runtime/article-sidebar-controller')
>('../../../apps/site/src/features/article/runtime/article-sidebar-controller');
const tocModule = await vi.importActual<
  typeof import('../../../apps/site/src/features/article/runtime/article-toc-controller')
>('../../../apps/site/src/features/article/runtime/article-toc-controller');
const mediaModule = await vi.importActual<
  typeof import('../../../apps/site/src/features/article/runtime/article-media-controller')
>('../../../apps/site/src/features/article/runtime/article-media-controller');

beforeEach(() => {
  vi.mocked(createArticleSidebarController).mockReset();
  vi.mocked(createArticleTocController).mockReset();
  vi.mocked(createArticleMediaController).mockReset();
  photoswipe.instances.length = 0;
  photoswipe.init.mockReset();
  photoswipe.destroy.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  const dom = parseHTML(`<!doctype html><html><head></head><body>
    <article data-article-page>
      <div data-article-sidebar-layout>
        <aside data-article-sidebar-panel></aside>
        <button data-article-sidebar-toggle>Sidebar</button>
        <div data-article-sidebar-resizer></div>
      </div>
      <div class="article-prose"><p>Readable article</p>
        <a data-article-media-item href="/image.jpg" target="_blank">Image</a>
      </div>
    </article></body></html>`);
  const document = dom.document as unknown as Document;
  const media = Object.assign(new EventTarget(), { matches: true });
  const sourceWindow = Object.assign(new EventTarget(), {
    document,
    matchMedia: vi.fn(() => media),
    localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
    requestAnimationFrame: vi.fn(() => 42),
    cancelAnimationFrame: vi.fn(),
    clearTimeout: vi.fn(),
    reportError: vi.fn(),
  });
  Object.defineProperty(document, 'defaultView', { value: sourceWindow });
  const article = document.querySelector<HTMLElement>('article')!;
  const layout = article.querySelector<HTMLElement>('[data-article-sidebar-layout]')!;
  const gallery = article.querySelector<HTMLElement>('.article-prose')!;
  const signals: AbortSignal[] = [];
  const track = (target: EventTarget) => {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
      const signal = typeof options === 'object' ? options?.signal : undefined;
      if (signal) {
        signals.push(signal);
        // linkedom does not implement the browser's AbortSignal listener option.
        if (!(target instanceof EventTarget)) {
          signal.addEventListener('abort', () => remove(type, listener, options), { once: true });
        }
      }
      add(type, listener, options);
    });
  };
  for (const target of [document, sourceWindow, media, article, layout, ...layout.children]) {
    track(target);
  }
  return {
    article,
    document,
    layout,
    gallery,
    sourceWindow,
    window: sourceWindow as unknown as Window,
    signals,
    clickMedia: () =>
      gallery
        .querySelector('a')!
        .dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true })),
    loadStylesheet: () => {
      document
        .querySelector('link[data-article-media-stylesheet]')!
        .dispatchEvent(new dom.window.Event('load'));
    },
  };
}

it('rolls back returned children in reverse order and preserves initialization plus cleanup failures', () => {
  const f = fixture();
  const order: string[] = [];
  const original = new Error('Media factory failed');
  const cleanup = new Error('TOC cleanup failed');
  vi.mocked(createArticleSidebarController).mockReturnValue({
    destroy: () => {
      order.push('sidebar');
    },
  });
  vi.mocked(createArticleTocController).mockReturnValue({
    destroy: () => {
      order.push('toc');
      throw cleanup;
    },
  });
  vi.mocked(createArticleMediaController).mockImplementation(() => {
    throw original;
  });

  let failure: unknown;
  try {
    mountArticlePage(f.document, f.window);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toEqual([original, cleanup]);
  expect(order).toEqual(['toc', 'sidebar']);
  expect(f.article.hasAttribute('data-article-runtime-ready')).toBe(false);
  expect(f.gallery.querySelector('p')?.textContent).toBe('Readable article');
  expect(f.gallery.querySelector('a')?.getAttribute('href')).toBe('/image.jpg');
});

it('attempts every child cleanup once even if the first cleanup throws', () => {
  const f = fixture();
  const order: string[] = [];
  const failure = new Error('Media cleanup failed');
  vi.mocked(createArticleSidebarController).mockReturnValue({
    destroy: () => {
      order.push('sidebar');
    },
  });
  vi.mocked(createArticleTocController).mockReturnValue({
    destroy: () => {
      order.push('toc');
    },
  });
  vi.mocked(createArticleMediaController).mockReturnValue({
    destroy: () => {
      order.push('media');
      throw failure;
    },
  });
  const controller = mountArticlePage(f.document, f.window)!;
  expect(f.article.hasAttribute('data-article-runtime-ready')).toBe(true);
  expect(() => controller.destroy()).toThrow(failure);
  expect(() => controller.destroy()).not.toThrow();
  expect(order).toEqual(['media', 'toc', 'sidebar']);
  expect(f.article.hasAttribute('data-article-runtime-ready')).toBe(false);
});

it('a sidebar factory failure aborts its already registered listeners without writing preferences', () => {
  const f = fixture();
  const failure = new Error('Initial sidebar style failed');
  vi.spyOn(f.layout.style, 'setProperty').mockImplementationOnce(() => {
    throw failure;
  });
  expect(() => sidebarModule.createArticleSidebarController(f.layout, f.window)).toThrow(failure);
  expect(f.signals.length).toBeGreaterThan(0);
  expect(f.signals.every((signal) => signal.aborted)).toBe(true);
  expect(f.layout.hasAttribute('data-sidebar-controlled')).toBe(false);
  expect(f.sourceWindow.localStorage.setItem).not.toHaveBeenCalled();
});

it('a TOC factory failure aborts listeners before returning any controller', () => {
  const f = fixture();
  const failure = new Error('Initial heading lookup failed');
  vi.spyOn(f.document, 'querySelectorAll').mockImplementationOnce(() => {
    throw failure;
  });
  expect(() => tocModule.createArticleTocController(f.article, f.document, f.window)).toThrow(
    failure,
  );
  expect(f.signals.length).toBeGreaterThan(0);
  expect(f.signals.every((signal) => signal.aborted)).toBe(true);
  f.sourceWindow.dispatchEvent(new Event('resize'));
  expect(f.sourceWindow.requestAnimationFrame).not.toHaveBeenCalled();
});

it('TOC destruction cancels its scheduled frame once and stops further scheduling', () => {
  const f = fixture();
  const controller = tocModule.createArticleTocController(f.article, f.document, f.window);
  f.sourceWindow.dispatchEvent(new Event('resize'));
  expect(f.sourceWindow.requestAnimationFrame).toHaveBeenCalledOnce();
  controller.destroy();
  controller.destroy();
  f.sourceWindow.dispatchEvent(new Event('resize'));
  expect(f.sourceWindow.cancelAnimationFrame).toHaveBeenCalledExactlyOnceWith(42);
  expect(f.sourceWindow.requestAnimationFrame).toHaveBeenCalledOnce();
});

it('synchronous media setup failure removes the document listener and keeps the ordinary image link', () => {
  const f = fixture();
  const failure = new Error('Stylesheet insertion failed');
  const remove = vi.spyOn(f.document, 'removeEventListener');
  vi.spyOn(f.document.head, 'append').mockImplementationOnce(() => {
    throw failure;
  });
  expect(() => mediaModule.createArticleMediaController(f.article)).toThrow(failure);
  expect(remove).toHaveBeenCalledWith('astro:before-preparation', expect.any(Function));
  expect(f.gallery.dataset.articleMediaRuntime).toBeUndefined();
  expect(f.gallery.querySelector('a')?.getAttribute('target')).toBe('_blank');
  expect(photoswipe.init).not.toHaveBeenCalled();
});

it('a partial asynchronous lightbox init is destroyed before local fallback and reports the original error', async () => {
  const f = fixture();
  const failure = new Error('Lightbox init failed after binding clicks');
  photoswipe.init.mockImplementation((lightbox) => {
    lightbox.options.gallery.addEventListener('click', lightbox.intercept);
    throw failure;
  });
  const controller = mediaModule.createArticleMediaController(f.article);
  f.loadStylesheet();
  await vi.waitFor(() => expect(f.gallery.dataset.articleMediaRuntime).toBe('fallback'));
  expect(photoswipe.destroy).toHaveBeenCalledOnce();
  expect(f.sourceWindow.reportError).toHaveBeenCalledExactlyOnceWith(failure);
  // Failure rolls back only this enhancement, not the shared stylesheet or article.
  expect(f.document.querySelector('link[data-article-media-stylesheet]')).not.toBeNull();
  expect(f.gallery.querySelector('a')?.getAttribute('href')).toBe('/image.jpg');
  expect(f.clickMedia()).toBe(true);
  controller.destroy();
  expect(photoswipe.destroy).toHaveBeenCalledOnce();
});

it('destroying during viewer opening preserves its instance-bound delayed close', async () => {
  const f = fixture();
  const controller = mediaModule.createArticleMediaController(f.article);
  f.loadStylesheet();
  await vi.waitFor(() => expect(f.gallery.dataset.articleMediaRuntime).toBe('ready'));
  let finishOpening: (() => void) | undefined;
  const viewer = {
    options: { trapFocus: true, returnFocus: true },
    opener: { isOpening: true },
    close: vi.fn(),
    off: vi.fn(),
    on: vi.fn((_event: string, callback: () => void) => {
      finishOpening = callback;
    }),
  };
  photoswipe.instances[0]!.pswp = viewer;
  controller.destroy();
  expect(viewer.close).not.toHaveBeenCalled();
  expect(viewer.options).toEqual({ trapFocus: false, returnFocus: false });
  expect(finishOpening).toBeTypeOf('function');
  finishOpening!();
  expect(viewer.close).toHaveBeenCalledOnce();
  expect(viewer.off).toHaveBeenCalledWith('openingAnimationEnd', finishOpening);
  expect(f.gallery.dataset.articleMediaViewer).toBeUndefined();
});
