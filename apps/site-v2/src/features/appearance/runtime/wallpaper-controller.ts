import { BackdropPresenter } from './backdrop-presenter';
import { ScenicWallpaperSession } from './scenic-wallpaper-session';

export function installWallpaperController(target: Document, sourceWindow: Window): () => void {
  const shell = target.querySelector<HTMLElement>('[data-site-shell]');
  const backdrop = BackdropPresenter.connect(target, sourceWindow);
  if (!shell || !backdrop) return () => {};

  const session = new ScenicWallpaperSession({ target, sourceWindow, shell, backdrop });
  const disposeSession = session.start();
  return () => {
    disposeSession();
    backdrop.dispose();
  };
}
