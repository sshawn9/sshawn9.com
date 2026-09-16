import {
  isUnsplashImageUrl,
  isWallpaperPhoto,
  type WallpaperPhoto,
} from '@sshawn9/site-domain/wallpaper';

export const THEME_KEY = 'theme';
export const ENABLED_KEY = 'wallpaper-enabled';
export const AUTO_ROTATION_KEY = 'wallpaper-auto-rotation';
export const TAB_STATE_KEY = 'wallpaper-tab-state-v3';
export const MANIFEST_ENDPOINT = '/api/wallpapers';
export const DOWNLOAD_ENDPOINT = '/api/wallpapers/download';
export const SLOT_NAMES = ['a', 'b'] as const;
export const IMAGE_WIDTHS = [960, 1600, 2400] as const;
export const IMAGE_QUALITY = 80;
export const MAX_IMAGE_BYTES = 900_000;
export const MAX_DATA_URL_LENGTH = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 128;
export const IMAGE_TIMEOUT_MS = 10_000;
export const DOWNLOAD_TIMEOUT_MS = 120_000;
export const MAX_CANDIDATE_ATTEMPTS = 4;
export const IMAGE_FADE_MS = 1400;
export const IMAGE_TRANSITION_START_WATCHDOG_MS = 250;
// Upper bound for committing a visible layer if its animation stalls.
export const IMAGE_TRANSITION_SETTLE_WATCHDOG_MS = 3000;
export const MODE_TRANSITION_MS = 720;
export const THEME_TRANSITION_MS = 650;
export const MIN_ROTATION_MS = 5 * 60 * 1000;
export const MAX_ROTATION_MS = 9 * 60 * 1000;
export const MANIFEST_REFRESH_MS = 5 * 60 * 60 * 1000;
export const MANIFEST_RETRY_MS = 30 * 1000;
export const MANIFEST_TIMEOUT_MS = 60_000;

export type Theme = 'light' | 'dark';
export type SlotName = (typeof SLOT_NAMES)[number];

export type AppearancePreferences = {
  theme: Theme;
  hasExplicitTheme: boolean;
  enabled: boolean;
  autoRotation: boolean;
};

export type ImagePolicy = {
  version: 1;
  width: number;
  quality: number;
  key: string;
};

export type WallpaperAssetMeta = {
  version: 1;
  photo: WallpaperPhoto;
  policyKey: string;
  imageUrl: string;
  byteSize: number;
};

export type WallpaperAsset = WallpaperAssetMeta & {
  dataUrl: string;
};

export type WallpaperTabState = {
  version: 3;
  currentSlot: SlotName | null;
  queueIds: string[];
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isWallpaperImageUrl(value: unknown): value is string {
  return isUnsplashImageUrl(value);
}

export function isWallpaperDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_DATA_URL_LENGTH &&
    /^data:image\/(?:avif|jpe?g|png|webp);base64,[a-zA-Z0-9+/]+={0,2}$/.test(value)
  );
}

export function parseJson(value: string | null): unknown {
  if (value === null) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export function getStorage(
  sourceWindow: Window,
  name: 'localStorage' | 'sessionStorage',
): Storage | undefined {
  try {
    return sourceWindow[name];
  } catch {
    return undefined;
  }
}

export function readPreferences(
  local: Storage | undefined,
  prefersDark: boolean,
): AppearancePreferences {
  let storedTheme: string | null | undefined;
  let enabled = true;
  let autoRotation = true;
  try {
    storedTheme = local?.getItem(THEME_KEY);
    enabled = local?.getItem(ENABLED_KEY) !== 'false';
    autoRotation = local?.getItem(AUTO_ROTATION_KEY) !== 'false';
  } catch {}
  const hasExplicitTheme = storedTheme === 'light' || storedTheme === 'dark';
  const theme: Theme = hasExplicitTheme ? (storedTheme as Theme) : prefersDark ? 'dark' : 'light';
  return {
    theme,
    hasExplicitTheme,
    enabled,
    autoRotation,
  };
}

/** Resolves one image URL policy for this full-document lifetime. */
export function resolveImagePolicy(viewportWidth: number, devicePixelRatio: number): ImagePolicy {
  const requiredWidth = Math.max(1, viewportWidth) * Math.min(Math.max(devicePixelRatio, 1), 2);
  const width =
    IMAGE_WIDTHS.find((candidate) => candidate >= requiredWidth) ?? IMAGE_WIDTHS.at(-1)!;
  return {
    version: 1,
    width,
    quality: IMAGE_QUALITY,
    key: `v1-w${width}-q${IMAGE_QUALITY}-auto`,
  };
}

export function createImageUrl(
  rawUrl: string,
  policy: Pick<ImagePolicy, 'width' | 'quality'>,
): string {
  const url = new URL(rawUrl);
  url.searchParams.set('auto', 'format');
  url.searchParams.set('fit', 'max');
  url.searchParams.set('q', String(policy.quality));
  url.searchParams.set('w', String(policy.width));
  return url.toString();
}

export function otherSlot(slot: SlotName): SlotName {
  return slot === 'a' ? 'b' : 'a';
}

export function slotMetaKey(slot: SlotName): string {
  return `wallpaper-slot-${slot}-meta-v3`;
}

export function slotDataKey(slot: SlotName): string {
  return `wallpaper-slot-${slot}-data-v3`;
}

export function defaultTabState(): WallpaperTabState {
  return { version: 3, currentSlot: null, queueIds: [] };
}

export function isTabState(value: unknown): value is WallpaperTabState {
  if (
    !isRecord(value) ||
    value.version !== 3 ||
    (value.currentSlot !== null && value.currentSlot !== 'a' && value.currentSlot !== 'b') ||
    !Array.isArray(value.queueIds)
  ) {
    return false;
  }
  const seen = new Set<string>();
  return value.queueIds.every((id) => {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function isSlotMeta(value: unknown): value is WallpaperAssetMeta {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isWallpaperPhoto(value.photo) &&
    typeof value.policyKey === 'string' &&
    value.policyKey.length > 0 &&
    isWallpaperImageUrl(value.imageUrl) &&
    Number.isInteger(value.byteSize) &&
    Number(value.byteSize) > 0
  );
}

export function shuffle<T>(values: readonly T[], random: () => number = Math.random): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

/** Retains queue order, removes invalid identities, then appends newly available photos. */
export function reconcileQueue(
  storedIds: readonly string[],
  photos: readonly WallpaperPhoto[],
  excludedIds: ReadonlyArray<string | undefined>,
  random: () => number = Math.random,
): string[] {
  const available = new Set(photos.map((photo) => photo.id));
  const excluded = new Set(excludedIds.filter((id): id is string => Boolean(id)));
  const seen = new Set<string>();
  const retained = storedIds.filter((id) => {
    if (!available.has(id) || excluded.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const added = photos.map((photo) => photo.id).filter((id) => !excluded.has(id) && !seen.has(id));
  return [...retained, ...shuffle(added, random)];
}
