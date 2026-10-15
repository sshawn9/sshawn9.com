import { abortable, abortError } from './abort.js';
import { prepareBrowserImage, downloadBrowserWallpaper } from './wallpaper-browser.js';
import { isItem, isSnapshot } from './wallpaper-types.js';
import type {
  CachedWallpaper,
  PreparedWallpaper,
  WallpaperController,
  WallpaperOptions,
  WallpaperSnapshot,
  WallpaperState,
} from './wallpaper-types.js';
export type * from './wallpaper-types.js';
export {
  prepareBrowserImage,
  downloadBrowserWallpaper,
  createDomWallpaperView,
} from './wallpaper-browser.js';
export { createIndexedDbWallpaperCache } from './wallpaper-cache.js';

class ImageLoadError extends Error {}

export function createWallpaperController(options: WallpaperOptions): WallpaperController {
  let state: WallpaperState = {
    initialized: false,
    enabled: false,
    busy: false,
    autoRotate: false,
    currentId: null,
    error: null,
  };
  let current: CachedWallpaper | null = null;
  let next: CachedWallpaper | null = null;
  let generation = 0;
  let pending: Promise<boolean> | null = null;
  let initializing: Promise<void> | null = null;
  let prefetching: Promise<boolean> | null = null;
  let rotation: ReturnType<typeof setTimeout> | undefined;
  let persistence: Promise<void> = Promise.resolve();
  const tasks = new Set<AbortController>();
  const subscribers = new Set<(state: WallpaperState) => void>();
  const prepareImage = options.prepareImage ?? prepareBrowserImage;
  const emit = () => {
    for (const callback of subscribers) callback({ ...state });
  };
  const active = (epoch: number) => generation === epoch && state.initialized && state.enabled;
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
  function task<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    tasks.add(controller);
    const timeout = setTimeout(
      () => controller.abort(new Error('Wallpaper preparation timed out')),
      Math.max(1, options.timeoutMs ?? 15000),
    );
    return abortable(
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return work(controller.signal);
      }),
      controller.signal,
    ).finally(() => {
      clearTimeout(timeout);
      tasks.delete(controller);
    });
  }
  async function image(
    value: CachedWallpaper | { item: CachedWallpaper['item'] },
    signal: AbortSignal,
  ): Promise<PreparedWallpaper> {
    signal.throwIfAborted();
    const loaded = await abortable(
      prepareImage(value.item, signal, 'blob' in value ? value.blob : undefined).then((result) => {
        if (signal.aborted) {
          result.release();
          throw signal.reason ?? abortError();
        }
        return result;
      }),
      signal,
    ).catch((error) => {
      signal.throwIfAborted();
      throw new ImageLoadError(message(error));
    });
    return loaded;
  }
  async function ready(
    value: CachedWallpaper | { item: CachedWallpaper['item'] },
    signal: AbortSignal,
  ): Promise<PreparedWallpaper> {
    const loaded = await image(value, signal);
    try {
      await abortable(
        Promise.resolve().then(() => {
          signal.throwIfAborted();
          return options.fontsReady(value.item, signal);
        }),
        signal,
      );
      signal.throwIfAborted();
      return loaded;
    } catch (error) {
      loaded.release();
      throw error;
    }
  }
  async function source(signal: AbortSignal) {
    signal.throwIfAborted();
    const item = await abortable(
      options.source({ currentId: current?.item.id ?? null, signal }),
      signal,
    );
    if (item !== null && !isItem(item)) throw new Error('Invalid wallpaper source item');
    return item;
  }
  function save(epoch: number): Promise<void> {
    if (!options.cache) return Promise.resolve();
    const snapshot: WallpaperSnapshot = { version: 1, current, next };
    const queued = persistence
      .catch(() => {})
      .then(async () => {
        if (!active(epoch)) return;
        await task((signal) => options.cache!.write(snapshot, signal));
      });
    persistence = queued.catch(() => {});
    return queued;
  }
  function schedule() {
    clearTimeout(rotation);
    rotation = undefined;
    if (!state.initialized || !state.enabled || !state.autoRotate || state.busy) return;
    rotation = setTimeout(
      () => {
        rotation = undefined;
        void controller.next();
      },
      Math.max(100, options.rotationMs ?? 60000),
    );
  }
  function prefetch(): Promise<boolean> {
    if (next || !state.initialized || !state.enabled) return Promise.resolve(Boolean(next));
    if (prefetching) return prefetching;
    const epoch = generation;
    const p = task(async (signal) => {
      const item = await source(signal);
      if (!item || item.id === current?.item.id) return false;
      const loaded = await image({ item }, signal);
      try {
        if (!active(epoch)) return false;
        next = { item: loaded.item, blob: loaded.blob };
        await save(epoch);
        return true;
      } finally {
        loaded.release();
      }
    })
      .catch((error) => {
        if (active(epoch)) {
          state.error = 'Next image: ' + message(error);
          emit();
        }
        return false;
      })
      .finally(() => {
        if (prefetching === p) prefetching = null;
      });
    prefetching = p;
    return p;
  }
  function begin(restore: boolean): Promise<boolean> {
    if (!state.initialized || !state.enabled) return Promise.resolve(false);
    if (pending) return pending;
    const epoch = generation;
    let committed = false;
    clearTimeout(rotation);
    state.busy = true;
    state.error = null;
    emit();
    const p = task(async (signal) => {
      let candidate: CachedWallpaper | null = null;
      let restored = false;
      if (restore && options.cache) {
        try {
          const value = await abortable(options.cache.read(signal), signal);
          signal.throwIfAborted();
          if (value !== null && value !== undefined && !isSnapshot(value)) {
            await abortable(options.cache.clear(signal), signal);
          } else if (isSnapshot(value)) {
            candidate = value.current;
            next = value.next?.item.id === value.current?.item.id ? null : value.next;
            restored = Boolean(candidate);
          }
        } catch (error) {
          signal.throwIfAborted();
          state.error = 'Cache recovery: ' + message(error);
        }
      }
      if (!candidate && !restore && prefetching) {
        const successful = await abortable(prefetching, signal);
        if (!successful && !next) return false;
      }
      candidate ??= next;
      let prepared: PreparedWallpaper | null = null;
      if (candidate && restored) {
        // Corrupt cached image bytes recover once; font failure never selects a replacement.
        try {
          prepared = await image(candidate, signal);
        } catch (error) {
          signal.throwIfAborted();
          candidate = null;
          next = null;
          restored = false;
          try {
            await options.cache?.clear(signal);
          } catch {
            /* A fresh load can still recover. */
          }
        }
        if (prepared) {
          try {
            signal.throwIfAborted();
            await abortable(options.fontsReady(prepared.item, signal), signal);
          } catch (error) {
            prepared.release();
            throw error;
          }
        }
      }
      if (!prepared) {
        const item = candidate?.item ?? (await source(signal));
        if (!item) return false;
        prepared = await ready(candidate ?? { item }, signal);
      }
      if (!active(epoch) || signal.aborted) {
        prepared.release();
        return false;
      }
      if (prepared.item.id === current?.item.id) {
        prepared.release();
        return false;
      }
      try {
        options.view.commit(prepared, { animate: !restored && current !== null });
      } catch (error) {
        prepared.release();
        throw error;
      }
      current = { item: prepared.item, blob: prepared.blob };
      committed = true;
      if (next?.item.id === current.item.id) next = null;
      state.currentId = current.item.id;
      state.error = null;
      emit();
      try {
        await save(epoch);
      } catch (error) {
        if (active(epoch)) {
          state.error = 'Cache persistence: ' + message(error);
          emit();
        }
      }
      return true;
    })
      .catch((error) => {
        if (active(epoch)) {
          if (error instanceof ImageLoadError) {
            next = null;
            void save(epoch).catch(() => {});
          }
          state.error = (committed ? 'Cache persistence: ' : '') + message(error);
          emit();
        }
        // The display commit is irreversible. A later cache timeout cannot turn
        // an already-visible, fully prepared change into a reported failure.
        return committed;
      })
      .finally(() => {
        if (pending === p) {
          pending = null;
          state.busy = false;
          emit();
          schedule();
          if (committed && active(epoch) && current && !next) void prefetch();
        }
      });
    pending = p;
    return p;
  }
  const controller: WallpaperController = {
    init(initial = {}) {
      if (state.initialized) return initializing ?? Promise.resolve();
      generation++;
      state = {
        initialized: true,
        enabled: initial.enabled ?? true,
        autoRotate: initial.autoRotate ?? false,
        busy: false,
        currentId: null,
        error: null,
      };
      options.view.setEnabled(state.enabled);
      emit();
      const p = (state.enabled ? begin(true).then(() => {}) : Promise.resolve()).finally(() => {
        if (initializing === p) initializing = null;
      });
      initializing = p;
      return p;
    },
    next: () => begin(false),
    async setEnabled(enabled) {
      if (!state.initialized) throw new Error('Initialize wallpaper first');
      if (state.enabled === enabled) return;
      if (!enabled) {
        const autoRotate = state.autoRotate;
        controller.cancel();
        state.autoRotate = autoRotate;
        state.enabled = false;
        options.view.setEnabled(false);
        emit();
      } else {
        state.enabled = true;
        options.view.setEnabled(true);
        emit();
        if (current) {
          schedule();
          if (!next) void prefetch();
        } else await begin(true);
      }
    },
    setAutoRotate(enabled) {
      if (!state.initialized) throw new Error('Initialize wallpaper first');
      state.autoRotate = enabled;
      schedule();
      emit();
    },
    cancel() {
      generation++;
      clearTimeout(rotation);
      rotation = undefined;
      for (const controller of tasks) controller.abort(abortError());
      tasks.clear();
      pending = null;
      prefetching = null;
      initializing = null;
      state.busy = false;
      state.autoRotate = false;
      emit();
    },
    destroy() {
      if (!state.initialized) return;
      controller.cancel();
      options.view.clear();
      options.view.setEnabled(false);
      current = next = null;
      state = {
        initialized: false,
        enabled: false,
        busy: false,
        autoRotate: false,
        currentId: null,
        error: null,
      };
      emit();
    },
    async download() {
      if (!state.initialized || !current) throw new Error('No current wallpaper to download');
      await (options.download ?? downloadBrowserWallpaper)(current);
    },
    getState: () => ({ ...state }),
    subscribe(callback) {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
  };
  return controller;
}
