import { decode } from 'blurhash';
import {
  WALLPAPER_DOWNLOAD_ENDPOINT,
  WALLPAPER_ENDPOINT,
  isWallpaperManifest,
  type WallpaperManifest,
  type WallpaperPhoto,
} from '../lib/wallpaper';

const PHOTO_STORAGE_KEY = 'wallpaper-photo-id';
const CURRENT_PHOTO_STORAGE_KEY = 'wallpaper-current-photo';
const CURRENT_BACKGROUND_STORAGE_KEY = 'wallpaper-current-background';
const PHOTO_QUEUE_STORAGE_KEY = 'wallpaper-photo-queue';
const ENABLED_STORAGE_KEY = 'wallpaper-enabled';
const AUTO_ROTATION_STORAGE_KEY = 'wallpaper-auto-rotation';
const LEGACY_ROTATION_STORAGE_KEY = 'wallpaper-rotation-mode';
const FIXED_PHOTO_STORAGE_KEY = 'wallpaper-fixed-photo-id';
const MIN_ROTATION_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ROTATION_INTERVAL_MS = 9 * 60 * 1000;
const MANIFEST_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const IMAGE_WIDTHS = [960, 1600, 2400] as const;
const DOWNLOAD_WIDTH = 2400;
const PLACEHOLDER_WIDTH = 32;
const PLACEHOLDER_HEIGHT = 20;
const POSTER_WIDTH = 1600;
const MAX_POSTER_BYTES = 2_500_000;
const TRANSITION_MS = 1400;
const MENU_GAP_PX = 8;
const MENU_VIEWPORT_GAP_PX = 16;

type WallpaperController = {
  refresh: () => Promise<void>;
  download: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setAutoRotation: (enabled: boolean) => void;
};

type ControlState = {
  enabled: boolean;
  autoRotation: boolean;
  ready: boolean;
  canAdvance: boolean;
  loading: boolean;
  downloading: boolean;
};

type StoredWallpaperBackground = {
  photoId: string;
  kind: 'remote' | 'poster' | 'blur';
  url: string;
};

let cachedManifest: WallpaperManifest | undefined;
let manifestPromise: Promise<WallpaperManifest | undefined> | undefined;
let manifestLastRequestedAt = 0;
let cleanupCurrentWallpaper: (() => void) | undefined;
let activeWallpaperController: WallpaperController | undefined;
let activeWallpaperMenuTrigger: HTMLButtonElement | undefined;
const posterTasks = new Map<string, Promise<void>>();

function nextRotationDelay() {
  return (
    MIN_ROTATION_INTERVAL_MS + Math.random() * (MAX_ROTATION_INTERVAL_MS - MIN_ROTATION_INTERVAL_MS)
  );
}

function getWallpaperMenu(trigger: HTMLButtonElement) {
  const id = trigger.getAttribute('popovertarget');
  const menu = id ? document.getElementById(id) : null;
  return menu instanceof HTMLElement && menu.matches('[data-wallpaper-menu]') ? menu : undefined;
}

function positionWallpaperMenu(trigger: HTMLButtonElement, menu: HTMLElement) {
  const triggerRect = trigger.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const computedWidth = Number.parseFloat(getComputedStyle(menu).width);
  const width = menuRect.width || (Number.isFinite(computedWidth) ? computedWidth : 288);
  const height = menuRect.height;
  const maximumLeft = Math.max(
    MENU_VIEWPORT_GAP_PX,
    window.innerWidth - width - MENU_VIEWPORT_GAP_PX,
  );
  const left = Math.min(Math.max(triggerRect.right - width, MENU_VIEWPORT_GAP_PX), maximumLeft);
  const below = triggerRect.bottom + MENU_GAP_PX;
  const above = triggerRect.top - height - MENU_GAP_PX;
  const top =
    height > 0 && below + height > window.innerHeight - MENU_VIEWPORT_GAP_PX
      ? above >= MENU_VIEWPORT_GAP_PX
        ? above
        : Math.max(MENU_VIEWPORT_GAP_PX, window.innerHeight - height - MENU_VIEWPORT_GAP_PX)
      : below;

  menu.style.setProperty('--wallpaper-menu-left', `${left}px`);
  menu.style.setProperty('--wallpaper-menu-top', `${top}px`);
}

function queueWallpaperMenuPosition(trigger: HTMLButtonElement, menu: HTMLElement) {
  positionWallpaperMenu(trigger, menu);
  window.requestAnimationFrame(() => {
    if (menu.matches(':popover-open')) positionWallpaperMenu(trigger, menu);
  });
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

function getStoredEnabled() {
  return localStorage.getItem(ENABLED_STORAGE_KEY) !== 'false';
}

function setWallpaperMode(enabled: boolean) {
  document.documentElement.dataset.wallpaperMode = enabled ? 'scenic' : 'default';
}

function getStoredAutoRotation() {
  const storedValue = localStorage.getItem(AUTO_ROTATION_STORAGE_KEY);
  if (storedValue !== null) return storedValue !== 'false';
  return localStorage.getItem(LEGACY_ROTATION_STORAGE_KEY) !== 'fixed';
}

function storeAutoRotation(enabled: boolean) {
  localStorage.setItem(AUTO_ROTATION_STORAGE_KEY, String(enabled));
  localStorage.removeItem(LEGACY_ROTATION_STORAGE_KEY);
}

function findStoredPhoto(photos: WallpaperPhoto[], autoRotation: boolean) {
  if (!autoRotation) {
    const fixedId = localStorage.getItem(FIXED_PHOTO_STORAGE_KEY);
    const fixedPhoto = photos.find((photo) => photo.id === fixedId);
    if (fixedPhoto) return fixedPhoto;
  }

  const storedId = sessionStorage.getItem(PHOTO_STORAGE_KEY);
  return photos.find((photo) => photo.id === storedId);
}

function readStoredCurrentPhoto() {
  const storedValue = sessionStorage.getItem(CURRENT_PHOTO_STORAGE_KEY);
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
  sessionStorage.setItem(CURRENT_PHOTO_STORAGE_KEY, JSON.stringify(photo));
}

function readStoredBackground(photoId: string) {
  const storedValue = sessionStorage.getItem(CURRENT_BACKGROUND_STORAGE_KEY);
  if (!storedValue) return undefined;

  try {
    const value = JSON.parse(storedValue) as Partial<StoredWallpaperBackground>;
    return value.photoId === photoId &&
      (value.kind === 'remote' || value.kind === 'poster' || value.kind === 'blur') &&
      typeof value.url === 'string' &&
      (value.url.startsWith('https://') || value.url.startsWith('data:image/'))
      ? (value as StoredWallpaperBackground)
      : undefined;
  } catch {
    return undefined;
  }
}

function storeBackground(background: StoredWallpaperBackground) {
  try {
    sessionStorage.setItem(CURRENT_BACKGROUND_STORAGE_KEY, JSON.stringify(background));
    return true;
  } catch {
    return false;
  }
}

function applyBackground(background: StoredWallpaperBackground) {
  document.documentElement.dataset.wallpaperBackground = background.photoId;
  document.documentElement.dataset.wallpaperBackgroundKind = background.kind;
  document.documentElement.style.setProperty(
    '--wallpaper-current-image',
    `url(${JSON.stringify(background.url)})`,
  );
}

function createRemoteBackground(
  photo: WallpaperPhoto,
  url = imageUrl(photo.rawUrl, POSTER_WIDTH),
): StoredWallpaperBackground {
  return {
    photoId: photo.id,
    kind: 'remote',
    url,
  };
}

function createBlurBackground(photo: WallpaperPhoto): StoredWallpaperBackground | undefined {
  try {
    const pixels = decode(photo.blurHash, PLACEHOLDER_WIDTH, PLACEHOLDER_HEIGHT);
    const canvas = document.createElement('canvas');
    canvas.width = PLACEHOLDER_WIDTH;
    canvas.height = PLACEHOLDER_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    const imageData = context.createImageData(PLACEHOLDER_WIDTH, PLACEHOLDER_HEIGHT);
    imageData.data.set(pixels);
    context.putImageData(imageData, 0, 0);
    return {
      photoId: photo.id,
      kind: 'blur',
      url: canvas.toDataURL('image/webp', 0.65),
    };
  } catch {
    return undefined;
  }
}

function restoreBackground(photo: WallpaperPhoto) {
  const background = readStoredBackground(photo.id) ?? createRemoteBackground(photo);
  storeBackground(background);
  applyBackground(background);
  return background;
}

function stageBlurBackground(photo: WallpaperPhoto) {
  const background = createBlurBackground(photo);
  if (background) applyBackground(background);
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
    storeBackground({ photoId: photo.id, kind: 'poster', url });
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
  const storedValue = sessionStorage.getItem(PHOTO_QUEUE_STORAGE_KEY);
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
  sessionStorage.setItem(PHOTO_QUEUE_STORAGE_KEY, JSON.stringify(photos.map((photo) => photo.id)));
}

function setCredit(root: HTMLElement, photo: WallpaperPhoto) {
  const credit = root.querySelector<HTMLElement>('[data-wallpaper-credit]');
  const photographer = root.querySelector<HTMLAnchorElement>('[data-wallpaper-photographer]');
  const source = root.querySelector<HTMLAnchorElement>('[data-wallpaper-source]');
  if (!credit || !photographer || !source) return;

  photographer.textContent = photo.photographerName;
  photographer.href = photo.photographerUrl;
  source.href = photo.photoUrl;
  credit.hidden = false;
}

function hideCredit(root: HTMLElement) {
  const credit = root.querySelector<HTMLElement>('[data-wallpaper-credit]');
  if (credit) credit.hidden = true;
}

function syncWallpaperControls(state: ControlState) {
  document.querySelectorAll<HTMLInputElement>('[data-wallpaper-enabled]').forEach((input) => {
    input.checked = state.enabled;
    input.disabled = state.loading;
  });
  document.querySelectorAll<HTMLInputElement>('[data-wallpaper-auto-rotation]').forEach((input) => {
    input.checked = state.autoRotation;
    input.disabled = !state.enabled || !state.ready;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-wallpaper-refresh]').forEach((button) => {
    button.disabled = !state.enabled || !state.ready || !state.canAdvance || state.loading;
    button.setAttribute('aria-busy', String(state.loading));
    button.toggleAttribute('data-loading', state.loading);
  });
  document.querySelectorAll<SVGElement>('[data-wallpaper-refresh-icon]').forEach((icon) => {
    icon.classList.toggle('animate-spin', state.loading);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-wallpaper-download]').forEach((button) => {
    button.disabled = !state.enabled || !state.ready || state.downloading;
    button.setAttribute('aria-busy', String(state.downloading));
    button.toggleAttribute('data-loading', state.downloading);
  });
}

function reportDownload(photoId: string) {
  void fetch(WALLPAPER_DOWNLOAD_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoId }),
    keepalive: true,
  })
    .then((response) => {
      if (!response.ok) throw new Error(`Wallpaper download report failed: ${response.status}`);
    })
    .catch(() => undefined);
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

async function initializeWallpaper() {
  cleanupCurrentWallpaper?.();

  const root = document.querySelector<HTMLElement>('[data-wallpaper]');
  const media = root?.querySelector<HTMLElement>('[data-wallpaper-media]');
  const images = root ? [...root.querySelectorAll<HTMLImageElement>('[data-wallpaper-image]')] : [];
  if (!root || !media || images.length !== 2) return;

  const abortController = new AbortController();
  const { signal } = abortController;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let enabled = getStoredEnabled();
  setWallpaperMode(enabled);
  let autoRotation = getStoredAutoRotation();
  let manifest: WallpaperManifest | undefined;
  let rotationTimer: number | undefined;
  let manifestRefreshTimer: number | undefined;
  let activeIndex = images.findIndex((image) => image.classList.contains('is-active'));
  let currentPhoto = readStoredCurrentPhoto();
  let backgroundActive = false;
  let photoQueue: WallpaperPhoto[] = [];
  let ready = false;
  let loading = false;
  let downloading = false;
  let activationRevision = 0;

  if (currentPhoto) {
    restoreBackground(currentPhoto);
    backgroundActive =
      activeIndex < 0 && document.documentElement.dataset.wallpaperBackground === currentPhoto.id;
    ready = enabled && backgroundActive;
    if (enabled) {
      root.dataset.wallpaperEnabled = 'true';
      setCredit(root, currentPhoto);
    }
  } else {
    delete document.documentElement.dataset.wallpaperBackground;
    delete document.documentElement.dataset.wallpaperBackgroundKind;
    document.documentElement.style.removeProperty('--wallpaper-current-image');
  }

  const controlState = (): ControlState => ({
    enabled,
    autoRotation,
    ready,
    canAdvance: manifest?.photos.some((photo) => photo.id !== currentPhoto?.id) ?? false,
    loading,
    downloading,
  });

  const syncControls = () => syncWallpaperControls(controlState());

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

  const showDefaultBackground = () => {
    clearRotationTimer();
    clearManifestRefreshTimer();
    root.dataset.wallpaperEnabled = 'false';
    hideCredit(root);
  };

  const activate = async (photo: WallpaperPhoto, revision: number) => {
    if (activeIndex < 0 && !backgroundActive) stageBlurBackground(photo);
    const nextIndex = activeIndex === 0 ? 1 : 0;
    const nextImage = images[nextIndex];
    if (!nextImage) return false;
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
    activeIndex = nextIndex;
    backgroundActive = false;
    currentPhoto = photo;
    ready = true;
    sessionStorage.setItem(PHOTO_STORAGE_KEY, photo.id);
    storeCurrentPhoto(photo);
    const currentImageUrl = nextImage.currentSrc || imageUrl(photo.rawUrl, POSTER_WIDTH);
    storeBackground(createRemoteBackground(photo, currentImageUrl));
    cacheBackgroundPoster(photo, currentImageUrl);
    if (!autoRotation) localStorage.setItem(FIXED_PHOTO_STORAGE_KEY, photo.id);
    root.dataset.wallpaperEnabled = 'true';
    setCredit(root, photo);

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
      setCredit(root, updatedCurrentPhoto);
    }

    if (!previousManifest || previousManifest.updatedAt === nextManifest.updatedAt) {
      syncControls();
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
    syncControls();
    if (rotationTimer === undefined) schedule();
  };

  const refreshManifest = async () => {
    clearManifestRefreshTimer();
    if (signal.aborted || !enabled || document.hidden) return;

    const nextManifest = await loadManifest(true);
    if (!signal.aborted && enabled && nextManifest) reconcileManifest(nextManifest);
    scheduleManifestRefresh();
  };

  const scheduleManifestRefresh = () => {
    clearManifestRefreshTimer();
    if (signal.aborted || !enabled || document.hidden) return;

    const elapsed = Date.now() - manifestLastRequestedAt;
    const delay = Math.max(0, MANIFEST_REFRESH_INTERVAL_MS - elapsed);
    if (delay === 0) {
      void refreshManifest();
      return;
    }

    manifestRefreshTimer = window.setTimeout(() => {
      manifestRefreshTimer = undefined;
      void refreshManifest();
    }, delay);
  };

  const ensurePhotoBackground = async () => {
    const revision = activationRevision;
    loading = !ready;
    syncControls();

    manifest ??= await loadManifest();
    if (signal.aborted || revision !== activationRevision || !enabled || !manifest) {
      if (revision === activationRevision) {
        loading = false;
        syncControls();
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
      syncControls();
      return false;
    }

    if (activeIndex < 0 && !backgroundActive) stageBlurBackground(initial);

    const persistedIndex = images.findIndex(
      (image) =>
        image.classList.contains('is-active') && image.dataset.wallpaperPhotoId === initial.id,
    );
    let activated = false;
    const persistedImage = persistedIndex >= 0 ? images[persistedIndex] : undefined;
    if (persistedImage && (await decodeImage(persistedImage, signal))) {
      if (revision !== activationRevision || !enabled) return false;
      activeIndex = persistedIndex;
      currentPhoto = initial;
      ready = true;
      media.dataset.wallpaperReady = initial.id;
      root.dataset.wallpaperEnabled = 'true';
      storeCurrentPhoto(initial);
      cacheBackgroundPoster(
        initial,
        persistedImage.currentSrc || imageUrl(initial.rawUrl, POSTER_WIDTH),
      );
      if (!autoRotation) localStorage.setItem(FIXED_PHOTO_STORAGE_KEY, initial.id);
      setCredit(root, initial);
      activated = true;
    } else if (
      backgroundActive &&
      currentPhoto?.id === initial.id &&
      document.documentElement.dataset.wallpaperBackground === initial.id
    ) {
      ready = true;
      root.dataset.wallpaperEnabled = 'true';
      sessionStorage.setItem(PHOTO_STORAGE_KEY, initial.id);
      storeCurrentPhoto(initial);
      if (!autoRotation) localStorage.setItem(FIXED_PHOTO_STORAGE_KEY, initial.id);
      setCredit(root, initial);
      cacheBackgroundPoster(initial, readStoredBackground(initial.id)?.url);
      activated = true;
    } else {
      if (persistedImage) {
        persistedImage.classList.remove('is-active');
        clearImage(persistedImage);
        if (!images.some((image) => image.classList.contains('is-active'))) {
          media.removeAttribute('data-wallpaper-ready');
          activeIndex = -1;
        }
      }
      const attemptedIds = new Set([initial.id]);
      activated = await activate(initial, revision);
      if (!activated) activated = await activateNextAvailable(revision, attemptedIds);
    }

    if (revision === activationRevision) {
      loading = false;
      syncControls();
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
    const attemptedIds = new Set([currentPhoto.id]);
    loading = true;
    syncControls();
    await activateNextAvailable(revision, attemptedIds);
    if (revision === activationRevision) {
      loading = false;
      syncControls();
      schedule();
    }
  };

  const setEnabled = async (nextEnabled: boolean) => {
    if (enabled === nextEnabled) return;

    activationRevision += 1;
    enabled = nextEnabled;
    loading = false;
    localStorage.setItem(ENABLED_STORAGE_KEY, String(enabled));
    setWallpaperMode(enabled);

    if (!enabled) {
      showDefaultBackground();
      syncControls();
      return;
    }

    root.dataset.wallpaperEnabled = 'true';
    if (currentPhoto) {
      if (activeIndex < 0) {
        restoreBackground(currentPhoto);
        backgroundActive = true;
        ready = true;
      }
      setCredit(root, currentPhoto);
    }
    await ensurePhotoBackground();
  };

  const setAutoRotation = (nextEnabled: boolean) => {
    if (autoRotation === nextEnabled) return;

    autoRotation = nextEnabled;
    storeAutoRotation(autoRotation);
    if (!autoRotation && currentPhoto) {
      localStorage.setItem(FIXED_PHOTO_STORAGE_KEY, currentPhoto.id);
    } else {
      localStorage.removeItem(FIXED_PHOTO_STORAGE_KEY);
    }
    syncControls();
    schedule();
  };

  const download = async () => {
    if (!enabled || !ready || downloading || !currentPhoto) return;

    const photo = currentPhoto;
    downloading = true;
    syncControls();
    try {
      if (await saveWallpaperPhoto(photo, signal)) reportDownload(photo.id);
    } catch {
      // Keep the wallpaper controls usable when the image download fails.
    } finally {
      if (!signal.aborted) {
        downloading = false;
        syncControls();
      }
    }
  };

  const wallpaperController: WallpaperController = {
    refresh: advance,
    download,
    setEnabled,
    setAutoRotation,
  };
  activeWallpaperController = wallpaperController;

  const handleVisibility = () => {
    schedule();
    scheduleManifestRefresh();
  };
  const handleMotionPreference = () => schedule();
  document.addEventListener('visibilitychange', handleVisibility);
  reducedMotion.addEventListener('change', handleMotionPreference);

  cleanupCurrentWallpaper = () => {
    abortController.abort();
    clearRotationTimer();
    clearManifestRefreshTimer();
    document.removeEventListener('visibilitychange', handleVisibility);
    reducedMotion.removeEventListener('change', handleMotionPreference);
    if (activeWallpaperController === wallpaperController) activeWallpaperController = undefined;
    cleanupCurrentWallpaper = undefined;
  };

  syncControls();
  if (enabled) {
    void ensurePhotoBackground();
  } else {
    showDefaultBackground();
    syncControls();
  }
}

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const menuTrigger = target.closest<HTMLButtonElement>('[data-wallpaper-menu-trigger]');
  if (menuTrigger) {
    const menu = getWallpaperMenu(menuTrigger);
    if (menu && !menu.matches(':popover-open')) {
      activeWallpaperMenuTrigger = menuTrigger;
      queueWallpaperMenuPosition(menuTrigger, menu);
    } else if (menu?.matches(':popover-open')) {
      activeWallpaperMenuTrigger = undefined;
    }
  }

  const refreshButton = target.closest<HTMLButtonElement>('[data-wallpaper-refresh]');
  if (refreshButton) void activeWallpaperController?.refresh();

  const downloadButton = target.closest<HTMLButtonElement>('[data-wallpaper-download]');
  if (downloadButton) void activeWallpaperController?.download();
});

document.addEventListener(
  'toggle',
  (event) => {
    const menu = event.target;
    if (!(menu instanceof HTMLElement) || !menu.matches('[data-wallpaper-menu]')) return;

    if (menu.matches(':popover-open')) {
      const trigger =
        activeWallpaperMenuTrigger ??
        menu
          .closest('[data-wallpaper-control]')
          ?.querySelector<HTMLButtonElement>('[data-wallpaper-menu-trigger]');
      if (trigger) {
        activeWallpaperMenuTrigger = trigger;
        positionWallpaperMenu(trigger, menu);
      }
    } else if (
      activeWallpaperMenuTrigger &&
      getWallpaperMenu(activeWallpaperMenuTrigger) === menu
    ) {
      activeWallpaperMenuTrigger = undefined;
    }
  },
  true,
);

window.addEventListener('resize', () => {
  if (!activeWallpaperMenuTrigger) return;
  const menu = getWallpaperMenu(activeWallpaperMenuTrigger);
  if (menu?.matches(':popover-open')) {
    positionWallpaperMenu(activeWallpaperMenuTrigger, menu);
  } else {
    activeWallpaperMenuTrigger = undefined;
  }
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  if (target.matches('[data-wallpaper-enabled]')) {
    if (activeWallpaperController) {
      void activeWallpaperController.setEnabled(target.checked);
    } else {
      localStorage.setItem(ENABLED_STORAGE_KEY, String(target.checked));
      setWallpaperMode(target.checked);
    }
    return;
  }

  if (target.matches('[data-wallpaper-auto-rotation]')) {
    if (activeWallpaperController) {
      activeWallpaperController.setAutoRotation(target.checked);
    } else {
      storeAutoRotation(target.checked);
    }
  }
});

document.addEventListener('astro:before-swap', () => {
  activeWallpaperMenuTrigger = undefined;
  cleanupCurrentWallpaper?.();
});
document.addEventListener('astro:page-load', initializeWallpaper);
