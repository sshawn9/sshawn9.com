import '@oddbird/popover-polyfill';
import { claimClientRuntime } from './client-runtime';

const TRANSIENT_OVERLAY_SELECTOR = '[data-transient-overlay]';

type PopoverToggleEvent = Event & {
  newState?: 'open' | 'closed';
};

let activeOverlay: HTMLElement | undefined;
let validationFrame: number | undefined;
const runtime = claimClientRuntime('transient-ui');

function getTransientOverlays() {
  return [...document.querySelectorAll<HTMLElement>(TRANSIENT_OVERLAY_SELECTOR)];
}

function isRendered(element: HTMLElement) {
  if (!element.isConnected || element.getClientRects().length === 0) return false;

  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function findVisibleInvoker(overlay: HTMLElement) {
  if (!overlay.id) return undefined;

  return [...document.querySelectorAll<HTMLElement>('[popovertarget]')].find(
    (candidate) => candidate.getAttribute('popovertarget') === overlay.id && isRendered(candidate),
  );
}

function syncInvokers(overlay: HTMLElement, open: boolean) {
  if (!overlay.id) return;

  document.querySelectorAll<HTMLElement>('[popovertarget]').forEach((candidate) => {
    if (candidate.getAttribute('popovertarget') === overlay.id) {
      candidate.setAttribute('aria-expanded', String(open));
    }
  });
}

function closeOverlay(overlay: HTMLElement) {
  if (overlay.matches(':popover-open')) overlay.hidePopover();
  syncInvokers(overlay, false);
  if (activeOverlay === overlay) activeOverlay = undefined;
}

function closeTransientOverlays(except?: HTMLElement) {
  getTransientOverlays().forEach((overlay) => {
    if (overlay !== except) closeOverlay(overlay);
  });
}

function validateTransientOverlays() {
  validationFrame = undefined;

  getTransientOverlays().forEach((overlay) => {
    if (!overlay.matches(':popover-open')) return;

    if (overlay !== activeOverlay || !findVisibleInvoker(overlay)) {
      closeOverlay(overlay);
    }
  });
}

function scheduleValidation() {
  if (validationFrame !== undefined) return;
  validationFrame = window.requestAnimationFrame(validateTransientOverlays);
}

runtime.listen(
  document,
  'beforetoggle',
  (event) => {
    const overlay = event.target;
    if (!(overlay instanceof HTMLElement) || !overlay.matches(TRANSIENT_OVERLAY_SELECTOR)) return;

    const state = (event as PopoverToggleEvent).newState;
    const isOpening =
      state === 'open' || (state === undefined && !overlay.matches(':popover-open'));
    if (!isOpening) return;

    closeTransientOverlays(overlay);
    activeOverlay = overlay;
  },
  true,
);

runtime.listen(
  document,
  'toggle',
  (event) => {
    const overlay = event.target;
    if (!(overlay instanceof HTMLElement) || !overlay.matches(TRANSIENT_OVERLAY_SELECTOR)) return;

    if (overlay.matches(':popover-open')) {
      activeOverlay = overlay;
      syncInvokers(overlay, true);
      scheduleValidation();
    } else if (activeOverlay === overlay) {
      syncInvokers(overlay, false);
      activeOverlay = undefined;
    } else {
      syncInvokers(overlay, false);
    }
  },
  true,
);

runtime.listen(window, 'resize', scheduleValidation);
runtime.listen(window, 'orientationchange', scheduleValidation);

runtime.listen(document, 'astro:before-preparation', () => {
  closeTransientOverlays();
});

runtime.listen(document, 'astro:before-swap', () => {
  closeTransientOverlays();
  activeOverlay = undefined;
});

runtime.listen(document, 'astro:page-load', () => {
  activeOverlay = undefined;
  closeTransientOverlays();
});

runtime.onDispose(() => {
  if (validationFrame !== undefined) window.cancelAnimationFrame(validationFrame);
  validationFrame = undefined;
  closeTransientOverlays();
  activeOverlay = undefined;
});
