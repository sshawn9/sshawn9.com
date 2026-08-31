export const WALLPAPER_ENDPOINT = '/api/wallpapers';
export const WALLPAPER_DOWNLOAD_ENDPOINT = `${WALLPAPER_ENDPOINT}/download`;

export type WallpaperPhoto = {
  id: string;
  createdAt: string;
  blurHash: string;
  rawUrl: string;
  photographerName: string;
  photographerUrl: string;
  photoUrl: string;
};

export type WallpaperManifest = {
  version: 2;
  updatedAt: string;
  photos: WallpaperPhoto[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHttpsUrl(value: unknown, host: (hostname: string) => boolean): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && host(url.hostname);
  } catch {
    return false;
  }
}

export function isUnsplashImageUrl(value: unknown): value is string {
  return isHttpsUrl(value, (hostname) => hostname === 'images.unsplash.com');
}

function isUnsplashPageUrl(value: unknown): value is string {
  return isHttpsUrl(
    value,
    (hostname) => hostname === 'unsplash.com' || hostname.endsWith('.unsplash.com'),
  );
}

export function isWallpaperPhoto(value: unknown): value is WallpaperPhoto {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.blurHash === 'string' &&
    value.blurHash.length > 0 &&
    isUnsplashImageUrl(value.rawUrl) &&
    typeof value.photographerName === 'string' &&
    value.photographerName.length > 0 &&
    isUnsplashPageUrl(value.photographerUrl) &&
    isUnsplashPageUrl(value.photoUrl)
  );
}

export function isWallpaperManifest(value: unknown): value is WallpaperManifest {
  if (!isRecord(value)) return false;

  return (
    value.version === 2 &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.photos) &&
    value.photos.length > 0 &&
    value.photos.every(isWallpaperPhoto)
  );
}
