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

export function isWallpaperPhoto(value: unknown): value is WallpaperPhoto {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string' &&
    typeof value.createdAt === 'string' &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.blurHash === 'string' &&
    value.blurHash.length > 0 &&
    typeof value.rawUrl === 'string' &&
    typeof value.photographerName === 'string' &&
    typeof value.photographerUrl === 'string' &&
    typeof value.photoUrl === 'string'
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
