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

export const $wallpaper = atom<WallpaperState>({
  enabled: bootstrap?.wallpaper.enabled ?? true,
  autoRotation: bootstrap?.wallpaper.autoRotation ?? true,
  ready: Boolean(bootstrapPhoto),
  canAdvance: false,
  loading: false,
  downloading: false,
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
