import { atom } from 'nanostores';
import { getSiteBootstrapState } from '../lib/site-preferences';
import { isWallpaperPhoto, type WallpaperPhoto } from '../lib/wallpaper';

export type ThemeMode = 'light' | 'dark';

export type NavigationState = {
  pending: boolean;
  phase: 'idle' | 'active' | 'finishing';
  href?: string;
};

export type WallpaperState = {
  enabled: boolean;
  autoRotation: boolean;
  ready: boolean;
  canAdvance: boolean;
  loading: boolean;
  downloading: boolean;
  currentPhoto?: WallpaperPhoto;
};

const bootstrap = getSiteBootstrapState();
const bootstrapPhoto = isWallpaperPhoto(bootstrap?.wallpaper.currentPhoto)
  ? bootstrap.wallpaper.currentPhoto
  : undefined;

export const $theme = atom<ThemeMode>(bootstrap?.theme ?? 'light');

export const $navigation = atom<NavigationState>({
  pending: false,
  phase: 'idle',
});

// The state the server renders with: no bootstrap snapshot exists there, so the
// wallpaper controls are emitted in their inert form. Components must hydrate
// from this value rather than from the already-restored client state, otherwise
// a prop that differs from SSR at hydration time and never changes afterward
// keeps its server-rendered value forever.
export const SSR_WALLPAPER_STATE: WallpaperState = {
  enabled: true,
  autoRotation: true,
  ready: false,
  canAdvance: false,
  loading: false,
  downloading: false,
};

export const $wallpaper = atom<WallpaperState>({
  ...SSR_WALLPAPER_STATE,
  enabled: bootstrap?.wallpaper.enabled ?? true,
  autoRotation: bootstrap?.wallpaper.autoRotation ?? true,
  ready: Boolean(bootstrapPhoto),
  currentPhoto: bootstrapPhoto,
});

export function updateNavigation(next: Partial<NavigationState>) {
  $navigation.set({ ...$navigation.get(), ...next });
}

export function resetNavigationState() {
  $navigation.set({ pending: false, phase: 'idle' });
}

export function updateWallpaper(next: Partial<WallpaperState>) {
  $wallpaper.set({ ...$wallpaper.get(), ...next });
}
