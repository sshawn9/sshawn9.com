import {
  readBlogDisplayMode,
  readBlogPageSize,
  type BlogDisplayMode,
  type BlogPageSize,
  type BlogReadingSettings,
} from './blog-state';

export const BLOG_READING_STORAGE_KEYS = {
  mode: 'blog-display-mode',
  detailed: 'blog-page-size',
  compact: 'blog-compact-page-size',
} as const;
const ownerKey = Symbol.for('sshawn9.blog-reading-preference');

type StorageArea = 'sessionStorage' | 'localStorage';

export type BlogReadingPreference = {
  get(): BlogReadingSettings;
  setMode(mode: BlogDisplayMode): void;
  setPageSize(mode: BlogDisplayMode, value: BlogPageSize): void;
  subscribe(listener: (value: BlogReadingSettings) => void, signal: AbortSignal): void;
};

/** This tab owns its settings; persistent preferences only supply missing initial values. */
export function getBlogReadingPreference(sourceWindow: Window): BlogReadingPreference {
  const owner = sourceWindow as Window & { [ownerKey]?: BlogReadingPreference };
  if (owner[ownerKey]) return owner[ownerKey];
  const read = (area: StorageArea, key: string): string | undefined => {
    try {
      return sourceWindow[area].getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  };
  const write = (area: StorageArea, key: string, next: string) => {
    try {
      sourceWindow[area].setItem(key, next);
    } catch {
      // The live tab must remain usable even when either storage area is unavailable.
    }
  };
  const initial = (key: string) => read('sessionStorage', key) ?? read('localStorage', key);
  let value: BlogReadingSettings = {
    mode: readBlogDisplayMode(initial(BLOG_READING_STORAGE_KEYS.mode)),
    pageSizes: {
      detailed: readBlogPageSize(initial(BLOG_READING_STORAGE_KEYS.detailed), 'detailed'),
      compact: readBlogPageSize(initial(BLOG_READING_STORAGE_KEYS.compact), 'compact'),
    },
  };
  // Save every initial field privately, including untouched defaults, so a reload
  // cannot adopt changes made by another tab. Initialization never writes shared defaults.
  write('sessionStorage', BLOG_READING_STORAGE_KEYS.mode, value.mode);
  write('sessionStorage', BLOG_READING_STORAGE_KEYS.detailed, String(value.pageSizes.detailed));
  write('sessionStorage', BLOG_READING_STORAGE_KEYS.compact, String(value.pageSizes.compact));

  const subscribers = new Set<(value: BlogReadingSettings) => void>();
  const publish = (next: BlogReadingSettings) => {
    if (
      next.mode === value.mode &&
      next.pageSizes.detailed === value.pageSizes.detailed &&
      next.pageSizes.compact === value.pageSizes.compact
    )
      return;
    value = next;
    for (const listener of subscribers) listener(next);
  };
  const saveChoice = (key: string, next: string) => {
    write('sessionStorage', key, next);
    // Only the explicitly chosen field becomes a default for future tabs.
    write('localStorage', key, next);
  };
  const preference: BlogReadingPreference = {
    get: () => value,
    setMode(mode) {
      saveChoice(BLOG_READING_STORAGE_KEYS.mode, mode);
      publish({ ...value, mode });
    },
    setPageSize(mode, requested) {
      const pageSize = readBlogPageSize(String(requested), mode);
      saveChoice(BLOG_READING_STORAGE_KEYS[mode], String(pageSize));
      publish({ ...value, pageSizes: { ...value.pageSizes, [mode]: pageSize } });
    },
    subscribe(listener, signal) {
      if (signal.aborted) return;
      subscribers.add(listener);
      signal.addEventListener('abort', () => subscribers.delete(listener), { once: true });
    },
  };
  // Cached documents retain their owner, but a newer document in this same tab
  // may have changed its session record. This listener follows the Window lifetime,
  // including restores where no blog page is currently mounted.
  sourceWindow.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    publish({
      mode: readBlogDisplayMode(
        read('sessionStorage', BLOG_READING_STORAGE_KEYS.mode) ?? value.mode,
      ),
      pageSizes: {
        detailed: readBlogPageSize(
          read('sessionStorage', BLOG_READING_STORAGE_KEYS.detailed) ??
            String(value.pageSizes.detailed),
          'detailed',
        ),
        compact: readBlogPageSize(
          read('sessionStorage', BLOG_READING_STORAGE_KEYS.compact) ??
            String(value.pageSizes.compact),
          'compact',
        ),
      },
    });
  });
  owner[ownerKey] = preference;
  return preference;
}
