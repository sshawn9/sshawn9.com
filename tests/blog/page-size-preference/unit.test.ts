import { expect, test, vi } from 'vitest';
import {
  BLOG_PAGE_SIZE_STORAGE_KEY,
  getBlogPageSizePreference,
} from '../../../apps/site/src/features/blog/runtime/blog-page-size-preference';

function fixture(initial?: string) {
  let saved = initial ?? null;
  const localStorage = {
    getItem: vi.fn(() => saved),
    setItem: vi.fn((_key: string, value: string) => {
      saved = value;
    }),
  };
  const window = Object.assign(new EventTarget(), { localStorage });
  return {
    window: window as unknown as Window,
    localStorage,
    stored: () => saved,
    external(value: string | null) {
      saved = value;
      const event = new Event('storage');
      Object.assign(event, { key: BLOG_PAGE_SIZE_STORAGE_KEY, storageArea: localStorage });
      window.dispatchEvent(event);
    },
  };
}

test('one preference owner survives page subscriptions and only confirmed changes write storage', () => {
  const f = fixture('10');
  const store = getBlogPageSizePreference(f.window);
  expect(store).toBe(getBlogPageSizePreference(f.window));
  expect(store.get()).toBe(10);
  expect(f.localStorage.setItem).not.toHaveBeenCalled();
  const listeners = new AbortController();
  const changed = vi.fn();
  store.subscribe(changed, listeners.signal);
  store.set(20);
  expect(changed).toHaveBeenCalledExactlyOnceWith(20);
  expect(f.stored()).toBe('20');
  listeners.abort();
  store.set(50);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(getBlogPageSizePreference(f.window).get()).toBe(50);
});

test('cross-tab changes and storage deletion update readers without writing the value back', () => {
  const f = fixture('10');
  const store = getBlogPageSizePreference(f.window);
  const changed = vi.fn();
  const listeners = new AbortController();
  store.subscribe(changed, listeners.signal);
  f.external('50');
  expect(store.get()).toBe(50);
  f.external(null);
  expect(store.get()).toBe(5);
  expect(changed.mock.calls).toEqual([[50], [5]]);
  expect(f.localStorage.setItem).not.toHaveBeenCalled();
  listeners.abort();
});

test('denied persistence preserves the in-memory choice through later reads and page mounts', () => {
  const f = fixture('5');
  const store = getBlogPageSizePreference(f.window);
  f.localStorage.setItem.mockImplementation(() => {
    throw new Error('denied');
  });
  store.set(10);
  expect(store.get()).toBe(10);
  const listeners = new AbortController();
  store.subscribe(vi.fn(), listeners.signal);
  f.window.dispatchEvent(new Event('pageshow'));
  expect(store.get()).toBe(10);
  listeners.abort();
  expect(getBlogPageSizePreference(f.window).get()).toBe(10);
});

test('denied reads and corrupt values use the default', () => {
  const f = fixture('8');
  expect(getBlogPageSizePreference(f.window).get()).toBe(5);
  const denied = fixture();
  denied.localStorage.getItem.mockImplementation(() => {
    throw new Error('denied');
  });
  expect(getBlogPageSizePreference(denied.window).get()).toBe(5);
});
