export const WALLPAPER_ENDPOINT = '/api/wallpapers';
export const WALLPAPER_DOWNLOAD_ENDPOINT = `${WALLPAPER_ENDPOINT}/download`;

export type WallpaperPhoto = {
  id: string;
  rawUrl: string;
  photographerName: string;
  photographerUrl: string;
  photoUrl: string;
};

export type WallpaperManifest = {
  version: 1;
  updatedAt: string;
  photos: WallpaperPhoto[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWallpaperPhoto(value: unknown): value is WallpaperPhoto {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string' &&
    typeof value.rawUrl === 'string' &&
    typeof value.photographerName === 'string' &&
    typeof value.photographerUrl === 'string' &&
    typeof value.photoUrl === 'string'
  );
}

export function isWallpaperManifest(value: unknown): value is WallpaperManifest {
  if (!isRecord(value)) return false;

  return (
    value.version === 1 &&
    typeof value.updatedAt === 'string' &&
    Array.isArray(value.photos) &&
    value.photos.length > 0 &&
    value.photos.every(isWallpaperPhoto)
  );
}
