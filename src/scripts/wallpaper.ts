import {
  SITE_STORAGE_KEYS,
  isStoredWallpaperBackground,
  type StoredWallpaperBackground,
} from '../lib/site-preferences';
import {
  WALLPAPER_DOWNLOAD_ENDPOINT,
  WALLPAPER_ENDPOINT,
  isWallpaperManifest,
  type WallpaperManifest,
  type WallpaperPhoto,
} from '../lib/wallpaper';
import { $wallpaper } from '../stores/site-state';
import { claimClientRuntime } from './client-runtime';

const MIN_ROTATION_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ROTATION_INTERVAL_MS = 9 * 60 * 1000;
const MANIFEST_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const MANIFEST_RETRY_INTERVAL_MS = 30 * 1000;
const IMAGE_WIDTHS = [960, 1600, 2400] as const;
const DOWNLOAD_WIDTH = 2400;
const POSTER_WIDTH = 1600;
const MAX_POSTER_BYTES = 2_500_000;
const TRANSITION_MS = 1400;

export type WallpaperElements = {
  media: HTMLElement;
  images: [HTMLImageElement, HTMLImageElement];
};

type WallpaperController = {
  refresh: () => Promise<void>;
  download: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setAutoRotation: (enabled: boolean) => void;
  dispose: () => void;
};

let cachedManifest: WallpaperManifest | undefined;
let manifestPromise: Promise<WallpaperManifest | undefined> | undefined;
let manifestLastRequestedAt = 0;
let activeController: WallpaperController | undefined;
const posterTasks = new Map<string, Promise<void>>();

export const wallpaperActions = {
  refresh: () => activeController?.refresh() ?? Promise.resolve(),
  download: () => activeController?.download() ?? Promise.resolve(),
  setEnabled: (enabled: boolean) => activeController?.setEnabled(enabled) ?? Promise.resolve(),
  setAutoRotation: (enabled: boolean) => activeController?.setAutoRotation(enabled),
};

function nextRotationDelay() {
  return (
    MIN_ROTATION_INTERVAL_MS + Math.random() * (MAX_ROTATION_INTERVAL_MS - MIN_ROTATION_INTERVAL_MS)
  );
}

function imageUrl(rawUrl: string, width: number) {
  const url = new URL(rawUrl);
  url.searchParams.set('auto', 'format');
  url.searchParams.set('fit', 'max');
  url.searchParams.set('q', '80');
  url.searchParams.set('w', String(width));
  return url.toString();
}

function downloadImageUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  url.searchParams.delete('auto');
  url.searchParams.set('fit', 'max');
  url.searchParams.set('fm', 'jpg');
  url.searchParams.set('q', '90');
  url.searchParams.set('w', String(DOWNLOAD_WIDTH));
  return url.toString();
}

function configureImage(image: HTMLImageElement, photo: WallpaperPhoto) {
  image.srcset = IMAGE_WIDTHS.map((width) => `${imageUrl(photo.rawUrl, width)} ${width}w`).join(
    ', ',
  );
  image.sizes = '100vw';
  image.src = imageUrl(photo.rawUrl, IMAGE_WIDTHS[1]);
}

async function decodeImage(image: HTMLImageElement, signal: AbortSignal) {
  if (image.complete && image.naturalWidth > 0) return !signal.aborted;

  try {
    await image.decode();
  } catch {
    if (!image.complete || image.naturalWidth === 0) return false;
  }
  return !signal.aborted && image.naturalWidth > 0;
}

async function loadImage(image: HTMLImageElement, photo: WallpaperPhoto, signal: AbortSignal) {
  image.removeAttribute('src');
  image.removeAttribute('srcset');
  configureImage(image, photo);
  return decodeImage(image, signal);
}

async function loadManifest(revalidate = false) {
  if (manifestPromise) return manifestPromise;
  if (!revalidate && cachedManifest) return cachedManifest;

  manifestLastRequestedAt = Date.now();
  manifestPromise = fetch(WALLPAPER_ENDPOINT, {
    cache: revalidate ? 'no-cache' : 'default',
    headers: { Accept: 'application/json' },
  })
    .then(async (response) => {
      if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) {
        return undefined;
      }
      const value: unknown = await response.json();
      return isWallpaperManifest(value) ? value : undefined;
    })
    .then((manifest) => {
      if (manifest) cachedManifest = manifest;
      return manifest;
    })
    .catch(() => undefined)
    .finally(() => {
      manifestPromise = undefined;
    });
  return manifestPromise;
}

function setWallpaperMode(target: Document, enabled: boolean) {
  target.documentElement.dataset.wallpaperMode = enabled ? 'scenic' : 'default';
}

function storeAutoRotation(enabled: boolean) {
  localStorage.setItem(SITE_STORAGE_KEYS.wallpaperAutoRotation, String(enabled));
  localStorage.removeItem(SITE_STORAGE_KEYS.wallpaperLegacyRotation);
}

function findStoredPhoto(photos: WallpaperPhoto[], autoRotation: boolean) {
  if (!autoRotation) {
    const fixedId = localStorage.getItem(SITE_STORAGE_KEYS.wallpaperFixedPhoto);
    const fixedPhoto = photos.find((photo) => photo.id === fixedId);
    if (fixedPhoto) return fixedPhoto;
  }

  const storedId = sessionStorage.getItem(SITE_STORAGE_KEYS.wallpaperPhotoId);
  return photos.find((photo) => photo.id === storedId);
}

function readStoredCurrentPhoto() {
  const storedValue = sessionStorage.getItem(SITE_STORAGE_KEYS.wallpaperCurrentPhoto);
  if (!storedValue) return undefined;

  try {
    const candidate = {
      version: 2 as const,
      updatedAt: 'stored',
      photos: [JSON.parse(storedValue) as unknown],
    };
    return isWallpaperManifest(candidate) ? candidate.photos[0] : undefined;
  } catch {
    return undefined;
  }
}

function storeCurrentPhoto(photo: WallpaperPhoto) {
  sessionStorage.setItem(SITE_STORAGE_KEYS.wallpaperCurrentPhoto, JSON.stringify(photo));
}

function readStoredBackground(photoId: string) {
  const storedValue = sessionStorage.getItem(SITE_STORAGE_KEYS.wallpaperCurrentBackground);
  if (!storedValue) return undefined;

  try {
    const value: unknown = JSON.parse(storedValue);
    return isStoredWallpaperBackground(value) && value.photoId === photoId ? value : undefined;
  } catch {
    return undefined;
  }
}

function storeBackground(background: StoredWallpaperBackground) {
  try {
    sessionStorage.setItem(
      SITE_STORAGE_KEYS.wallpaperCurrentBackground,
      JSON.stringify(background),
    );
    return true;
  } catch {
    return false;
  }
}

function applyBackground(target: Document, background: StoredWallpaperBackground) {
  const root = target.documentElement;
  root.dataset.wallpaperBackground = background.photoId;
  root.dataset.wallpaperBackgroundKind = background.kind;
  root.style.setProperty('--wallpaper-boot-image', `url(${JSON.stringify(background.url)})`);
}

function createRemoteBackground(
  photo: WallpaperPhoto,
  url = imageUrl(photo.rawUrl, POSTER_WIDTH),
): StoredWallpaperBackground {
  return { photoId: photo.id, kind: 'remote', url };
}

function restoreBackground(photo: WallpaperPhoto) {
  const background = readStoredBackground(photo.id) ?? createRemoteBackground(photo);
  storeBackground(background);
  applyBackground(document, background);
  return background;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () =>
      typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error()),
    );
    reader.addEventListener('error', () => reject(reader.error ?? new Error()));
    reader.readAsDataURL(blob);
  });
}

function cacheBackgroundPoster(
  photo: WallpaperPhoto,
  sourceUrl = imageUrl(photo.rawUrl, POSTER_WIDTH),
) {
  if (readStoredBackground(photo.id)?.kind === 'poster' || posterTasks.has(photo.id)) return;

  const posterSourceUrl = sourceUrl.startsWith('https://')
    ? sourceUrl
    : imageUrl(photo.rawUrl, POSTER_WIDTH);
  const fallbackUrl = imageUrl(photo.rawUrl, POSTER_WIDTH);
  const task = (async () => {
    let response = await fetch(posterSourceUrl, { cache: 'force-cache' });
    if (!response.ok) return;
    let blob = await response.blob();
    if (blob.size > MAX_POSTER_BYTES && posterSourceUrl !== fallbackUrl) {
      response = await fetch(fallbackUrl, { cache: 'force-cache' });
      if (!response.ok) return;
      blob = await response.blob();
    }
    if (!blob.type.startsWith('image/') || blob.size > MAX_POSTER_BYTES) return;
    if (readStoredCurrentPhoto()?.id !== photo.id) return;
    const url = await blobToDataUrl(blob);
    if (readStoredCurrentPhoto()?.id !== photo.id) return;
    const background: StoredWallpaperBackground = { photoId: photo.id, kind: 'poster', url };
    if (storeBackground(background)) applyBackground(document, background);
  })()
    .catch(() => undefined)
    .finally(() => posterTasks.delete(photo.id));
  posterTasks.set(photo.id, task);
}

function shufflePhotos(photos: WallpaperPhoto[]) {
  const shuffled = [...photos];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

function readStoredPhotoQueue(photos: WallpaperPhoto[], excludedId?: string) {
  const storedValue = sessionStorage.getItem(SITE_STORAGE_KEYS.wallpaperPhotoQueue);
  if (!storedValue) return [];

  try {
    const storedIds: unknown = JSON.parse(storedValue);
    if (!Array.isArray(storedIds)) return [];

    const photosById = new Map(photos.map((photo) => [photo.id, photo]));
    const seenIds = new Set<string>();
    return storedIds.flatMap((id) => {
      if (typeof id !== 'string' || id === excludedId || seenIds.has(id)) return [];
      const photo = photosById.get(id);
      if (!photo) return [];
      seenIds.add(id);
      return [photo];
    });
  } catch {
    return [];
  }
}

function storePhotoQueue(photos: WallpaperPhoto[]) {
  sessionStorage.setItem(
    SITE_STORAGE_KEYS.wallpaperPhotoQueue,
    JSON.stringify(photos.map((photo) => photo.id)),
  );
}

function reportDownload(photoId: string) {
  void fetch(WALLPAPER_DOWNLOAD_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoId }),
    keepalive: true,
  }).catch(() => undefined);
}

async function saveWallpaperPhoto(photo: WallpaperPhoto, signal: AbortSignal) {
  const response = await fetch(downloadImageUrl(photo.rawUrl));
  if (!response.ok) throw new Error(`Wallpaper image download failed: ${response.status}`);

  const blob = await response.blob();
  if (signal.aborted) return false;

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `unsplash-${photo.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.jpg`;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return true;
}

function clearImage(image: HTMLImageElement) {
  image.removeAttribute('src');
  image.removeAttribute('srcset');
  delete image.dataset.wallpaperPhotoId;
}

export function startWallpaperController({ media, images }: WallpaperElements) {
  const runtime = claimClientRuntime('wallpaper');

  const abortController = new AbortController();
  const { signal } = abortController;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const initialState = $wallpaper.get();
  let enabled = initialState.enabled;
  let autoRotation = initialState.autoRotation;
  let manifest: WallpaperManifest | undefined;
  let rotationTimer: number | undefined;
  let manifestRefreshTimer: number | undefined;
  let activeIndex = images.findIndex((image) => image.classList.contains('is-active'));
  let currentPhoto = initialState.currentPhoto ?? readStoredCurrentPhoto();
  let photoQueue: WallpaperPhoto[] = [];
  let ready = false;
  let loading = false;
  let downloading = false;
  let activationRevision = 0;

  setWallpaperMode(document, enabled);
  if (currentPhoto) {
    restoreBackground(currentPhoto);
    ready = true;
  } else {
    document.documentElement.removeAttribute('data-wallpaper-background');
    document.documentElement.removeAttribute('data-wallpaper-background-kind');
    document.documentElement.style.removeProperty('--wallpaper-boot-image');
  }

  const publish = () => {
    $wallpaper.set({
      enabled,
      autoRotation,
      ready,
      canAdvance: manifest?.photos.some((photo) => photo.id !== currentPhoto?.id) ?? false,
      loading,
      downloading,
      currentPhoto,
    });
  };

  const resetPhotoQueue = (excludedIds: ReadonlySet<string>) => {
    photoQueue = shufflePhotos(
      (manifest?.photos ?? []).filter((photo) => !excludedIds.has(photo.id)),
    );
    storePhotoQueue(photoQueue);
  };

  const takeNextPhoto = (excludedIds: ReadonlySet<string>) => {
    while (photoQueue.length > 0) {
      const photo = photoQueue.shift();
      storePhotoQueue(photoQueue);
      if (photo && !excludedIds.has(photo.id)) return photo;
    }

    resetPhotoQueue(excludedIds);
    const photo = photoQueue.shift();
    storePhotoQueue(photoQueue);
    return photo;
  };

  const clearRotationTimer = () => {
    if (rotationTimer !== undefined) window.clearTimeout(rotationTimer);
    rotationTimer = undefined;
  };

  const clearManifestRefreshTimer = () => {
    if (manifestRefreshTimer !== undefined) window.clearTimeout(manifestRefreshTimer);
    manifestRefreshTimer = undefined;
  };

  const activate = async (photo: WallpaperPhoto, revision: number) => {
    const nextIndex = activeIndex === 0 ? 1 : 0;
    const nextImage = images[nextIndex];
    if (!(await loadImage(nextImage, photo, signal))) {
      clearImage(nextImage);
      return false;
    }
    if (signal.aborted || revision !== activationRevision || !enabled) {
      clearImage(nextImage);
      return false;
    }

    const previousImage = activeIndex >= 0 ? images[activeIndex] : undefined;
    nextImage.dataset.wallpaperPhotoId = photo.id;
    nextImage.classList.add('is-active');
    previousImage?.classList.remove('is-active');
    media.dataset.wallpaperReady = photo.id;
    document.documentElement.dataset.wallpaperCompositor = 'ready';
    activeIndex = nextIndex;
    currentPhoto = photo;
    ready = true;
    sessionStorage.setItem(SITE_STORAGE_KEYS.wallpaperPhotoId, photo.id);
    storeCurrentPhoto(photo);
    const currentImageUrl = nextImage.currentSrc || imageUrl(photo.rawUrl, POSTER_WIDTH);
    const background = createRemoteBackground(photo, currentImageUrl);
    storeBackground(background);
    applyBackground(document, background);
    cacheBackgroundPoster(photo, currentImageUrl);
    if (!autoRotation) localStorage.setItem(SITE_STORAGE_KEYS.wallpaperFixedPhoto, photo.id);
    publish();

    if (previousImage) {
      window.setTimeout(() => {
        if (!previousImage.classList.contains('is-active')) clearImage(previousImage);
      }, TRANSITION_MS);
    }
    return true;
  };

  const activateNextAvailable = async (revision: number, attemptedIds: Set<string>) => {
    if (!manifest) return false;

    while (manifest.photos.some((photo) => !attemptedIds.has(photo.id))) {
      const nextPhoto = takeNextPhoto(attemptedIds);
      if (!nextPhoto) return false;
      attemptedIds.add(nextPhoto.id);
      if (await activate(nextPhoto, revision)) return true;
    }
    return false;
  };

  const schedule = () => {
    clearRotationTimer();
    if (
      !enabled ||
      !ready ||
      !autoRotation ||
      reducedMotion.matches ||
      document.hidden ||
      !manifest?.photos.some((photo) => photo.id !== currentPhoto?.id)
    )
      return;
    rotationTimer = window.setTimeout(() => {
      rotationTimer = undefined;
      void advance();
    }, nextRotationDelay());
  };

  const reconcileManifest = (nextManifest: WallpaperManifest) => {
    const previousManifest = manifest;
    manifest = nextManifest;

    const updatedCurrentPhoto = currentPhoto
      ? nextManifest.photos.find((photo) => photo.id === currentPhoto?.id)
      : undefined;
    if (updatedCurrentPhoto) {
      currentPhoto = updatedCurrentPhoto;
      storeCurrentPhoto(updatedCurrentPhoto);
    }

    if (!previousManifest || previousManifest.updatedAt === nextManifest.updatedAt) {
      publish();
      if (rotationTimer === undefined) schedule();
      return;
    }

    const previousIds = new Set(previousManifest.photos.map((photo) => photo.id));
    const nextPhotosById = new Map(nextManifest.photos.map((photo) => [photo.id, photo]));
    const queuedIds = new Set<string>();
    const retainedPhotos = photoQueue.flatMap((photo) => {
      const retainedPhoto = nextPhotosById.get(photo.id);
      if (!retainedPhoto || queuedIds.has(photo.id)) return [];
      queuedIds.add(photo.id);
      return [retainedPhoto];
    });
    const addedPhotos = nextManifest.photos.filter((photo) => {
      if (previousIds.has(photo.id) || queuedIds.has(photo.id)) return false;
      queuedIds.add(photo.id);
      return true;
    });

    photoQueue = shufflePhotos([...retainedPhotos, ...addedPhotos]);
    storePhotoQueue(photoQueue);
    publish();
    if (rotationTimer === undefined) schedule();
  };

  const scheduleManifestRefresh = () => {
    clearManifestRefreshTimer();
    if (signal.aborted || !enabled || document.hidden) return;

    const interval = manifest ? MANIFEST_REFRESH_INTERVAL_MS : MANIFEST_RETRY_INTERVAL_MS;
    const elapsed = Date.now() - manifestLastRequestedAt;
    const delay = Math.max(0, interval - elapsed);
    manifestRefreshTimer = window.setTimeout(() => {
      manifestRefreshTimer = undefined;
      void refreshManifest();
    }, delay);
  };

  const refreshManifest = async () => {
    clearManifestRefreshTimer();
    if (signal.aborted || !enabled || document.hidden) return;

    const nextManifest = await loadManifest(true);
    if (!signal.aborted && enabled && nextManifest) reconcileManifest(nextManifest);
    scheduleManifestRefresh();
  };

  const ensurePhotoBackground = async () => {
    const revision = activationRevision;
    loading = !ready;
    publish();

    manifest ??= await loadManifest();
    if (signal.aborted || revision !== activationRevision || !enabled || !manifest) {
      if (revision === activationRevision) {
        loading = false;
        publish();
        scheduleManifestRefresh();
      }
      return false;
    }

    let initial = currentPhoto ?? findStoredPhoto(manifest.photos, autoRotation);
    if (initial) {
      photoQueue = readStoredPhotoQueue(manifest.photos, initial.id);
      if (photoQueue.length === 0) resetPhotoQueue(new Set([initial.id]));
    } else {
      resetPhotoQueue(new Set());
      initial = takeNextPhoto(new Set());
    }
    if (!initial) {
      loading = false;
      publish();
      return false;
    }

    let activated = true;
    if (currentPhoto?.id === initial.id && document.documentElement.dataset.wallpaperBackground) {
      currentPhoto = initial;
      ready = true;
      sessionStorage.setItem(SITE_STORAGE_KEYS.wallpaperPhotoId, initial.id);
      storeCurrentPhoto(initial);
      if (!autoRotation) localStorage.setItem(SITE_STORAGE_KEYS.wallpaperFixedPhoto, initial.id);
      cacheBackgroundPoster(initial, readStoredBackground(initial.id)?.url);
    } else if (findStoredPhoto([initial], autoRotation)?.id === initial.id) {
      currentPhoto = initial;
      ready = true;
      sessionStorage.setItem(SITE_STORAGE_KEYS.wallpaperPhotoId, initial.id);
      storeCurrentPhoto(initial);
      restoreBackground(initial);
      if (!autoRotation) localStorage.setItem(SITE_STORAGE_KEYS.wallpaperFixedPhoto, initial.id);
      cacheBackgroundPoster(initial, readStoredBackground(initial.id)?.url);
    } else {
      activated = await activate(initial, revision);
      if (!activated) activated = await activateNextAvailable(revision, new Set([initial.id]));
    }

    if (revision === activationRevision) {
      loading = false;
      publish();
      schedule();
      scheduleManifestRefresh();
    }
    return activated;
  };

  const advance = async () => {
    if (
      !enabled ||
      !ready ||
      loading ||
      !currentPhoto ||
      !manifest?.photos.some((photo) => photo.id !== currentPhoto?.id)
    )
      return;

    const revision = activationRevision;
    loading = true;
    publish();
    await activateNextAvailable(revision, new Set([currentPhoto.id]));
    if (revision === activationRevision) {
      loading = false;
      publish();
      schedule();
    }
  };

  const setEnabled = async (nextEnabled: boolean) => {
    if (enabled === nextEnabled) return;

    activationRevision += 1;
    enabled = nextEnabled;
    loading = false;
    localStorage.setItem(SITE_STORAGE_KEYS.wallpaperEnabled, String(enabled));
    setWallpaperMode(document, enabled);

    if (!enabled) {
      clearRotationTimer();
      clearManifestRefreshTimer();
      publish();
      return;
    }

    if (currentPhoto) {
      restoreBackground(currentPhoto);
      ready = true;
    }
    publish();
    await ensurePhotoBackground();
  };

  const setAutoRotation = (nextEnabled: boolean) => {
    if (autoRotation === nextEnabled) return;

    autoRotation = nextEnabled;
    storeAutoRotation(autoRotation);
    if (!autoRotation && currentPhoto) {
      localStorage.setItem(SITE_STORAGE_KEYS.wallpaperFixedPhoto, currentPhoto.id);
    } else {
      localStorage.removeItem(SITE_STORAGE_KEYS.wallpaperFixedPhoto);
    }
    publish();
    schedule();
  };

  const download = async () => {
    if (!enabled || !ready || downloading || !currentPhoto) return;

    const photo = currentPhoto;
    downloading = true;
    publish();
    try {
      if (await saveWallpaperPhoto(photo, signal)) reportDownload(photo.id);
    } catch {
      // A failed download does not disable the wallpaper controls.
    } finally {
      if (!signal.aborted) {
        downloading = false;
        publish();
      }
    }
  };

  const handleVisibility = () => {
    if (!document.hidden && enabled && !manifest) void ensurePhotoBackground();
    schedule();
    scheduleManifestRefresh();
  };
  const handleOnline = () => {
    if (enabled && !manifest) void ensurePhotoBackground();
  };
  const handlePageLoad = () => {
    if (enabled && !manifest && !loading) void ensurePhotoBackground();
  };
  runtime.listen(document, 'visibilitychange', handleVisibility);
  runtime.listen(document, 'site:page-load', handlePageLoad);
  runtime.listen(window, 'online', handleOnline);
  runtime.listen(reducedMotion, 'change', schedule);

  const controller: WallpaperController = {
    refresh: advance,
    download,
    setEnabled,
    setAutoRotation,
    dispose: runtime.dispose,
  };
  activeController = controller;
  runtime.onDispose(() => {
    abortController.abort();
    clearRotationTimer();
    clearManifestRefreshTimer();
    if (activeController === controller) activeController = undefined;
  });

  publish();
  if (enabled) void ensurePhotoBackground();
  return controller.dispose;
}
