import { claimClientRuntime } from './client-runtime';
import { createSidebarLayoutController } from './sidebar-layout-controller';

let cleanupCurrentSidebar = () => {};

function setupArticleSidebar() {
  cleanupCurrentSidebar();

  const layout = document.querySelector<HTMLElement>('[data-article-sidebar-layout]');
  if (!layout) {
    cleanupCurrentSidebar = () => {};
    return;
  }

  const controller = createSidebarLayoutController('article', layout);
  cleanupCurrentSidebar = () => {
    controller?.destroy();
    cleanupCurrentSidebar = () => {};
  };
}

const runtime = claimClientRuntime('article-sidebar');
runtime.listen(document, 'site:before-swap', () => cleanupCurrentSidebar());
runtime.listen(document, 'site:page-load', setupArticleSidebar);
runtime.onDispose(() => cleanupCurrentSidebar());
setupArticleSidebar();
