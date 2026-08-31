import { installThemeController } from './theme-controller';
import { installWallpaperController } from './wallpaper-controller';

export function installAppearanceController(
  target: Document = document,
  sourceWindow: Window = window,
): () => void {
  const shell = target.querySelector<HTMLElement>('[data-site-shell]');
  if (!shell) return () => {};

  const disposeTheme = installThemeController(target, sourceWindow);
  const disposeWallpaper = installWallpaperController(target, sourceWindow);
  target.documentElement.dataset.appearanceReady = 'true';

  return () => {
    delete target.documentElement.dataset.appearanceReady;
    disposeWallpaper();
    disposeTheme();
  };
}
