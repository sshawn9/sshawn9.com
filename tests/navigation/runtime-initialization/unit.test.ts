import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { createPageRuntime } from '../../../apps/site/src/runtime/page-runtime';
import { installSiteRuntime } from '../../../apps/site/src/runtime/site-runtime';
import { rethrowAfterCleanup, runCleanups } from '../../../apps/site/src/runtime/cleanup';
import type {
  PageController,
  PageNavigation,
} from '../../../apps/site/src/runtime/page-navigation';

const hooks = vi.hoisted(() => ({
  blog: vi.fn(),
  article: vi.fn(),
  search: vi.fn(),
  navigation: vi.fn(),
  overlays: vi.fn(),
  content: vi.fn(),
}));
vi.mock('../../../apps/site/src/features/blog/runtime/blog-controller', () => ({
  mountBlogPage: hooks.blog,
}));
vi.mock('../../../apps/site/src/features/article/runtime/article-controller', () => ({
  mountArticlePage: hooks.article,
}));
vi.mock('../../../apps/site/src/features/search/runtime/search-controller', () => ({
  mountSearchPage: hooks.search,
}));
vi.mock('../../../apps/site/src/runtime/navigation-coordinator', () => ({
  installNavigationCoordinator: hooks.navigation,
}));
vi.mock('../../../apps/site/src/runtime/transient-overlay-controller', () => ({
  installTransientOverlayController: hooks.overlays,
}));
vi.mock('@sshawn9/content-ui/runtime', () => ({ installContentUiRuntime: hooks.content }));

function fixture() {
  const { document, window } = parseHTML('<html><body><main></main></body></html>');
  vi.stubGlobal('Event', window.Event);
  const sourceWindow = {
    document,
    location: new URL('https://sshawn9.com/en/blog/'),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as Window;
  const navigation: PageNavigation = {
    requestViewRefresh: vi.fn(),
    requestViewUpdate: vi.fn(),
    replaceViewUrl: vi.fn(),
  };
  return { document: document as unknown as Document, sourceWindow, navigation };
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('cleanup failure boundaries', () => {
  it('attempts all cleanups and retains errors in execution order', () => {
    const first = new Error('first cleanup');
    const second = new Error('second cleanup');
    const last = vi.fn();
    let failure: unknown;
    try {
      runCleanups(
        () => {
          throw first;
        },
        () => {
          throw second;
        },
        last,
      );
    } catch (error) {
      failure = error;
    }
    expect(last).toHaveBeenCalledOnce();
    expect((failure as AggregateError).errors).toEqual([first, second]);
  });

  it('preserves the original initialization error when rollback also fails', () => {
    const original = new Error('initialization');
    const cleanup = new Error('cleanup');
    let failure: unknown;
    try {
      rethrowAfterCleanup(original, () => {
        throw cleanup;
      });
    } catch (error) {
      failure = error;
    }
    expect((failure as AggregateError).cause).toBe(original);
    expect((failure as AggregateError).errors).toEqual([original, cleanup]);
    expect(() => rethrowAfterCleanup(original, () => {})).toThrow(original);
  });
});

describe('page controller publication', () => {
  it('can mount the same main again after creation fails, without duplicating a successful mount', () => {
    const { document, sourceWindow, navigation } = fixture();
    const runtime = createPageRuntime(document, sourceWindow);
    const failure = new Error('article initialization');
    const controller = { destroy: vi.fn() };
    hooks.article
      .mockImplementationOnce(() => {
        throw failure;
      })
      .mockReturnValue(controller);
    expect(() => runtime.mountCurrentPage(navigation)).toThrow(failure);
    runtime.mountCurrentPage(navigation);
    runtime.mountCurrentPage(navigation);
    expect(hooks.article).toHaveBeenCalledTimes(2);
    runtime.dispose();
    runtime.dispose();
    expect(controller.destroy).toHaveBeenCalledOnce();
  });

  it('makes the completed view available during canonicalization and unpublishes it on failure', () => {
    const { document, sourceWindow, navigation } = fixture();
    const runtime = createPageRuntime(document, sourceWindow);
    const failure = new Error('canonicalization');
    const controller: PageController = {
      destroy: vi.fn(),
      view: {
        resourceUrl: new URL(sourceWindow.location.href),
        queryParameters: ['tag'],
        resolve: (url) => {
          url.searchParams.set('tag', 'alpha');
          return { url, apply() {} };
        },
      },
    };
    hooks.blog.mockReturnValue(controller);
    vi.mocked(navigation.requestViewRefresh).mockImplementationOnce((resolve) => {
      expect(runtime.resolveView(resolve(new URL(sourceWindow.location.href)).url)).toBe(
        controller.view,
      );
      throw failure;
    });
    expect(() => runtime.mountCurrentPage(navigation)).toThrow(failure);
    expect(controller.destroy).toHaveBeenCalledOnce();
    expect(runtime.resolveView(new URL(sourceWindow.location.href))).toBeUndefined();
    const next = { destroy: vi.fn() };
    hooks.blog.mockReturnValue(next);
    runtime.mountCurrentPage(navigation);
    runtime.dispose();
    expect(next.destroy).toHaveBeenCalledOnce();
  });

  it('releases the page identity even when the previous controller cannot be destroyed cleanly', () => {
    const { document, sourceWindow, navigation } = fixture();
    const runtime = createPageRuntime(document, sourceWindow);
    const failure = new Error('destruction');
    const previous = {
      destroy: vi.fn(() => {
        throw failure;
      }),
    };
    hooks.article.mockReturnValueOnce(previous);
    runtime.mountCurrentPage(navigation);
    expect(() => runtime.beforeDocumentSwap(document, new URL(sourceWindow.location.href))).toThrow(
      failure,
    );
    const next = { destroy: vi.fn() };
    hooks.article.mockReturnValue(next);
    runtime.mountCurrentPage(navigation);
    runtime.dispose();
    expect(previous.destroy).toHaveBeenCalledOnce();
    expect(next.destroy).toHaveBeenCalledOnce();
  });
});

describe('initial site installation', () => {
  it('rolls back global controllers after a cold mount failure and permits a new installation', () => {
    const { document, sourceWindow, navigation } = fixture();
    const ready = vi.fn();
    document.addEventListener('site:runtime-ready', ready);
    const failure = new Error('cold mount');
    const navigationDispose = vi.fn();
    const overlayDispose = vi.fn();
    hooks.navigation.mockReturnValue({ ...navigation, dispose: navigationDispose });
    hooks.overlays.mockReturnValue({ closeForNavigation() {}, dispose: overlayDispose });
    hooks.article.mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => installSiteRuntime(document, sourceWindow)).toThrow(failure);
    expect(ready).not.toHaveBeenCalled();
    expect(navigationDispose).toHaveBeenCalledOnce();
    expect(overlayDispose).toHaveBeenCalledOnce();
    const dispose = installSiteRuntime(document, sourceWindow);
    expect(ready).toHaveBeenCalledOnce();
    expect(installSiteRuntime(document, sourceWindow)).toBe(dispose);
    expect(hooks.navigation).toHaveBeenCalledTimes(2);
    dispose();
    expect(navigationDispose).toHaveBeenCalledTimes(2);
    expect(overlayDispose).toHaveBeenCalledTimes(2);
  });

  it('still removes navigation and overlay resources when page disposal fails', () => {
    const { document, sourceWindow, navigation } = fixture();
    const failure = new Error('page cleanup');
    const navigationDispose = vi.fn();
    const overlayDispose = vi.fn();
    hooks.navigation.mockReturnValue({ ...navigation, dispose: navigationDispose });
    hooks.overlays.mockReturnValue({ closeForNavigation() {}, dispose: overlayDispose });
    hooks.article.mockReturnValueOnce({
      destroy() {
        throw failure;
      },
    });
    const dispose = installSiteRuntime(document, sourceWindow);
    expect(dispose).toThrow(failure);
    expect(navigationDispose).toHaveBeenCalledOnce();
    expect(overlayDispose).toHaveBeenCalledOnce();
    expect(dispose).not.toThrow();
    const next = installSiteRuntime(document, sourceWindow);
    expect(hooks.navigation).toHaveBeenCalledTimes(2);
    next();
  });
});
