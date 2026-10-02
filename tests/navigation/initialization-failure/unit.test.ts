import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { installNavigationCoordinator } from '../../../apps/site/src/runtime/navigation-coordinator';
import type { PageRuntime } from '../../../apps/site/src/runtime/page-runtime';
import { navigate } from 'astro:transitions/client';
import type { ViewUpdate } from '../../../apps/site/src/runtime/page-navigation';

const hooks = vi.hoisted(() => ({
  prepare: vi.fn(),
  enter: vi.fn(),
  cancel: vi.fn(),
  fonts: vi.fn(),
}));
vi.mock('astro:transitions/client', () => ({ navigate: vi.fn() }));
vi.mock('../../../apps/site/src/runtime/build-identity', () => ({
  CURRENT_BUILD_ID: 'test-build',
}));
vi.mock('../../../apps/site/src/runtime/required-fonts', () => ({
  prepareRequiredFonts: hooks.fonts,
}));
vi.mock('../../../apps/site/src/runtime/page-outlet-transition', () => ({
  PageOutletTransition: class {
    prepareOutgoing() {
      return Promise.resolve();
    }
    prepareSwap = hooks.prepare;
    enterTarget = hooks.enter;
    cancel = hooks.cancel;
    dispose = vi.fn();
  },
}));

function fixture() {
  const { document } = parseHTML(
    '<html data-font-state="ready"><head><meta name="site-build-id" content="test-build"></head><body><main></main></body></html>',
  );
  const handlers = new Map<string, EventListener>();
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    handlers.set(type, listener as EventListener);
    if (options && typeof options === 'object') {
      options.signal?.addEventListener(
        'abort',
        () => {
          if (handlers.get(type) === listener) handlers.delete(type);
        },
        { once: true },
      );
    }
  });
  const location = Object.assign(new URL('https://sshawn9.com/en/blog/'), { reload: vi.fn() });
  const sourceWindow = {
    document,
    location,
    scrollX: 0,
    scrollY: 0,
    scrollTo: vi.fn(),
    history: { state: null, replaceState: vi.fn() },
    sessionStorage: { getItem: () => null, removeItem() {} },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    performance: { now: () => Date.now() },
    setTimeout,
    clearTimeout,
    queueMicrotask,
    reportError: vi.fn(),
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn(),
  } as unknown as Window;
  const pages: PageRuntime = {
    resolveView: vi.fn(),
    prepareTargetDocument: vi.fn(),
    beforeDocumentSwap: vi.fn(),
    prepareCurrentDocument: vi.fn(),
    mountCurrentPage: vi.fn(),
    dispose: vi.fn(),
  };
  const ready = vi.fn();
  const closeOverlays = vi.fn();
  const coordinator = installNavigationCoordinator(document as unknown as Document, sourceWindow, {
    pages,
    documentReady: ready,
    closeDocumentOverlays: closeOverlays,
  });
  const emit = (name: string, event: unknown = {}) => handlers.get(name)?.(event as Event);
  const begin = (
    path = '/en/projects/',
    loader: () => Promise<void> = async () => {},
    navigationType: 'push' | 'replace' | 'traverse' = 'push',
    info?: unknown,
  ) => {
    const controller = new AbortController();
    const event = {
      from: new URL(location),
      to: new URL(path, location),
      newDocument: document,
      navigationType,
      info,
      signal: controller.signal,
      defaultPrevented: false,
      loader,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    // Native traversal selects the destination entry before Astro receives it.
    if (navigationType === 'traverse') location.href = event.to.href;
    emit('astro:before-preparation', event);
    return { event, controller };
  };
  const swap = (preparation: ReturnType<typeof begin>) => {
    const event = {
      ...preparation.event,
      swap: vi.fn(),
      viewTransition: { skipTransition: vi.fn(), ready: Promise.resolve() },
    };
    emit('astro:before-swap', event);
    event.swap();
    location.href = event.to.href;
    emit('astro:after-swap');
  };
  return {
    document,
    sourceWindow,
    pages,
    ready,
    coordinator,
    emit,
    begin,
    swap,
    location,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function viewFixture() {
  const f = fixture();
  const view = {
    resourceUrl: new URL(f.location),
    queryParameters: ['page'],
    normalize: (url: URL) => url,
    apply: vi.fn(),
    resolve: vi.fn((source: URL): ViewUpdate => {
      const url = view.normalize(source);
      return { url, apply: (context) => view.apply(url, context) };
    }),
  };
  vi.mocked(f.pages.resolveView).mockReturnValue(view);
  const update = (url: URL) => {
    url.searchParams.set('page', String(Number(url.searchParams.get('page') ?? '1') + 1));
    return view.resolve(url);
  };
  return { ...f, view, update };
}

it('resolves requested scrolling against the rendered view after restoring the origin', async () => {
  const f = viewFixture();
  const resolveScroll = vi.fn(() => {
    expect(f.view.apply).toHaveBeenCalledOnce();
    expect(f.sourceWindow.scrollTo).toHaveBeenCalledExactlyOnceWith({
      left: 0,
      top: 0,
      behavior: 'instant',
    });
    return { x: 0, y: 96 };
  });
  vi.mocked(navigate).mockImplementation(async (href, options) => {
    f.swap(f.begin(href, undefined, 'push', options?.info));
  });
  f.coordinator.requestViewUpdate(f.update, { resolveScroll });
  await Promise.resolve();
  expect(resolveScroll).toHaveBeenCalledOnce();
  expect(f.sourceWindow.scrollTo).toHaveBeenLastCalledWith({
    left: 0,
    top: 96,
    behavior: 'instant',
  });
  f.coordinator.dispose();
});

it('fails the queue when Astro resolves without a view commit and permits a later retry', async () => {
  const f = viewFixture();
  vi.mocked(navigate).mockResolvedValue(undefined);
  f.coordinator.requestViewUpdate(f.update);
  f.coordinator.requestViewUpdate(f.update);
  await Promise.resolve();
  expect(navigate).toHaveBeenCalledOnce();
  expect(f.sourceWindow.reportError).toHaveBeenCalledOnce();
  vi.mocked(navigate).mockImplementation(async (href, options) =>
    f.swap(f.begin(href, undefined, 'push', options?.info)),
  );
  f.coordinator.requestViewUpdate(f.update);
  await Promise.resolve();
  expect(f.location.search).toBe('?page=2');
  f.coordinator.dispose();
});

it('settles cancelled and duplicate pending intents without reporting success or replaying successors', async () => {
  const f = viewFixture();
  let pending!: ReturnType<typeof f.begin>;
  let release!: () => void;
  vi.mocked(navigate).mockImplementation((href, options) => {
    pending = f.begin(href, undefined, 'push', options?.info);
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  f.coordinator.requestViewUpdate(f.update);
  f.coordinator.requestViewUpdate(f.update);
  f.coordinator.requestViewUpdate((url) => f.view.resolve(url));
  pending.controller.abort();
  release();
  await Promise.resolve();
  expect(navigate).toHaveBeenCalledOnce();
  expect(f.view.apply).not.toHaveBeenCalled();
  expect(f.sourceWindow.reportError).not.toHaveBeenCalled();
  f.coordinator.dispose();
});

it('recovers a failed view render by reloading the committed history entry', async () => {
  const f = viewFixture();
  const failure = new Error('view render failed');
  f.view.apply.mockImplementation(() => {
    throw failure;
  });
  vi.mocked(navigate).mockImplementation(async (href, options) =>
    f.swap(f.begin(href, undefined, 'push', options?.info)),
  );
  f.coordinator.requestViewUpdate(f.update);
  await Promise.resolve();
  expect(f.location.search).toBe('?page=2');
  expect(f.location.reload).toHaveBeenCalledOnce();
  expect(f.sourceWindow.reportError).toHaveBeenCalledExactlyOnceWith(failure);
  f.coordinator.dispose();
});

it('ends failed mounting feedback and allows the next navigation to complete', async () => {
  const f = fixture();
  const first = f.begin();
  await vi.advanceTimersByTimeAsync(150);
  expect(f.document.documentElement.dataset.navigationProgress).toBe('active');
  await first.event.loader();
  f.swap(first);
  const error = new Error('page mount failed');
  f.ready.mockImplementationOnce(() => {
    throw error;
  });
  expect(() => f.emit('astro:page-load')).toThrow(error);
  expect(f.document.documentElement.hasAttribute('data-navigation-pending')).toBe(false);
  expect(f.document.documentElement.hasAttribute('data-navigation-progress')).toBe(false);
  const next = f.begin('/en/about/');
  await next.event.loader();
  f.swap(next);
  f.emit('astro:page-load');
  expect(f.document.documentElement.hasAttribute('data-navigation-pending')).toBe(false);
  f.coordinator.dispose();
});

it('does not let a late failed page-load finish a newer preparation', async () => {
  const f = fixture();
  const previous = f.begin();
  await previous.event.loader();
  f.swap(previous);
  previous.controller.abort();
  const next = f.begin('/en/about/');
  const error = new Error('late mount failed');
  f.ready.mockImplementationOnce(() => {
    throw error;
  });
  expect(() => f.emit('astro:page-load')).toThrow(error);
  expect(f.document.documentElement.hasAttribute('data-navigation-pending')).toBe(true);
  await vi.advanceTimersByTimeAsync(150);
  expect(f.document.documentElement.dataset.navigationProgress).toBe('active');
  await next.event.loader();
  f.swap(next);
  f.emit('astro:page-load');
  expect(f.document.documentElement.hasAttribute('data-navigation-pending')).toBe(false);
  f.coordinator.dispose();
});

it('terminates target preparation failure instead of waiting for a page-load that will not arrive', async () => {
  const f = fixture();
  const error = new Error('target setup failed');
  vi.mocked(f.pages.prepareTargetDocument).mockImplementationOnce(() => {
    throw error;
  });
  const preparation = f.begin();
  await expect(preparation.event.loader()).rejects.toBe(error);
  expect(f.document.documentElement.hasAttribute('data-navigation-pending')).toBe(false);
  expect(hooks.cancel).toHaveBeenCalledOnce();
  expect(f.location.reload).not.toHaveBeenCalled();
  f.coordinator.dispose();
});

it('reloads a failed traversal entry even when a transition cleanup also fails', async () => {
  const f = fixture();
  const failure = new Error('traversal preparation failed');
  const cleanupFailure = new Error('transition cleanup failed');
  vi.mocked(f.pages.prepareTargetDocument).mockImplementationOnce(() => {
    throw failure;
  });
  hooks.cancel.mockImplementationOnce(() => {
    throw cleanupFailure;
  });
  const preparation = f.begin('/en/projects/#main-content', undefined, 'traverse');
  const error = await preparation.event.loader().catch((error: unknown) => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors).toEqual([failure, cleanupFailure]);
  expect(f.sourceWindow.reportError).toHaveBeenCalledExactlyOnceWith(error);
  expect(vi.mocked(f.sourceWindow.reportError).mock.invocationCallOrder[0]).toBeLessThan(
    f.location.reload.mock.invocationCallOrder[0]!,
  );
  expect(f.location.href).toBe('https://sshawn9.com/en/projects/#main-content');
  expect(f.location.reload).toHaveBeenCalledOnce();
  expect(f.document.documentElement.hasAttribute('data-navigation-pending')).toBe(false);
  f.coordinator.dispose();
});

it('does not reload a superseded traversal when its loader rejects late', async () => {
  const f = fixture();
  let reject!: (error: unknown) => void;
  const first = f.begin(
    '/en/projects/',
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
    'traverse',
  );
  const failure = new Error('old traversal failed');
  const rejected = expect(first.event.loader()).rejects.toBe(failure);
  first.controller.abort();
  const next = f.begin('/en/about/');
  reject(failure);
  await rejected;
  expect(f.location.reload).not.toHaveBeenCalled();
  expect(f.sourceWindow.reportError).not.toHaveBeenCalled();
  expect(f.document.documentElement.hasAttribute('data-navigation-pending')).toBe(true);
  await next.event.loader();
  f.swap(next);
  f.emit('astro:page-load');
  f.coordinator.dispose();
});

it('keeps the target document after a traversal commits, even if placement or mounting fails', async () => {
  const f = fixture();
  const first = f.begin('/en/projects/', undefined, 'traverse');
  await first.event.loader();
  const failure = new Error('target placement failed');
  vi.mocked(f.pages.prepareCurrentDocument).mockImplementationOnce(() => {
    throw failure;
  });
  expect(() => f.swap(first)).toThrow(failure);
  expect(f.location.reload).not.toHaveBeenCalled();
  const next = f.begin('/en/about/', undefined, 'traverse');
  await next.event.loader();
  f.swap(next);
  f.ready.mockImplementationOnce(() => {
    throw failure;
  });
  expect(() => f.emit('astro:page-load')).toThrow(failure);
  expect(f.location.reload).not.toHaveBeenCalled();
  expect(f.document.documentElement.hasAttribute('data-navigation-pending')).toBe(false);
  f.coordinator.dispose();
});

it('keeps a newer navigation pending when the old loader rejects late', async () => {
  const f = fixture();
  let reject!: (error: unknown) => void;
  const first = f.begin(
    '/en/projects/',
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const loading = first.event.loader();
  const error = new Error('late loader rejection');
  const rejected = expect(loading).rejects.toBe(error);
  first.controller.abort();
  const next = f.begin('/en/about/');
  reject(error);
  await rejected;
  await vi.advanceTimersByTimeAsync(150);
  expect(f.document.documentElement.hasAttribute('data-navigation-pending')).toBe(true);
  await next.event.loader();
  f.swap(next);
  f.emit('astro:page-load');
  f.coordinator.dispose();
});

it('settles swap preparation and after-swap failures without claiming fonts are ready', async () => {
  const f = fixture();
  const first = f.begin();
  await first.event.loader();
  const preparationError = new Error('transition setup failed');
  hooks.prepare.mockImplementationOnce(() => {
    throw preparationError;
  });
  expect(() => f.swap(first)).toThrow(preparationError);
  expect(f.document.documentElement.hasAttribute('data-navigation-pending')).toBe(false);

  const second = f.begin('/en/about/');
  await second.event.loader();
  f.document.documentElement.dataset.fontState = 'loading';
  const placementError = new Error('TOC placement failed');
  vi.mocked(f.pages.prepareCurrentDocument).mockImplementationOnce(() => {
    throw placementError;
  });
  expect(() => f.swap(second)).toThrow(placementError);
  expect(f.document.documentElement.hasAttribute('data-navigation-pending')).toBe(false);
  expect(f.document.querySelector('main')?.getAttribute('aria-busy')).toBe('true');
  expect(f.document.documentElement.dataset.fontState).toBe('loading');
  f.coordinator.dispose();
});

it('orders a replacing preference refresh after a page and before the next page action', async () => {
  const f = viewFixture();
  let maximum = 3;
  f.view.normalize = (url) => {
    const page = Math.min(Number(url.searchParams.get('page') ?? 1), maximum);
    if (page > 1) url.searchParams.set('page', String(page));
    else url.searchParams.delete('page');
    return url;
  };
  let pending!: ReturnType<typeof f.begin>;
  let release!: () => void;
  vi.mocked(navigate).mockImplementation((href, options) => {
    pending = f.begin(
      href,
      undefined,
      options?.history === 'replace' ? 'replace' : 'push',
      options?.info,
    );
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  f.coordinator.requestViewUpdate(f.update);
  f.coordinator.requestViewRefresh((url) => {
    maximum = 1;
    return f.view.resolve(url);
  });
  f.coordinator.requestViewUpdate(f.update);
  expect(maximum).toBe(3);
  f.swap(pending);
  release();
  await Promise.resolve();
  expect(maximum).toBe(1);
  expect(navigate).toHaveBeenCalledTimes(2);
  expect(vi.mocked(navigate).mock.calls[1]?.[1]?.history).toBe('replace');
  f.swap(pending);
  release();
  await Promise.resolve();
  expect(f.location.search).toBe('');
  expect(f.view.apply.mock.calls.map(([url]) => url.search)).toEqual(['?page=2', '', '']);
  f.coordinator.dispose();
});

it('refreshes a view without navigation when its URL stays unchanged', async () => {
  const f = viewFixture();
  f.coordinator.requestViewRefresh(f.view.resolve);
  expect(f.view.resolve).not.toHaveBeenCalled();
  await Promise.resolve();
  expect(f.view.resolve).toHaveBeenCalledOnce();
  expect(f.view.apply).toHaveBeenCalledOnce();
  expect(navigate).not.toHaveBeenCalled();
  f.coordinator.dispose();
});

it('external navigation resolves current inputs once and discards old queued refreshes', async () => {
  const f = viewFixture();
  let release!: () => void;
  vi.mocked(navigate).mockImplementation((href, options) => {
    f.begin(href, undefined, 'push', options?.info);
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  });
  f.coordinator.requestViewUpdate(f.update);
  const refresh = vi.fn((url: URL) => f.view.resolve(url));
  f.coordinator.requestViewRefresh(refresh);
  f.view.resolve.mockClear();
  const external = f.begin('/en/blog/?page=3');
  f.swap(external);
  release();
  await Promise.resolve();
  expect(f.view.resolve).toHaveBeenCalledOnce();
  expect(refresh).not.toHaveBeenCalled();
  expect(f.location.search).toBe('?page=3');
  f.coordinator.dispose();
});

it('cancels refreshes queued behind an external navigation and reconciles the retained view', async () => {
  const f = viewFixture();
  const reconcile = vi.fn(() => f.coordinator.requestViewRefresh(f.view.resolve));
  Object.assign(f.view, { refresh: reconcile });
  const external = f.begin('/en/blog/?page=3');
  const stale = vi.fn((url: URL) => f.view.resolve(url));
  f.coordinator.requestViewRefresh(stale);
  external.controller.abort();
  await Promise.resolve();
  expect(stale).not.toHaveBeenCalled();
  expect(reconcile).toHaveBeenCalledOnce();
  await Promise.resolve();
  expect(f.view.apply).toHaveBeenCalledOnce();
  vi.mocked(navigate).mockImplementation(async (href, options) =>
    f.swap(f.begin(href, undefined, 'push', options?.info)),
  );
  f.coordinator.requestViewUpdate(f.update);
  await Promise.resolve();
  expect(f.location.search).toBe('?page=2');
  expect(f.sourceWindow.reportError).not.toHaveBeenCalled();
  f.coordinator.dispose();
});

it.each(['layout', 'scroll'] as const)(
  'keeps committed content and drains later commands after a %s effect fails',
  async (effect) => {
    const f = viewFixture();
    const failure = new Error('placement failed');
    const fail = () => {
      throw failure;
    };
    vi.mocked(navigate).mockImplementation(async (href, options) =>
      f.swap(f.begin(href, undefined, 'push', options?.info)),
    );
    f.coordinator.requestViewUpdate(
      (url) => ({ ...f.update(url), afterApply: effect === 'layout' ? fail : undefined }),
      { resolveScroll: effect === 'scroll' ? fail : undefined },
    );
    f.coordinator.requestViewUpdate(f.update);
    await Promise.resolve();
    await Promise.resolve();
    expect(f.location.search).toBe('?page=3');
    expect(f.view.apply).toHaveBeenCalledTimes(2);
    expect(f.view.resolve).toHaveBeenCalledTimes(2);
    expect(f.location.reload).not.toHaveBeenCalled();
    expect(f.sourceWindow.reportError).toHaveBeenCalledExactlyOnceWith(failure);
    f.coordinator.dispose();
  },
);

it('does not mistake a cancelled navigation’s late swap for the newer view commit', () => {
  const f = viewFixture();
  const older = f.begin('/en/blog/?page=2');
  older.controller.abort();
  const newer = f.begin('/en/blog/?page=3');
  // Astro can finish moveToLocation after an aborted swap callback has returned.
  f.swap(older);
  expect(f.view.apply).not.toHaveBeenCalled();
  expect(f.location.search).toBe('?page=2');
  f.swap(newer);
  expect(f.view.apply).toHaveBeenCalledOnce();
  expect(f.view.apply.mock.calls[0]?.[0].search).toBe('?page=3');
  f.coordinator.dispose();
});
