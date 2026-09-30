import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { installInitialDocumentRuntime } from '../../../apps/site/src/runtime/initial-document-runtime';

const hooks = vi.hoisted(() => ({
  blogView: vi.fn(),
  blogSidebar: vi.fn(),
  articleSidebar: vi.fn(),
  toc: vi.fn(),
  fonts: vi.fn(),
  restorePage: vi.fn(),
  restoreNested: vi.fn(),
  initialFrame: vi.fn(),
  synchronizeHistory: vi.fn(),
  snapshot: vi.fn(),
  localeTransfer: vi.fn(),
  busy: vi.fn((document: Document) => document.querySelector('main')?.removeAttribute('aria-busy')),
}));

vi.mock('../../../apps/site/src/features/blog/runtime/blog-view', () => ({
  prepareTargetBlogView: hooks.blogView,
}));
vi.mock('../../../apps/site/src/features/blog/runtime/blog-sidebar-state', () => ({
  prepareTargetBlogSidebarState: hooks.blogSidebar,
}));
vi.mock('../../../apps/site/src/features/article/runtime/article-sidebar-state', () => ({
  prepareTargetArticleSidebarState: hooks.articleSidebar,
}));
vi.mock('../../../apps/site/src/features/article/runtime/article-toc-state', () => ({
  synchronizeArticleToc: hooks.toc,
}));
vi.mock('../../../apps/site/src/runtime/required-fonts', () => ({
  prepareRequiredFonts: hooks.fonts,
}));
vi.mock('../../../apps/site/src/runtime/scroll-state', () => ({
  restorePageScroll: hooks.restorePage,
  restoreNestedScroll: hooks.restoreNested,
}));
vi.mock('../../../apps/site/src/runtime/initial-frame', () => ({
  armInitialScrollRestoration: hooks.initialFrame,
  synchronizeClientRouterScrollState: hooks.synchronizeHistory,
}));
vi.mock('../../../apps/site/src/runtime/state-ledger', () => ({
  decodeScrollSnapshot: hooks.snapshot,
}));
vi.mock('../../../apps/site/src/runtime/locale-navigation-transfer', () => ({
  consumeLocaleNavigationTransfer: hooks.localeTransfer,
}));
vi.mock('../../../apps/site/src/runtime/navigation-feedback', () => ({
  reflectPageBusy: hooks.busy,
}));

function fixture() {
  const { document } = parseHTML(
    '<html data-font-state="loading"><body><main aria-busy="true"></main></body></html>',
  );
  vi.stubGlobal('Event', document.defaultView!.Event);
  const reportError = vi.fn();
  const history = { state: null, scrollRestoration: 'auto' } as unknown as History;
  const sourceWindow = Object.assign(new EventTarget(), {
    location: new URL('https://sshawn9.com/en/blog/'),
    history,
    sessionStorage: {},
    reportError,
  }) as unknown as Window;
  return {
    document: document as unknown as Document,
    sourceWindow,
    reportError,
    Event: document.defaultView!.Event,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  hooks.busy.mockImplementation((document: Document) =>
    document.querySelector('main')?.removeAttribute('aria-busy'),
  );
  hooks.localeTransfer.mockReturnValue(undefined);
  hooks.snapshot.mockReturnValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('initial document failure boundary', () => {
  it('continues to prepare fonts after a sidebar preparation failure', async () => {
    const { document, sourceWindow, reportError } = fixture();
    const failure = new Error('sidebar state failed');
    let resolveFonts!: () => void;
    hooks.blogSidebar.mockImplementationOnce(() => {
      throw failure;
    });
    hooks.fonts.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveFonts = resolve;
      }),
    );

    installInitialDocumentRuntime(document, sourceWindow);

    expect(hooks.fonts).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.fontState).toBe('loading');
    resolveFonts();
    await Promise.resolve();
    expect(reportError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(document.documentElement.dataset.fontState).toBe('ready');
    expect(document.querySelector('main')?.hasAttribute('aria-busy')).toBe(false);
  });

  it('releases the text gate and reports a placement failure after fonts are ready', async () => {
    const { document, sourceWindow, reportError } = fixture();
    const failure = new Error('TOC placement failed');
    hooks.toc.mockImplementationOnce(() => {
      throw failure;
    });
    hooks.fonts.mockReturnValueOnce(undefined);

    installInitialDocumentRuntime(document, sourceWindow);
    expect(reportError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(document.documentElement.dataset.fontState).toBe('ready');
    expect(document.querySelector('main')?.hasAttribute('aria-busy')).toBe(false);
  });

  it('keeps the text gate closed while fonts are pending or reject, while reporting a rejection', async () => {
    const pending = fixture();
    hooks.fonts.mockReturnValueOnce(new Promise<void>(() => {}));
    installInitialDocumentRuntime(pending.document, pending.sourceWindow);
    expect(pending.document.documentElement.dataset.fontState).toBe('loading');
    expect(pending.document.querySelector('main')?.getAttribute('aria-busy')).toBe('true');

    const rejected = fixture();
    const failure = new Error('font loading failed');
    hooks.fonts.mockRejectedValueOnce(failure);
    installInitialDocumentRuntime(rejected.document, rejected.sourceWindow);
    await Promise.resolve();
    await Promise.resolve();
    expect(rejected.reportError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(rejected.document.documentElement.dataset.fontState).toBe('loading');
    expect(rejected.document.querySelector('main')?.getAttribute('aria-busy')).toBe('true');
  });

  it('does not release a replaced document from a late font callback', async () => {
    const { document, sourceWindow } = fixture();
    let resolveFonts!: () => void;
    hooks.fonts.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveFonts = resolve;
      }),
    );
    installInitialDocumentRuntime(document, sourceWindow);
    const replacement = document.createElement('body');
    replacement.innerHTML = '<main aria-busy="true"></main>';
    document.body.replaceWith(replacement);
    resolveFonts();
    await Promise.resolve();

    expect(hooks.toc).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.fontState).toBe('loading');
    expect(document.querySelector('main')?.getAttribute('aria-busy')).toBe('true');
  });

  it('keeps root-scroll, TOC, and nested-scroll ordering on success', () => {
    const { document, sourceWindow, reportError } = fixture();
    const order: string[] = [];
    const point = { x: 10, y: 20 };
    hooks.snapshot.mockReturnValue({ page: point });
    hooks.restorePage.mockImplementation(() => order.push('root'));
    hooks.toc.mockImplementation(() => order.push('toc'));
    hooks.restoreNested.mockImplementation(() => order.push('nested'));

    installInitialDocumentRuntime(document, sourceWindow);

    expect(order).toEqual(['root', 'toc', 'nested']);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('keeps full-document navigation guarded until runtime ready, then releases it', () => {
    const { document, sourceWindow, Event } = fixture();
    hooks.fonts.mockReturnValue(new Promise<void>(() => {}));
    installInitialDocumentRuntime(document, sourceWindow);
    const beforeReady = new Event('astro:before-preparation', { cancelable: true });
    document.dispatchEvent(beforeReady);
    expect(beforeReady.defaultPrevented).toBe(true);

    document.dispatchEvent(new Event('site:runtime-ready'));
    const afterReady = new Event('astro:before-preparation', { cancelable: true });
    document.dispatchEvent(afterReady);
    expect(afterReady.defaultPrevented).toBe(false);
  });

  it('uses locale transfer before the history snapshot and skips nested restoration', () => {
    const { document, sourceWindow } = fixture();
    const snapshotPoint = { x: 10, y: 20 };
    const localePoint = { x: 30, y: 40 };
    hooks.snapshot.mockReturnValue({ page: snapshotPoint });
    hooks.localeTransfer.mockReturnValue(localePoint);

    installInitialDocumentRuntime(document, sourceWindow);

    expect(hooks.restorePage).toHaveBeenCalledExactlyOnceWith(document, sourceWindow, localePoint);
    expect(hooks.restoreNested).not.toHaveBeenCalled();
  });
});
