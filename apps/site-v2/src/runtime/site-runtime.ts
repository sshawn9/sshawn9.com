import { installContentUiRuntime } from '@sshawn9/content-ui/runtime';
import { installAppearanceController } from '../features/appearance/runtime/appearance-controller';
import { installNavigationCoordinator } from './navigation-coordinator';
import { installPageRuntime } from './page-runtime';
import { installTransientOverlayController } from './transient-overlay-controller';

type RuntimeInstallation = {
  ownerDocument: Document;
  dispose(): void;
};

let activeRuntime: RuntimeInstallation | undefined;

/** Installs every long-lived browser controller for the current Document. */
export function installSiteRuntime(
  ownerDocument: Document = document,
  ownerWindow: Window = window,
): () => void {
  if (activeRuntime?.ownerDocument === ownerDocument) return activeRuntime.dispose;
  activeRuntime?.dispose();

  installContentUiRuntime();

  let disposed = false;
  let disposeAppearance: (() => void) | undefined;
  const startAppearance = (): void => {
    if (disposed || disposeAppearance) return;
    disposeAppearance = installAppearanceController(ownerDocument, ownerWindow);
  };

  // Preserve the existing timing: theme is already set by the prepaint script,
  // while networked wallpaper behavior starts at Astro's initial page-load.
  ownerDocument.addEventListener('astro:page-load', startAppearance, { once: true });
  const disposeTransientOverlays = installTransientOverlayController(ownerDocument, ownerWindow);
  const disposeNavigation = installNavigationCoordinator(ownerDocument, ownerWindow);
  const disposePages = installPageRuntime(ownerDocument, ownerWindow);

  const handlePageHide = (event: PageTransitionEvent): void => {
    // A persisted page is frozen in the browser back-forward cache and must
    // resume with its live controller instances intact.
    if (!event.persisted) installation.dispose();
  };

  const installation: RuntimeInstallation = {
    ownerDocument,
    dispose() {
      if (disposed) return;
      disposed = true;
      ownerDocument.removeEventListener('astro:page-load', startAppearance);
      ownerWindow.removeEventListener('pagehide', handlePageHide);
      disposePages();
      disposeNavigation();
      disposeTransientOverlays();
      disposeAppearance?.();
      if (activeRuntime === installation) activeRuntime = undefined;
    },
  };

  ownerWindow.addEventListener('pagehide', handlePageHide);
  activeRuntime = installation;
  return installation.dispose;
}
