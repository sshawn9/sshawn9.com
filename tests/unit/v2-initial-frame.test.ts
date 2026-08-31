import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FONT_TIMEOUT_MS } from '../../apps/site-v2/src/runtime/font-coordinator';
import {
  armInitialScrollRestoration,
  createInitialFrameScript,
  synchronizeClientRouterInitialScrollState,
} from '../../apps/site-v2/src/runtime/initial-frame';

function installDocument(
  fontLoad: () => Promise<FontFace[]>,
  fontReady: Promise<FontFaceSet> = new Promise<FontFaceSet>(() => {}),
  fontCheck: () => boolean = () => false,
): {
  root: HTMLElement;
  fallbackAttributes: Set<string>;
} {
  const root = { dataset: { fontState: 'loading' }, style: {} } as unknown as HTMLElement;
  const fallbackAttributes = new Set<string>();
  const surface = {
    toggleAttribute: (name: string, force: boolean) =>
      force ? fallbackAttributes.add(name) : fallbackAttributes.delete(name),
  };
  vi.stubGlobal('document', {
    documentElement: root,
    body: { textContent: '博客列表' },
    querySelector: () => undefined,
    querySelectorAll: (selector: string) =>
      selector.startsWith('meta[')
        ? [{ content: '400 1em "Source Sans 3 Variable"' }]
        : selector === '[data-font-surface]'
          ? [surface]
          : [],
    fonts: { load: fontLoad, ready: fontReady, check: fontCheck },
    readyState: 'complete',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('history', { state: null, scrollRestoration: 'auto' });
  vi.stubGlobal('location', { pathname: '/en/', search: '', hash: '' });
  vi.stubGlobal('window', {
    sessionStorage: { getItem: () => null, removeItem: () => {} },
  });
  return { root, fallbackAttributes };
}

describe('v2 initial frame coordinator', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('emits a self-contained parser script', () => {
    const source = createInitialFrameScript();
    expect(() => new Function(source)).not.toThrow();
    expect(source).toContain('readRequiredFontText');
    expect(source).toContain('data-font-fallback');
  });

  it('holds typography until timeout, then releases one stable fallback state', async () => {
    const { root, fallbackAttributes } = installDocument(() => new Promise<FontFace[]>(() => {}));

    Function(createInitialFrameScript())();
    expect(root.dataset.fontState).toBe('loading');
    expect(fallbackAttributes.size).toBe(0);

    await vi.advanceTimersByTimeAsync(FONT_TIMEOUT_MS);
    expect(root.dataset.fontState).toBe('degraded');
    expect(fallbackAttributes.has('data-font-fallback')).toBe(true);
  });

  it('marks ready only after this document font set is ready', async () => {
    let releaseLoad = (_faces: FontFace[]) => {};
    const load = new Promise<FontFace[]>((resolve) => {
      releaseLoad = resolve;
    });
    const { root } = installDocument(() => load, Promise.resolve({} as FontFaceSet));

    Function(createInitialFrameScript())();
    expect(root.dataset.fontState).toBe('loading');

    releaseLoad([{} as FontFace]);
    await vi.runAllTimersAsync();
    expect(root.dataset.fontState).toBe('ready');
  });

  it('commits an already-loaded warm document synchronously', () => {
    const load = vi.fn(async () => [{} as FontFace]);
    const { root } = installDocument(load, Promise.resolve({} as FontFaceSet), () => true);

    Function(createInitialFrameScript())();

    expect(root.dataset.fontState).toBe('ready');
    expect(load).not.toHaveBeenCalled();
  });

  it('aligns ClientRouter startup with the restored StateLedger point', () => {
    const replaceState = vi.fn();
    const sourceHistory = {
      state: { index: 4, scrollX: 0, scrollY: 0, sshawn9: { keep: true } },
      replaceState,
    } as unknown as History;

    synchronizeClientRouterInitialScrollState(sourceHistory, { x: 12, y: 840 });

    expect(replaceState).toHaveBeenCalledWith(
      { index: 4, scrollX: 12, scrollY: 840, sshawn9: { keep: true } },
      '',
    );
  });

  it('does not invent ClientRouter state before the router initializes it', () => {
    const replaceState = vi.fn();
    synchronizeClientRouterInitialScrollState({ state: null, replaceState } as unknown as History, {
      x: 12,
      y: 840,
    });

    expect(replaceState).not.toHaveBeenCalled();
  });

  it('keeps automatic restoration non-animated until the first user interaction', () => {
    const attributes = new Set<string>();
    const listeners = new Map<string, EventListener>();
    const sourceDocument = {
      documentElement: {
        setAttribute: (name: string) => attributes.add(name),
        removeAttribute: (name: string) => attributes.delete(name),
      },
      addEventListener: (name: string, listener: EventListener) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
    } as unknown as Document;

    armInitialScrollRestoration(sourceDocument);
    expect(attributes.has('data-initial-scroll-restoration')).toBe(true);

    listeners.get('click')?.({} as Event);
    expect(attributes.has('data-initial-scroll-restoration')).toBe(false);
    expect(listeners.size).toBe(0);
  });

  it('falls back to readable font state after a synchronous state failure', () => {
    const { root, fallbackAttributes } = installDocument(async () => []);
    vi.stubGlobal('history', {
      get state() {
        throw new Error('history unavailable');
      },
    });

    Function(createInitialFrameScript())();

    expect(root.dataset.fontState).toBe('degraded');
    expect(fallbackAttributes.has('data-font-fallback')).toBe(true);
  });
});
