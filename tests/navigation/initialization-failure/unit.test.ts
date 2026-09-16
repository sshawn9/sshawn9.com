import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { installNavigationCoordinator } from '../../../apps/site/src/runtime/navigation-coordinator';
import type { PageRuntime } from '../../../apps/site/src/runtime/page-runtime';

const hooks = vi.hoisted(() => ({
  prepare: vi.fn(),
  enter: vi.fn(),
  cancel: vi.fn(),
  fonts: vi.fn(),
  registration: vi.fn(),
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
    hooks.registration(type);
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
  ) => {
    const controller = new AbortController();
    const event = {
      from: new URL(location),
      to: new URL(path, location),
      newDocument: document,
      navigationType,
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
    const event = { ...preparation.event, swap: vi.fn() };
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
    closeOverlays,
    coordinator,
    emit,
    begin,
    swap,
    handlers,
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

it('does not reload over a navigation started while reporting the traversal failure', async () => {
  const f = fixture();
  const failure = new Error('traversal preparation failed');
  vi.mocked(f.pages.prepareTargetDocument).mockImplementationOnce(() => {
    throw failure;
  });
  let next!: ReturnType<typeof f.begin>;
  vi.mocked(f.sourceWindow.reportError).mockImplementationOnce(() => {
    next = f.begin('/en/about/');
  });
  const first = f.begin('/en/projects/', undefined, 'traverse');
  await expect(first.event.loader()).rejects.toBe(failure);
  expect(f.location.reload).not.toHaveBeenCalled();
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

it('rolls back listener registration if installing the coordinator fails', () => {
  const f = fixture();
  f.coordinator.dispose();
  expect(f.handlers.size).toBe(0);
  const failure = new Error('listener registration failed');
  hooks.registration
    .mockImplementationOnce(() => {})
    .mockImplementationOnce(() => {
      throw failure;
    });
  expect(() =>
    installNavigationCoordinator(f.document as unknown as Document, f.sourceWindow, {
      pages: f.pages,
      documentReady: f.ready,
      closeDocumentOverlays: f.closeOverlays,
    }),
  ).toThrow(failure);
  expect(f.handlers.size).toBe(0);
});

it('restores the prepared transparent target even when cancelling the outgoing animation fails', async () => {
  const { PageOutletTransition } = await vi.importActual<
    typeof import('../../../apps/site/src/runtime/page-outlet-transition')
  >('../../../apps/site/src/runtime/page-outlet-transition');
  const { document } = parseHTML('<html><body><div class="page-outlet"></div></body></html>');
  const target = parseHTML('<html><body><div class="page-outlet"></div></body></html>').document;
  const outgoing = document.querySelector<HTMLElement>('.page-outlet')!;
  const incoming = target.querySelector<HTMLElement>('.page-outlet')!;
  const failure = new Error('outgoing cancellation failed');
  Object.assign(outgoing, {
    animate: () => ({
      finished: Promise.resolve(),
      cancel() {
        throw failure;
      },
    }),
  });
  const sourceWindow = {
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ opacity: '1' }),
  };
  const transition = new PageOutletTransition(
    document as unknown as Document,
    sourceWindow as unknown as Window,
  );
  await transition.prepareOutgoing(new AbortController().signal);
  transition.prepareSwap({ newDocument: target } as never);
  expect(incoming.style.opacity).toBe('0');
  expect(() => transition.cancel()).toThrow(failure);
  expect(incoming.hasAttribute('data-page-outlet-entering')).toBe(false);
  expect(incoming.style.opacity ?? '').toBe('');
  expect(outgoing.style.opacity ?? '').toBe('');
  expect(() => transition.cancel()).not.toThrow();
});
