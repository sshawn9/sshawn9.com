import { installContentUiRuntime } from '@sshawn9/content-ui/runtime';
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
  const disposeTransientOverlays = installTransientOverlayController(ownerDocument, ownerWindow);
  const pages = installPageRuntime(ownerDocument, ownerWindow);
  const disposeNavigation = installNavigationCoordinator(
    ownerDocument,
    ownerWindow,
    pages.prepareTargetDocument,
  );

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
      ownerWindow.removeEventListener('pagehide', handlePageHide);
      pages.dispose();
      disposeNavigation();
      disposeTransientOverlays();
      if (activeRuntime === installation) activeRuntime = undefined;
    },
  };

  ownerWindow.addEventListener('pagehide', handlePageHide);
  activeRuntime = installation;
  return installation.dispose;
}
