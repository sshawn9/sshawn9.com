import { abortable } from './abort.js';
import type {
  CachedWallpaper,
  PreparedWallpaper,
  WallpaperItem,
  WallpaperView,
} from './wallpaper-types.js';

export async function prepareBrowserImage(
  item: WallpaperItem,
  signal: AbortSignal,
  cachedBlob?: Blob,
): Promise<PreparedWallpaper> {
  signal.throwIfAborted();
  const blob =
    cachedBlob ??
    (await (async () => {
      const response = await fetch(item.url, { signal, credentials: 'omit' });
      if (!response.ok) throw new Error('Image request failed: ' + response.status);
      return response.blob();
    })());
  signal.throwIfAborted();
  if (!blob.size || !blob.type.startsWith('image/')) throw new Error('Invalid image resource');
  const url = URL.createObjectURL(blob);
  const image = new Image();
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      image.src = '';
      URL.revokeObjectURL(url);
    }
  };
  image.decoding = 'async';
  image.src = url;
  try {
    await abortable(image.decode(), signal);
    signal.throwIfAborted();
    if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0)
      throw new Error('Image did not decode');
    return { item, blob, image, release };
  } catch (error) {
    release();
    throw error;
  }
}

export function downloadBrowserWallpaper(current: CachedWallpaper): void {
  const url = URL.createObjectURL(current.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = current.item.filename ?? current.item.id + '.image';
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  queueMicrotask(() => URL.revokeObjectURL(url));
}

export function createDomWallpaperView(
  container: HTMLElement,
  options: { transitionMs?: number; reducedMotion?: () => boolean } = {},
): WallpaperView {
  type Layer = {
    element: HTMLElement;
    prepared: PreparedWallpaper;
    animation?: Animation;
    removed: boolean;
  };
  const layers = new Set<Layer>();
  let current: Layer | undefined;
  container.classList.add('appearance-wallpaper');
  const remove = (layer: Layer) => {
    if (layer.removed) return;
    layer.removed = true;
    layers.delete(layer);
    layer.animation?.cancel();
    layer.element.remove();
    layer.prepared.release();
  };
  return {
    commit(prepared, { animate }) {
      if (!prepared.image || !prepared.image.complete || prepared.image.naturalWidth <= 0)
        throw new Error('The DOM view requires a decoded image');
      const doc = container.ownerDocument;
      const element = doc.createElement('figure');
      element.className = 'appearance-wallpaper-pair';
      element.dataset.wallpaperId = prepared.item.id;
      const picture = prepared.image;
      picture.alt = '';
      picture.className = 'appearance-wallpaper-image';
      const caption = doc.createElement('figcaption');
      caption.className = 'appearance-wallpaper-credit';
      caption.dataset.wallpaperId = prepared.item.id;
      if (prepared.item.creditUrl && /^https?:\/\//.test(prepared.item.creditUrl)) {
        const link = doc.createElement('a');
        link.textContent = prepared.item.credit;
        link.href = prepared.item.creditUrl;
        link.rel = 'noopener noreferrer';
        caption.append(link);
      } else caption.textContent = prepared.item.credit;
      element.append(picture, caption);
      const previous = current;
      // A repeated advance starts from a fully visible committed pair, rather
      // than removing the older layer while its replacement is half faded.
      if (previous?.animation?.playState === 'running') previous.animation.finish();
      for (const layer of [...layers]) if (layer !== previous) remove(layer);
      const layer: Layer = { element, prepared, removed: false };
      layers.add(layer);
      current = layer;
      container.append(element);
      const reduced =
        options.reducedMotion?.() ??
        container.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)')
          .matches ??
        false;
      if (
        previous &&
        animate &&
        !reduced &&
        (options.transitionMs ?? 280) > 0 &&
        typeof element.animate === 'function'
      ) {
        layer.animation = element.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: options.transitionMs ?? 280,
          easing: 'ease-out',
        });
        void layer.animation.finished.catch(() => {}).then(() => remove(previous));
      } else if (previous) remove(previous);
    },
    setEnabled(enabled) {
      container.hidden = !enabled;
      if (!enabled) {
        for (const layer of [...layers]) if (layer !== current) remove(layer);
        current?.animation?.cancel();
      }
    },
    clear() {
      for (const layer of [...layers]) remove(layer);
      current = undefined;
    },
  };
}
