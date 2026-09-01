import type { WallpaperPhoto } from '@sshawn9/site-domain/wallpaper';

export const MAX_WALLPAPER_BOOT_IMAGE_BYTES = 2_500_000;
export const MAX_WALLPAPER_BOOT_DATA_URL_LENGTH =
  Math.ceil((MAX_WALLPAPER_BOOT_IMAGE_BYTES * 4) / 3) + 128;
export const WALLPAPER_BOOT_DATA_URL_PATTERN =
  /^data:image\/(?:avif|jpe?g|png|webp);base64,[a-zA-Z0-9+/]+={0,2}$/;

/** Validates the bounded image representation persisted by the appearance codec. */
export function isWallpaperBootDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_WALLPAPER_BOOT_DATA_URL_LENGTH &&
    WALLPAPER_BOOT_DATA_URL_PATTERN.test(value)
  );
}

const ROOT_APPEARANCE_ATTRIBUTES = [
  'data-theme',
  'data-wallpaper-mode',
  'data-wallpaper-photo-id',
  'data-wallpaper-compositor',
  'data-wallpaper-boot-photo-id',
  'data-wallpaper-initial',
  'data-appearance-script',
  'data-appearance-ready',
] as const;

export const THEME_STORAGE_KEY = 'theme';
export const WALLPAPER_ENABLED_STORAGE_KEY = 'wallpaper-enabled';
export const WALLPAPER_AUTO_ROTATION_STORAGE_KEY = 'wallpaper-auto-rotation';
export const WALLPAPER_LEGACY_ROTATION_STORAGE_KEY = 'wallpaper-rotation-mode';
export const WALLPAPER_SESSION_STORAGE_KEY = 'wallpaper-session-v2';
const LEGACY_WALLPAPER_SESSION_STORAGE_KEY = 'wallpaper-session-v1';
const LEGACY_CURRENT_PHOTO_STORAGE_KEY = 'wallpaper-current-photo';
const LEGACY_CURRENT_BACKGROUND_STORAGE_KEY = 'wallpaper-current-background';
const LEGACY_PHOTO_QUEUE_STORAGE_KEY = 'wallpaper-photo-queue';
const WALLPAPER_FALLBACK_WIDTH = 1600;

export type ResolvedTheme = 'light' | 'dark';

export type WallpaperSessionSnapshot = {
  version: 2;
  photo: WallpaperPhoto;
  imageUrl: string;
  bootImageDataUrl?: string;
  queueIds: string[];
};

export type AppearancePreferences = {
  theme: ResolvedTheme;
  wallpaperEnabled: boolean;
  wallpaperAutoRotation: boolean;
  wallpaperSession?: WallpaperSessionSnapshot;
};

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHttpsUrl(value: unknown, hostname: string): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === hostname;
  } catch {
    return false;
  }
}

function isUnsplashPageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'unsplash.com' || url.hostname.endsWith('.unsplash.com'))
    );
  } catch {
    return false;
  }
}

function isStoredWallpaperPhoto(value: unknown): value is WallpaperPhoto {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.createdAt === 'string' &&
    typeof value.blurHash === 'string' &&
    value.blurHash.length > 0 &&
    isHttpsUrl(value.rawUrl, 'images.unsplash.com') &&
    typeof value.photographerName === 'string' &&
    value.photographerName.length > 0 &&
    isUnsplashPageUrl(value.photographerUrl) &&
    isUnsplashPageUrl(value.photoUrl)
  );
}

export function wallpaperImageUrl(rawUrl: string, width = WALLPAPER_FALLBACK_WIDTH): string {
  const url = new URL(rawUrl);
  url.searchParams.set('auto', 'format');
  url.searchParams.set('fit', 'max');
  url.searchParams.set('q', '80');
  url.searchParams.set('w', String(width));
  return url.toString();
}

export function isWallpaperSessionSnapshot(value: unknown): value is WallpaperSessionSnapshot {
  if (!isRecord(value)) return false;
  const photo = value.photo;
  if (
    value.version !== 2 ||
    !isStoredWallpaperPhoto(photo) ||
    !isHttpsUrl(value.imageUrl, 'images.unsplash.com') ||
    (value.bootImageDataUrl !== undefined && !isWallpaperBootDataUrl(value.bootImageDataUrl)) ||
    !Array.isArray(value.queueIds)
  ) {
    return false;
  }

  const seen = new Set<string>();
  return value.queueIds.every((id) => {
    if (typeof id !== 'string' || id.length === 0 || id === photo.id || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

function isLegacyWallpaperSessionSnapshot(
  value: unknown,
): value is Omit<WallpaperSessionSnapshot, 'version' | 'bootImageDataUrl'> & { version: 1 } {
  if (!isRecord(value) || value.version !== 1) return false;
  return isWallpaperSessionSnapshot({ ...value, version: 2 });
}

function parseStoredJson(storage: ReadableStorage, key: string): unknown {
  const stored = storage.getItem(key);
  if (stored === null) return undefined;
  try {
    return JSON.parse(stored) as unknown;
  } catch {
    return undefined;
  }
}

export function readWallpaperSession(
  storage: ReadableStorage,
): WallpaperSessionSnapshot | undefined {
  const current = parseStoredJson(storage, WALLPAPER_SESSION_STORAGE_KEY);
  if (isWallpaperSessionSnapshot(current)) return current;

  const previous = parseStoredJson(storage, LEGACY_WALLPAPER_SESSION_STORAGE_KEY);
  if (isLegacyWallpaperSessionSnapshot(previous)) return { ...previous, version: 2 };

  const legacyPhoto = parseStoredJson(storage, LEGACY_CURRENT_PHOTO_STORAGE_KEY);
  if (!isStoredWallpaperPhoto(legacyPhoto)) return undefined;

  const legacyBackground = parseStoredJson(storage, LEGACY_CURRENT_BACKGROUND_STORAGE_KEY);
  const imageUrl =
    isRecord(legacyBackground) &&
    legacyBackground.photoId === legacyPhoto.id &&
    legacyBackground.kind === 'remote' &&
    isHttpsUrl(legacyBackground.url, 'images.unsplash.com')
      ? legacyBackground.url
      : wallpaperImageUrl(legacyPhoto.rawUrl);
  const bootImageDataUrl =
    isRecord(legacyBackground) &&
    legacyBackground.photoId === legacyPhoto.id &&
    legacyBackground.kind === 'poster' &&
    isWallpaperBootDataUrl(legacyBackground.url)
      ? legacyBackground.url
      : undefined;
  const legacyQueue = parseStoredJson(storage, LEGACY_PHOTO_QUEUE_STORAGE_KEY);
  const queueIds = Array.isArray(legacyQueue)
    ? [
        ...new Set(
          legacyQueue.filter(
            (id): id is string => typeof id === 'string' && id.length > 0 && id !== legacyPhoto.id,
          ),
        ),
      ]
    : [];

  return { version: 2, photo: legacyPhoto, imageUrl, bootImageDataUrl, queueIds };
}

export function writeWallpaperSession(
  storage: WritableStorage,
  snapshot: WallpaperSessionSnapshot,
): void {
  storage.setItem(WALLPAPER_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
}

export function resolveThemePreference(
  storedTheme: string | null,
  prefersDark: boolean,
): ResolvedTheme {
  if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme;
  return prefersDark ? 'dark' : 'light';
}

export function readAppearancePreferences(
  local: ReadableStorage,
  session: ReadableStorage,
  prefersDark: boolean,
): AppearancePreferences {
  const storedAutoRotation = local.getItem(WALLPAPER_AUTO_ROTATION_STORAGE_KEY);
  return {
    theme: resolveThemePreference(local.getItem(THEME_STORAGE_KEY), prefersDark),
    wallpaperEnabled: local.getItem(WALLPAPER_ENABLED_STORAGE_KEY) !== 'false',
    wallpaperAutoRotation:
      storedAutoRotation === null
        ? local.getItem(WALLPAPER_LEGACY_ROTATION_STORAGE_KEY) !== 'fixed'
        : storedAutoRotation !== 'false',
    wallpaperSession: readWallpaperSession(session),
  };
}

export function applyThemePreference(root: HTMLElement, theme: ResolvedTheme): void {
  root.dataset.theme = theme;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

function updateThemeColor(target: Document, theme: ResolvedTheme): void {
  target
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#070a12' : '#f7f8fb');
}

function applyAppearancePreferences(target: Document, preferences: AppearancePreferences): void {
  const root = target.documentElement;
  applyThemePreference(root, preferences.theme);
  root.dataset.wallpaperMode = preferences.wallpaperEnabled ? 'scenic' : 'default';
  root.dataset.appearanceScript = 'enabled';
  if (preferences.wallpaperSession) {
    root.dataset.wallpaperPhotoId = preferences.wallpaperSession.photo.id;
    if (preferences.wallpaperSession.bootImageDataUrl) {
      root.dataset.wallpaperBootPhotoId = preferences.wallpaperSession.photo.id;
      root.dataset.wallpaperInitial = 'ready';
      root.style.setProperty(
        '--wallpaper-boot-image',
        `url(${JSON.stringify(preferences.wallpaperSession.bootImageDataUrl)})`,
      );
    }
  }
  updateThemeColor(target, preferences.theme);
}

/** Serializes the storage codec for the synchronous head bootstrap. */
export function createAppearancePreferenceSource(): string {
  return `const THEME_STORAGE_KEY = ${JSON.stringify(THEME_STORAGE_KEY)};
const WALLPAPER_ENABLED_STORAGE_KEY = ${JSON.stringify(WALLPAPER_ENABLED_STORAGE_KEY)};
const WALLPAPER_AUTO_ROTATION_STORAGE_KEY = ${JSON.stringify(WALLPAPER_AUTO_ROTATION_STORAGE_KEY)};
const WALLPAPER_LEGACY_ROTATION_STORAGE_KEY = ${JSON.stringify(WALLPAPER_LEGACY_ROTATION_STORAGE_KEY)};
const WALLPAPER_SESSION_STORAGE_KEY = ${JSON.stringify(WALLPAPER_SESSION_STORAGE_KEY)};
const LEGACY_WALLPAPER_SESSION_STORAGE_KEY = ${JSON.stringify(LEGACY_WALLPAPER_SESSION_STORAGE_KEY)};
const LEGACY_CURRENT_PHOTO_STORAGE_KEY = ${JSON.stringify(LEGACY_CURRENT_PHOTO_STORAGE_KEY)};
const LEGACY_CURRENT_BACKGROUND_STORAGE_KEY = ${JSON.stringify(LEGACY_CURRENT_BACKGROUND_STORAGE_KEY)};
const LEGACY_PHOTO_QUEUE_STORAGE_KEY = ${JSON.stringify(LEGACY_PHOTO_QUEUE_STORAGE_KEY)};
const WALLPAPER_FALLBACK_WIDTH = ${WALLPAPER_FALLBACK_WIDTH};
const MAX_WALLPAPER_BOOT_DATA_URL_LENGTH = ${MAX_WALLPAPER_BOOT_DATA_URL_LENGTH};
const WALLPAPER_BOOT_DATA_URL_PATTERN = ${WALLPAPER_BOOT_DATA_URL_PATTERN.toString()};
${isRecord.toString()}
${isHttpsUrl.toString()}
${isUnsplashPageUrl.toString()}
${isStoredWallpaperPhoto.toString()}
${isWallpaperBootDataUrl.toString()}
${wallpaperImageUrl.toString()}
${isWallpaperSessionSnapshot.toString()}
${isLegacyWallpaperSessionSnapshot.toString()}
${parseStoredJson.toString()}
${readWallpaperSession.toString()}
${resolveThemePreference.toString()}
${readAppearancePreferences.toString()}`;
}

/** Emits the shared appearance resolver as the synchronous head prepaint entry. */
export function createDocumentPreferenceScript(): string {
  return `(() => {
    // A native document needs synchronous preference restoration. During an
    // Astro client navigation the coordinator has already transferred the
    // live appearance state, so rerunning this bootstrap would create a
    // duplicate wallpaper preload for the photo owned by the persistent shell.
    if (document.documentElement.dataset.appearanceScript === 'enabled') return;

    ${createAppearancePreferenceSource()}
    ${applyThemePreference.toString()}
    ${updateThemeColor.toString()}
    ${applyAppearancePreferences.toString()}

    let preferences = {
      theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      wallpaperEnabled: true,
      wallpaperAutoRotation: true,
    };
    try {
      preferences = readAppearancePreferences(
        localStorage,
        sessionStorage,
        matchMedia('(prefers-color-scheme: dark)').matches,
      );
    } catch {
      // Storage is optional; safe visual defaults still produce a complete page.
    }
    applyAppearancePreferences(document, preferences);

    if (preferences.wallpaperEnabled && preferences.wallpaperSession) {
      const { photo } = preferences.wallpaperSession;
      // The body parser needs the same validated photo identity that the head
      // used for the boot image. Keeping this as inert JSON makes image and
      // attribution one prepaint transaction without introducing a mutable
      // window global or copying user-controlled values into generated HTML.
      const seed = document.createElement('script');
      seed.type = 'application/json';
      seed.dataset.wallpaperBootSeed = '';
      seed.textContent = JSON.stringify({
        version: 1,
        photo: {
          id: photo.id,
          photographerName: photo.photographerName,
          photographerUrl: photo.photographerUrl,
          photoUrl: photo.photoUrl,
        },
      });
      document.head.append(seed);

      if (preferences.wallpaperSession.bootImageDataUrl) return;
      const preload = document.createElement('link');
      preload.rel = 'preload';
      preload.as = 'image';
      preload.crossOrigin = 'anonymous';
      preload.href = preferences.wallpaperSession.imageUrl;
      preload.dataset.wallpaperPreload = photo.id;
      document.head.append(preload);
    }
  })();`;
}

/** Carries resolved appearance state and capability markers into a document before its swap. */
export function prepareTargetDocumentPreferences(
  currentDocument: Document,
  targetDocument: Document,
): void {
  for (const attribute of ROOT_APPEARANCE_ATTRIBUTES) {
    const value = currentDocument.documentElement.getAttribute(attribute);
    if (value === null) targetDocument.documentElement.removeAttribute(attribute);
    else targetDocument.documentElement.setAttribute(attribute, value);
  }

  const theme = currentDocument.documentElement.classList.contains('dark') ? 'dark' : 'light';
  applyThemePreference(targetDocument.documentElement, theme);
  const bootImage =
    currentDocument.documentElement.style.getPropertyValue('--wallpaper-boot-image');
  if (bootImage) {
    targetDocument.documentElement.style.setProperty('--wallpaper-boot-image', bootImage);
  } else {
    targetDocument.documentElement.style.removeProperty('--wallpaper-boot-image');
  }
  updateThemeColor(targetDocument, theme);
}
