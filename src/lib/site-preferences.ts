export const SITE_STORAGE_KEYS = {
  theme: 'theme',
  wallpaperEnabled: 'wallpaper-enabled',
  wallpaperAutoRotation: 'wallpaper-auto-rotation',
  wallpaperLegacyRotation: 'wallpaper-rotation-mode',
  wallpaperFixedPhoto: 'wallpaper-fixed-photo-id',
  wallpaperPhotoId: 'wallpaper-photo-id',
  wallpaperCurrentPhoto: 'wallpaper-current-photo',
  wallpaperCurrentBackground: 'wallpaper-current-background',
  wallpaperPhotoQueue: 'wallpaper-photo-queue',
  articleSectionPrefix: 'article-section:',
  fontReadyPrefix: 'font-ready:',
} as const;

export type StoredTheme = 'light' | 'dark';

export type StoredWallpaperBackground = {
  photoId: string;
  kind: 'remote' | 'poster';
  url: string;
};

export type SiteBootstrapState = {
  theme: StoredTheme;
  scrollPosition?: {
    x: number;
    y: number;
  };
  wallpaper: {
    enabled: boolean;
    autoRotation: boolean;
    currentPhoto?: unknown;
    background?: StoredWallpaperBackground;
  };
  articleSection?: {
    pathname: string;
    slug: string;
  };
};

declare global {
  interface Window {
    __SSHawn9SiteBootstrap?: SiteBootstrapState;
  }
}

export function isStoredWallpaperBackground(value: unknown): value is StoredWallpaperBackground {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Partial<StoredWallpaperBackground>;
  return (
    typeof candidate.photoId === 'string' &&
    (candidate.kind === 'remote' || candidate.kind === 'poster') &&
    typeof candidate.url === 'string' &&
    (candidate.url.startsWith('https://') || candidate.url.startsWith('data:image/'))
  );
}

export function getSiteBootstrapState() {
  return typeof window === 'undefined' ? undefined : window.__SSHawn9SiteBootstrap;
}
