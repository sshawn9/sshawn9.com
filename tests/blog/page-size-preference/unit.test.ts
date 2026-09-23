import { expect, test, vi } from 'vitest';
import {
  BLOG_READING_STORAGE_KEYS as keys,
  getBlogReadingPreference,
} from '../../../apps/site/src/features/blog/runtime/blog-reading-preference';

function storage(values: Map<string, string>) {
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

function restoreFromCache(window: Window) {
  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
}

function fixture(initial: Record<string, string> = {}) {
  const saved = new Map(Object.entries(initial));
  const tabSaved = new Map<string, string>();
  const localStorage = storage(saved);
  const sessionStorage = storage(tabSaved);
  const createWindow = (tabStorage = sessionStorage) =>
    Object.assign(new EventTarget(), {
      localStorage,
      sessionStorage: tabStorage,
    }) as unknown as Window;
  const window = createWindow();
  return {
    window,
    localStorage,
    sessionStorage,
    saved,
    tabSaved,
    reload: () => createWindow(),
    newTab: () => createWindow(storage(new Map())),
    external(key: string, value: string) {
      saved.set(key, value);
      const event = new Event('storage');
      Object.assign(event, { key, storageArea: localStorage });
      window.dispatchEvent(event);
    },
  };
}

test('one tab owner captures all initial settings without rewriting shared defaults', () => {
  const f = fixture({ [keys.detailed]: '10' });
  const store = getBlogReadingPreference(f.window);
  expect(store).toBe(getBlogReadingPreference(f.window));
  expect(store.get()).toEqual({ mode: 'detailed', pageSizes: { detailed: 10, compact: 15 } });
  expect(Object.fromEntries(f.tabSaved)).toEqual({
    [keys.mode]: 'detailed',
    [keys.detailed]: '10',
    [keys.compact]: '15',
  });
  expect(f.localStorage.setItem).not.toHaveBeenCalled();
  const initial = store.get();
  const listeners = new AbortController();
  const changed = vi.fn();
  store.subscribe(changed, listeners.signal);
  store.setPageSize('detailed', 20);
  expect(changed).toHaveBeenCalledExactlyOnceWith(store.get());
  expect(initial.pageSizes.detailed).toBe(10);
  expect(f.saved.get(keys.detailed)).toBe('20');
  listeners.abort();
  store.setPageSize('detailed', 50);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(getBlogReadingPreference(f.window).get().pageSizes.detailed).toBe(50);
});

test('external changes cannot alter a tab during mount, after unmount, on pageshow or on reload', () => {
  const f = fixture({ [keys.mode]: 'compact', [keys.detailed]: '10', [keys.compact]: '50' });
  const store = getBlogReadingPreference(f.window);
  const initial = store.get();
  // The persistent value may change between the initial read and attaching the page listener.
  f.external(keys.mode, 'detailed');
  const listeners = new AbortController();
  const changed = vi.fn();
  store.subscribe(changed, listeners.signal);
  f.external(keys.detailed, '20');
  f.external(keys.compact, '100');
  restoreFromCache(f.window);
  expect(store.get()).toBe(initial);
  expect(changed).not.toHaveBeenCalled();
  listeners.abort();
  expect(store.get()).toBe(initial);
  expect(getBlogReadingPreference(f.reload()).get()).toEqual(initial);
  expect(f.localStorage.setItem).not.toHaveBeenCalled();
  expect(Object.fromEntries(f.saved)).toEqual({
    [keys.mode]: 'detailed',
    [keys.detailed]: '20',
    [keys.compact]: '100',
  });
});

test('cached documents restore this tab’s latest settings without reading or writing shared defaults', () => {
  const f = fixture({ [keys.detailed]: '10' });
  const cached = getBlogReadingPreference(f.window);
  const listeners = new AbortController();
  const changed = vi.fn();
  cached.subscribe(changed, listeners.signal);
  const newer = getBlogReadingPreference(f.reload());
  newer.setPageSize('detailed', 20);
  newer.setMode('compact');
  newer.setPageSize('compact', 50);
  f.external(keys.mode, 'detailed');
  f.external(keys.detailed, '5');
  f.external(keys.compact, '100');
  f.localStorage.getItem.mockClear();
  f.localStorage.setItem.mockClear();
  f.sessionStorage.setItem.mockClear();
  restoreFromCache(f.window);
  expect(cached.get()).toEqual({ mode: 'compact', pageSizes: { detailed: 20, compact: 50 } });
  expect(changed).toHaveBeenCalledExactlyOnceWith(cached.get());
  expect(f.localStorage.getItem).not.toHaveBeenCalled();
  expect(f.localStorage.setItem).not.toHaveBeenCalled();
  expect(f.sessionStorage.setItem).not.toHaveBeenCalled();
  listeners.abort();
  newer.setPageSize('compact', 100);
  restoreFromCache(f.window);
  expect(cached.get().pageSizes.compact).toBe(100);
  expect(changed).toHaveBeenCalledTimes(1);
});

test('future tabs inherit each last confirmed field without overwriting other tabs or untouched fields', () => {
  const f = fixture();
  const first = getBlogReadingPreference(f.window);
  const second = getBlogReadingPreference(f.newTab());
  first.setPageSize('detailed', 10);
  second.setMode('compact');
  second.setPageSize('compact', 50);
  first.setPageSize('detailed', 20);
  expect(first.get()).toEqual({ mode: 'detailed', pageSizes: { detailed: 20, compact: 15 } });
  expect(second.get()).toEqual({ mode: 'compact', pageSizes: { detailed: 5, compact: 50 } });
  expect(getBlogReadingPreference(f.newTab()).get()).toEqual({
    mode: 'compact',
    pageSizes: { detailed: 20, compact: 50 },
  });
  expect(Object.fromEntries(f.saved)).toEqual({
    [keys.mode]: 'compact',
    [keys.detailed]: '20',
    [keys.compact]: '50',
  });
});

test('a failed persistent write does not prevent this tab from restoring its choice', () => {
  const f = fixture({ [keys.detailed]: '5' });
  const store = getBlogReadingPreference(f.window);
  f.localStorage.setItem.mockImplementation(() => {
    throw new Error('denied');
  });
  store.setMode('compact');
  store.setPageSize('compact', 100);
  expect(getBlogReadingPreference(f.reload()).get()).toEqual({
    mode: 'compact',
    pageSizes: { detailed: 5, compact: 100 },
  });
  expect(getBlogReadingPreference(f.newTab()).get()).toEqual({
    mode: 'detailed',
    pageSizes: { detailed: 5, compact: 15 },
  });
});

test('unavailable tab storage preserves the live choice and still saves future defaults', () => {
  const f = fixture();
  Object.defineProperty(f.window, 'sessionStorage', {
    get() {
      throw new Error('denied');
    },
  });
  const store = getBlogReadingPreference(f.window);
  store.setPageSize('detailed', 10);
  expect(f.saved.get(keys.detailed)).toBe('10');
  f.external(keys.detailed, '50');
  expect(store.get().pageSizes.detailed).toBe(10);
  expect(getBlogReadingPreference(f.newTab()).get().pageSizes.detailed).toBe(50);
});

test('invalid saved values use mode defaults without rewriting the persistent record', () => {
  const f = fixture({ [keys.mode]: 'unknown', [keys.detailed]: '100', [keys.compact]: '20' });
  expect(getBlogReadingPreference(f.window).get()).toEqual({
    mode: 'detailed',
    pageSizes: { detailed: 5, compact: 15 },
  });
  expect(f.localStorage.setItem).not.toHaveBeenCalled();
});

test('denied access to both storage areas retains choices in memory', () => {
  const f = fixture();
  for (const area of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(f.window, area, {
      get() {
        throw new Error('denied');
      },
    });
  }
  const store = getBlogReadingPreference(f.window);
  expect(store.get()).toEqual({ mode: 'detailed', pageSizes: { detailed: 5, compact: 15 } });
  store.setMode('compact');
  store.setPageSize('compact', 100);
  restoreFromCache(f.window);
  expect(getBlogReadingPreference(f.window).get()).toEqual({
    mode: 'compact',
    pageSizes: { detailed: 5, compact: 100 },
  });
});
