import {
  WALLPAPER_DOWNLOAD_ENDPOINT,
  WALLPAPER_ENDPOINT,
  isWallpaperManifest,
  type WallpaperManifest,
  type WallpaperPhoto,
} from '../lib/wallpaper';

const PHOTO_STORAGE_KEY = 'wallpaper-photo-id';
const ENABLED_STORAGE_KEY = 'wallpaper-enabled';
const ROTATION_STORAGE_KEY = 'wallpaper-rotation-mode';
const FIXED_PHOTO_STORAGE_KEY = 'wallpaper-fixed-photo-id';
const ROTATION_INTERVAL_MS = 10 * 60 * 1000;
const IMAGE_WIDTHS = [960, 1600, 2400] as const;
const TRANSITION_MS = 1400;
const MENU_GAP_PX = 8;
const MENU_VIEWPORT_GAP_PX = 16;

type RotationMode = 'auto' | 'fixed';

type WallpaperController = {
  next: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setRotationMode: (mode: RotationMode) => void;
};

type ControlState = {
  enabled: boolean;
  rotationMode: RotationMode;
  ready: boolean;
  canAdvance: boolean;
  loading: boolean;
};

let manifestPromise: Promise<WallpaperManifest | undefined> | undefined;
let cleanupCurrentWallpaper: (() => void) | undefined;
let lastReportedPhotoId: string | undefined;
let activeWallpaperController: WallpaperController | undefined;
let activeWallpaperMenuTrigger: HTMLButtonElement | undefined;

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
  const currentPromise = manifestPromise;
  const manifest = await currentPromise;
  if (!manifest && manifestPromise === currentPromise) manifestPromise = undefined;
  return manifest;
}

function isRotationMode(value: string | null): value is RotationMode {
  return value === 'auto' || value === 'fixed';
}

function getStoredEnabled() {
  return localStorage.getItem(ENABLED_STORAGE_KEY) !== 'false';
}

function getStoredRotationMode(): RotationMode {
  const storedMode = localStorage.getItem(ROTATION_STORAGE_KEY);
  return isRotationMode(storedMode) ? storedMode : 'auto';
}

function chooseInitialPhoto(photos: WallpaperPhoto[], rotationMode: RotationMode) {
  if (rotationMode === 'fixed') {
    const fixedId = localStorage.getItem(FIXED_PHOTO_STORAGE_KEY);
    const fixedPhoto = photos.find((photo) => photo.id === fixedId);
    if (fixedPhoto) return fixedPhoto;
  }

  const storedId = sessionStorage.getItem(PHOTO_STORAGE_KEY);
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

function hideCredit(root: HTMLElement) {
  const credit = root.querySelector<HTMLElement>('[data-wallpaper-credit]');
  if (credit) credit.hidden = true;
}

function syncWallpaperControls(state: ControlState) {
  document.querySelectorAll<HTMLInputElement>('[data-wallpaper-enabled]').forEach((input) => {
    input.checked = state.enabled;
    input.disabled = state.loading;
  });
  document
    .querySelectorAll<HTMLFieldSetElement>('[data-wallpaper-rotation]')
    .forEach((fieldset) => {
      fieldset.disabled = !state.enabled || !state.ready;
    });
  document.querySelectorAll<HTMLInputElement>('[data-wallpaper-mode]').forEach((input) => {
    input.checked = input.dataset.wallpaperMode === state.rotationMode;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-wallpaper-next]').forEach((button) => {
    button.disabled = !state.enabled || !state.ready || !state.canAdvance || state.loading;
    button.setAttribute('aria-busy', String(state.loading));
    button.toggleAttribute('data-loading', state.loading);
  });
  document.querySelectorAll<SVGElement>('[data-wallpaper-next-icon]').forEach((icon) => {
    icon.classList.toggle('animate-spin', state.loading);
  });
}

function reportDownload(photoId: string) {
  if (lastReportedPhotoId === photoId) return;
  lastReportedPhotoId = photoId;

  void fetch(WALLPAPER_DOWNLOAD_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoId }),
    keepalive: true,
  })
    .then((response) => {
      if (!response.ok) throw new Error(`Wallpaper download report failed: ${response.status}`);
    })
    .catch(() => {
      if (lastReportedPhotoId === photoId) lastReportedPhotoId = undefined;
    });
}

function clearImage(image: HTMLImageElement) {
  image.removeAttribute('src');
  image.removeAttribute('srcset');
  delete image.dataset.wallpaperPhotoId;
}

async function initializeWallpaper() {
  cleanupCurrentWallpaper?.();

  const root = document.querySelector<HTMLElement>('[data-wallpaper]');
  const images = root ? [...root.querySelectorAll<HTMLImageElement>('[data-wallpaper-image]')] : [];
  if (!root || images.length !== 2) return;

  const abortController = new AbortController();
  const { signal } = abortController;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let enabled = getStoredEnabled();
  let rotationMode = getStoredRotationMode();
  let manifest: WallpaperManifest | undefined;
  let timer: number | undefined;
  let activeIndex = images.findIndex((image) => image.classList.contains('is-active'));
  let currentPhoto: WallpaperPhoto | undefined;
  let ready = false;
  let loading = false;
  let activationRevision = 0;

  const controlState = (): ControlState => ({
    enabled,
    rotationMode,
    ready,
    canAdvance: (manifest?.photos.length ?? 0) > 1,
    loading,
  });

  const syncControls = () => syncWallpaperControls(controlState());

  const clearTimer = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
  };

  const showDefaultBackground = () => {
    clearTimer();
    ready = false;
    root.dataset.wallpaperEnabled = 'false';
    hideCredit(root);
    images.forEach((image) => image.classList.remove('is-active'));
    window.setTimeout(() => {
      images.forEach((image) => {
        if (!image.classList.contains('is-active')) clearImage(image);
      });
    }, TRANSITION_MS);
  };

  const activate = async (photo: WallpaperPhoto, revision: number) => {
    const nextIndex = activeIndex === 0 ? 1 : 0;
    const nextImage = images[nextIndex];
    if (!nextImage || !(await loadImage(nextImage, photo, signal))) return false;
    if (signal.aborted || revision !== activationRevision || !enabled) {
      clearImage(nextImage);
      return false;
    }

    const previousImage = activeIndex >= 0 ? images[activeIndex] : undefined;
    nextImage.dataset.wallpaperPhotoId = photo.id;
    nextImage.classList.add('is-active');
    previousImage?.classList.remove('is-active');
    activeIndex = nextIndex;
    currentPhoto = photo;
    ready = true;
    sessionStorage.setItem(PHOTO_STORAGE_KEY, photo.id);
    if (rotationMode === 'fixed') localStorage.setItem(FIXED_PHOTO_STORAGE_KEY, photo.id);
    root.dataset.wallpaperEnabled = 'true';
    root.dataset.wallpaperRotation = rotationMode;
    setCredit(root, photo);
    reportDownload(photo.id);

    if (previousImage) {
      window.setTimeout(() => {
        if (!previousImage.classList.contains('is-active')) clearImage(previousImage);
      }, TRANSITION_MS);
    }
    return true;
  };

  const schedule = () => {
    clearTimer();
    if (
      !enabled ||
      !ready ||
      rotationMode !== 'auto' ||
      reducedMotion.matches ||
      document.hidden ||
      (manifest?.photos.length ?? 0) < 2
    )
      return;
    timer = window.setTimeout(() => void advance(), ROTATION_INTERVAL_MS);
  };

  const ensurePhotoBackground = async () => {
    const revision = activationRevision;
    loading = true;
    syncControls();

    manifest ??= await loadManifest();
    if (signal.aborted || revision !== activationRevision || !enabled || !manifest) {
      if (revision === activationRevision) {
        loading = false;
        syncControls();
      }
      return false;
    }

    const initial =
      currentPhoto && manifest.photos.some((photo) => photo.id === currentPhoto?.id)
        ? currentPhoto
        : chooseInitialPhoto(manifest.photos, rotationMode);
    if (!initial) {
      loading = false;
      syncControls();
      return false;
    }

    const persistedIndex = images.findIndex(
      (image) =>
        image.classList.contains('is-active') && image.dataset.wallpaperPhotoId === initial.id,
    );
    let activated = false;
    if (persistedIndex >= 0) {
      activeIndex = persistedIndex;
      currentPhoto = initial;
      ready = true;
      root.dataset.wallpaperEnabled = 'true';
      root.dataset.wallpaperRotation = rotationMode;
      if (rotationMode === 'fixed') localStorage.setItem(FIXED_PHOTO_STORAGE_KEY, initial.id);
      setCredit(root, initial);
      activated = true;
    } else {
      activated = await activate(initial, revision);
    }

    if (revision === activationRevision) {
      loading = false;
      syncControls();
      schedule();
    }
    return activated;
  };

  const advance = async () => {
    if (!enabled || !ready || loading || !currentPhoto || !manifest || manifest.photos.length < 2)
      return;

    const revision = activationRevision;
    const next = chooseNextPhoto(manifest.photos, currentPhoto.id);
    if (!next) return;

    loading = true;
    syncControls();
    await activate(next, revision);
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

    if (!enabled) {
      showDefaultBackground();
      syncControls();
      return;
    }

    await ensurePhotoBackground();
  };

  const setRotationMode = (nextMode: RotationMode) => {
    if (rotationMode === nextMode) return;

    rotationMode = nextMode;
    localStorage.setItem(ROTATION_STORAGE_KEY, rotationMode);
    root.dataset.wallpaperRotation = rotationMode;
    if (rotationMode === 'fixed' && currentPhoto) {
      localStorage.setItem(FIXED_PHOTO_STORAGE_KEY, currentPhoto.id);
    } else {
      localStorage.removeItem(FIXED_PHOTO_STORAGE_KEY);
    }
    syncControls();
    schedule();
  };

  const wallpaperController: WallpaperController = {
    next: advance,
    setEnabled,
    setRotationMode,
  };
  activeWallpaperController = wallpaperController;

  const handleVisibility = () => schedule();
  const handleMotionPreference = () => schedule();
  document.addEventListener('visibilitychange', handleVisibility);
  reducedMotion.addEventListener('change', handleMotionPreference);

  cleanupCurrentWallpaper = () => {
    abortController.abort();
    clearTimer();
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

  const nextButton = target.closest<HTMLButtonElement>('[data-wallpaper-next]');
  if (nextButton) void activeWallpaperController?.next();
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
    }
    return;
  }

  const mode = target.dataset.wallpaperMode ?? null;
  if (target.matches('[data-wallpaper-mode]') && target.checked && isRotationMode(mode)) {
    if (activeWallpaperController) {
      activeWallpaperController.setRotationMode(mode);
    } else {
      localStorage.setItem(ROTATION_STORAGE_KEY, mode);
    }
  }
});

document.addEventListener('astro:before-swap', () => {
  activeWallpaperMenuTrigger = undefined;
  cleanupCurrentWallpaper?.();
});
document.addEventListener('astro:page-load', initializeWallpaper);
