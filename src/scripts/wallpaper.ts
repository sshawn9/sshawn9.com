import {
  WALLPAPER_ENDPOINT,
  isWallpaperManifest,
  type WallpaperManifest,
  type WallpaperPhoto,
} from '../lib/wallpaper';

const STORAGE_KEY = 'wallpaper-photo-id';
const ROTATION_INTERVAL_MS = 10 * 60 * 1000;
const IMAGE_WIDTHS = [960, 1600, 2400] as const;
const TRANSITION_MS = 1400;

let manifestPromise: Promise<WallpaperManifest | undefined> | undefined;
let cleanupCurrentWallpaper: (() => void) | undefined;

function imageUrl(rawUrl: string, width: number) {
  const url = new URL(rawUrl);
  url.searchParams.set('auto', 'format');
  url.searchParams.set('fit', 'max');
  url.searchParams.set('q', '80');
  url.searchParams.set('w', String(width));
  return url.toString();
}

function configureImage(image: HTMLImageElement, photo: WallpaperPhoto) {
  image.srcset = IMAGE_WIDTHS.map((width) => `${imageUrl(photo.rawUrl, width)} ${width}w`).join(
    ', ',
  );
  image.sizes = '100vw';
  image.src = imageUrl(photo.rawUrl, IMAGE_WIDTHS[1]);
}

async function loadImage(image: HTMLImageElement, photo: WallpaperPhoto, signal: AbortSignal) {
  image.removeAttribute('src');
  image.removeAttribute('srcset');
  configureImage(image, photo);

  try {
    await image.decode();
  } catch {
    if (!image.complete || image.naturalWidth === 0) return false;
  }
  return !signal.aborted && image.naturalWidth > 0;
}

async function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(WALLPAPER_ENDPOINT, {
      headers: { Accept: 'application/json' },
    })
      .then(async (response) => {
        if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) {
          return undefined;
        }
        const value: unknown = await response.json();
        return isWallpaperManifest(value) ? value : undefined;
      })
      .catch(() => undefined);
  }
  return manifestPromise;
}

function chooseInitialPhoto(photos: WallpaperPhoto[]) {
  const storedId = sessionStorage.getItem(STORAGE_KEY);
  return (
    photos.find((photo) => photo.id === storedId) ??
    photos[Math.floor(Math.random() * photos.length)]
  );
}

function chooseNextPhoto(photos: WallpaperPhoto[], currentId: string) {
  const candidates = photos.filter((photo) => photo.id !== currentId);
  return candidates[Math.floor(Math.random() * candidates.length)] ?? photos[0];
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

function clearImage(image: HTMLImageElement) {
  image.removeAttribute('src');
  image.removeAttribute('srcset');
}

async function initializeWallpaper() {
  cleanupCurrentWallpaper?.();

  const root = document.querySelector<HTMLElement>('[data-wallpaper]');
  const images = root ? [...root.querySelectorAll<HTMLImageElement>('[data-wallpaper-image]')] : [];
  if (!root || images.length !== 2) return;

  const controller = new AbortController();
  const { signal } = controller;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer: number | undefined;
  let activeIndex = -1;
  let currentPhoto: WallpaperPhoto | undefined;
  let rotating = false;

  const clearTimer = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };

  const activate = async (photo: WallpaperPhoto) => {
    const nextIndex = activeIndex === 0 ? 1 : 0;
    const nextImage = images[nextIndex];
    if (!nextImage || !(await loadImage(nextImage, photo, signal))) return false;

    const previousImage = activeIndex >= 0 ? images[activeIndex] : undefined;
    nextImage.classList.add('is-active');
    previousImage?.classList.remove('is-active');
    activeIndex = nextIndex;
    currentPhoto = photo;
    sessionStorage.setItem(STORAGE_KEY, photo.id);
    setCredit(root, photo);

    if (previousImage) {
      window.setTimeout(() => {
        if (!previousImage.classList.contains('is-active')) clearImage(previousImage);
      }, TRANSITION_MS);
    }
    return true;
  };

  const manifest = await loadManifest();
  if (signal.aborted || !manifest) return;

  const initial = chooseInitialPhoto(manifest.photos);
  if (!initial || !(await activate(initial)) || signal.aborted) return;

  const schedule = () => {
    clearTimer();
    if (reducedMotion.matches || document.hidden || manifest.photos.length < 2) return;
    timer = window.setTimeout(async () => {
      if (rotating || !currentPhoto) return schedule();
      rotating = true;
      const next = chooseNextPhoto(manifest.photos, currentPhoto.id);
      if (next) await activate(next);
      rotating = false;
      schedule();
    }, ROTATION_INTERVAL_MS);
  };

  const handleVisibility = () => schedule();
  const handleMotionPreference = () => schedule();
  document.addEventListener('visibilitychange', handleVisibility);
  reducedMotion.addEventListener('change', handleMotionPreference);
  schedule();

  cleanupCurrentWallpaper = () => {
    controller.abort();
    clearTimer();
    document.removeEventListener('visibilitychange', handleVisibility);
    reducedMotion.removeEventListener('change', handleMotionPreference);
    cleanupCurrentWallpaper = undefined;
  };
}

document.addEventListener('astro:before-swap', () => cleanupCurrentWallpaper?.());
document.addEventListener('astro:page-load', initializeWallpaper);
