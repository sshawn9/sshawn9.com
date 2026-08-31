import { component$, useVisibleTask$ } from '@builder.io/qwik';
import { useLocation } from '@builder.io/qwik-city';
import { persistCurrentScroll, restoreCurrentScroll } from '../../runtime/scroll-state';

/** Connects Qwik route changes to per-history-entry scroll state. */
export const NavigationStateBridge = component$(() => {
  const location = useLocation();

  useVisibleTask$(({ cleanup, track }) => {
    track(() => location.url.pathname + location.url.search);
    track(() => location.isNavigating);

    // Qwik publishes the target URL before RouterOutlet has committed. Restoring
    // against that intermediate state would silently miss target scroll regions.
    if (location.isNavigating) {
      return;
    }

    let restoring = true;
    let saveFrame = 0;

    const progress = document.querySelector<HTMLElement>('[data-navigation-progress]');
    if (progress) {
      progress.dataset.active = 'false';
    }

    requestAnimationFrame(() => {
      restoreCurrentScroll();
      requestAnimationFrame(() => {
        restoring = false;
      });
    });

    const scheduleSave = () => {
      if (restoring || saveFrame !== 0) {
        return;
      }
      saveFrame = requestAnimationFrame(() => {
        saveFrame = 0;
        persistCurrentScroll();
      });
    };

    const prepareLinkNavigation = (event: MouseEvent) => {
      const target = event.target;
      const anchor =
        target instanceof Element ? target.closest<HTMLAnchorElement>('a[href]') : null;
      if (
        !anchor ||
        anchor.origin !== window.location.origin ||
        anchor.target ||
        anchor.hasAttribute('download') ||
        (anchor.hash && anchor.pathname === window.location.pathname)
      ) {
        return;
      }

      persistCurrentScroll();
      if (progress) {
        progress.dataset.active = 'true';
      }
    };

    document.addEventListener('scroll', scheduleSave, true);
    document.addEventListener('click', prepareLinkNavigation, true);
    window.addEventListener('pagehide', persistCurrentScroll);

    cleanup(() => {
      if (saveFrame !== 0) {
        cancelAnimationFrame(saveFrame);
      }
      document.removeEventListener('scroll', scheduleSave, true);
      document.removeEventListener('click', prepareLinkNavigation, true);
      window.removeEventListener('pagehide', persistCurrentScroll);
    });
  });

  return null;
});
