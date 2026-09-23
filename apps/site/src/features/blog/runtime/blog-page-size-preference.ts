import { readBlogPageSize, type BlogPageSize } from './blog-state';

export const BLOG_PAGE_SIZE_STORAGE_KEY = 'blog-page-size';
const ownerKey = Symbol.for('sshawn9.blog-page-size-preference');

export type BlogPageSizePreference = {
  get(): BlogPageSize;
  set(value: BlogPageSize): void;
  subscribe(listener: (value: BlogPageSize) => void, signal: AbortSignal): void;
};

/** Shared by the early script and the main bundle for the lifetime of this Window. */
export function getBlogPageSizePreference(sourceWindow: Window): BlogPageSizePreference {
  const owner = sourceWindow as Window & { [ownerKey]?: BlogPageSizePreference };
  if (owner[ownerKey]) return owner[ownerKey];
  let value = readBlogPageSize(undefined);
  let unsaved = false;
  let events: AbortController | undefined;
  const subscribers = new Set<(value: BlogPageSize) => void>();
  const publish = (next: BlogPageSize) => {
    if (next === value) return;
    value = next;
    for (const listener of subscribers) listener(next);
  };
  const refresh = () => {
    if (unsaved) return;
    try {
      publish(
        readBlogPageSize(
          sourceWindow.localStorage.getItem(BLOG_PAGE_SIZE_STORAGE_KEY) ?? undefined,
        ),
      );
    } catch {
      // Reading preferences must not prevent rendering the static document.
    }
  };
  const preference: BlogPageSizePreference = {
    get() {
      if (!subscribers.size) refresh();
      return value;
    },
    set(next) {
      try {
        sourceWindow.localStorage.setItem(BLOG_PAGE_SIZE_STORAGE_KEY, String(next));
        unsaved = false;
      } catch {
        unsaved = true;
      }
      publish(next);
    },
    subscribe(listener, signal) {
      if (signal.aborted) return;
      refresh();
      subscribers.add(listener);
      if (!events) {
        events = new AbortController();
        sourceWindow.addEventListener(
          'storage',
          (event) => {
            if (event.key !== null && event.key !== BLOG_PAGE_SIZE_STORAGE_KEY) return;
            try {
              if (event.storageArea !== sourceWindow.localStorage) return;
            } catch {
              return;
            }
            unsaved = false;
            refresh();
          },
          { signal: events.signal },
        );
        sourceWindow.addEventListener('pageshow', refresh, { signal: events.signal });
      }
      signal.addEventListener(
        'abort',
        () => {
          subscribers.delete(listener);
          if (!subscribers.size) {
            events?.abort();
            events = undefined;
          }
        },
        { once: true },
      );
    },
  };
  refresh();
  owner[ownerKey] = preference;
  return preference;
}
