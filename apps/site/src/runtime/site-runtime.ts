import { installContentUiRuntime } from '@sshawn9/content-ui/runtime';
import { installNavigationCoordinator } from './navigation-coordinator';
import { createPageRuntime } from './page-runtime';
import { installTransientOverlayController } from './transient-overlay-controller';
import { rethrowAfterCleanup, runCleanups } from './cleanup';

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

  let disposed = false;
  let overlays: ReturnType<typeof installTransientOverlayController> | undefined;
  let pages: ReturnType<typeof createPageRuntime> | undefined;
  let navigation: ReturnType<typeof installNavigationCoordinator> | undefined;

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
      if (activeRuntime === installation) activeRuntime = undefined;
      runCleanups(
        () => ownerWindow.removeEventListener('pagehide', handlePageHide),
        () => pages?.dispose(),
        () => navigation?.dispose(),
        () => overlays?.dispose(),
      );
    },
  };

  try {
    installContentUiRuntime();
    const documentOverlays = (overlays = installTransientOverlayController(
      ownerDocument,
      ownerWindow,
    ));
    const pageRuntime = (pages = createPageRuntime(ownerDocument, ownerWindow));
    const coordinator = installNavigationCoordinator(ownerDocument, ownerWindow, {
      pages: pageRuntime,
      closeDocumentOverlays: documentOverlays.closeForNavigation,
      documentReady: () => pageRuntime.mountCurrentPage(coordinator),
    });
    navigation = coordinator;
    pageRuntime.mountCurrentPage(coordinator);

    ownerWindow.addEventListener('pagehide', handlePageHide);
    activeRuntime = installation;
    ownerDocument.dispatchEvent(new Event('site:runtime-ready'));
    return installation.dispose;
  } catch (error) {
    // Keep initial-document's full-document navigation guard until installation succeeds.
    rethrowAfterCleanup(error, installation.dispose);
  }
}
