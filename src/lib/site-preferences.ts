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
  blogSidebarLayout: 'blog-sidebar-layout',
  articleSidebarLayout: 'article-sidebar-layout',
  nestedScrollPositionPrefix: 'nested-scroll-position:',
  articleSectionPrefix: 'article-section:',
  fontReadyPrefix: 'font-ready:',
} as const;

export const BLOG_SIDEBAR_LAYOUT = {
  defaultWidth: 272,
  minWidth: 208,
  maxWidth: 400,
} as const;

export const ARTICLE_SIDEBAR_LAYOUT = {
  defaultWidth: 224,
  minWidth: 208,
  maxWidth: 352,
} as const;

export type StoredTheme = 'light' | 'dark';

export type StoredWallpaperBackground = {
  photoId: string;
  kind: 'remote' | 'poster';
  url: string;
};

export type StoredSidebarLayout = {
  collapsed: boolean;
  width: number;
};

export type StoredBlogSidebarLayout = StoredSidebarLayout;

export type StoredArticleSidebarLayout = StoredSidebarLayout;

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
  blogSidebarLayout: StoredBlogSidebarLayout;
  articleSidebarLayout: StoredArticleSidebarLayout;
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
