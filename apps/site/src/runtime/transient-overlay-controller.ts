import { rethrowAfterCleanup, runCleanups } from './cleanup';

const TRANSIENT_OVERLAY_SELECTOR = '[data-transient-overlay]';

type PopoverToggleEvent = Event & {
  newState?: 'open' | 'closed';
};

function isPopoverOpen(overlay: HTMLElement): boolean {
  try {
    return overlay.matches(':popover-open');
  } catch {
    return false;
  }
}

/**
 * Owns lifecycle rules shared by non-modal, temporary popovers. Native Popover
 * keeps light-dismiss and keyboard behavior; this controller only supplies the
 * cross-component boundaries the platform cannot infer.
 */
export function installTransientOverlayController(
  sourceDocument: Document = document,
  sourceWindow: Window = window,
): { closeForNavigation(): void; dispose(): void } {
  const listeners = new AbortController();
  const openingInvokers = new WeakMap<HTMLElement, HTMLElement>();
  const pendingFocusRestoration = new WeakSet<HTMLElement>();
  let validationFrame = 0;
  let disposed = false;

  const overlays = (): HTMLElement[] =>
    Array.from(sourceDocument.querySelectorAll<HTMLElement>(TRANSIENT_OVERLAY_SELECTOR));

  const isRendered = (element: HTMLElement): boolean => {
    if (!element.isConnected || element.getClientRects().length === 0) return false;
    const style = sourceWindow.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  };

  const lacksUsableFocus = (element: Element | null): boolean =>
    !(element instanceof HTMLElement) ||
    element === sourceDocument.body ||
    element === sourceDocument.documentElement ||
    !isRendered(element);

  const invokersFor = (overlay: HTMLElement): HTMLElement[] => {
    if (!overlay.id) return [];
    return Array.from(sourceDocument.querySelectorAll<HTMLElement>('[popovertarget]')).filter(
      (candidate) => candidate.getAttribute('popovertarget') === overlay.id,
    );
  };

  const visibleInvokerFor = (overlay: HTMLElement): HTMLElement | undefined => {
    const openingInvoker = openingInvokers.get(overlay);
    if (openingInvoker && isRendered(openingInvoker)) return openingInvoker;
    return invokersFor(overlay).find(isRendered);
  };

  const focusFallback = (overlay: HTMLElement): void => {
    const target =
      visibleInvokerFor(overlay) ??
      sourceDocument.querySelector<HTMLElement>('[data-site-identity]') ??
      sourceDocument.querySelector<HTMLElement>('#main-content');
    if (target && isRendered(target)) target.focus({ preventScroll: true });
  };

  const closeOverlay = (overlay: HTMLElement, restoreInvalidFocus: boolean): void => {
    if (!isPopoverOpen(overlay)) return;
    const activeElement = sourceDocument.activeElement;
    const focusWillBeInvalid = overlay.contains(activeElement) || lacksUsableFocus(activeElement);

    try {
      overlay.hidePopover();
    } catch {}

    if (restoreInvalidFocus && focusWillBeInvalid) pendingFocusRestoration.add(overlay);
  };

  const closeAll = (restoreInvalidFocus: boolean, except?: HTMLElement): void => {
    for (const overlay of overlays()) {
      if (overlay !== except) closeOverlay(overlay, restoreInvalidFocus);
    }
  };

  const validateOpenOverlays = (): void => {
    validationFrame = 0;
    for (const overlay of overlays()) {
      if (isPopoverOpen(overlay) && !visibleInvokerFor(overlay)) closeOverlay(overlay, true);
    }
  };

  const scheduleValidation = (): void => {
    if (validationFrame !== 0) return;
    validationFrame = sourceWindow.requestAnimationFrame(validateOpenOverlays);
  };

  const handleBeforeToggle = (rawEvent: Event): void => {
    const overlay = rawEvent.target;
    if (!(overlay instanceof HTMLElement) || !overlay.matches(TRANSIENT_OVERLAY_SELECTOR)) return;

    const event = rawEvent as PopoverToggleEvent;
    const opening = event.newState === 'open' || (!event.newState && !isPopoverOpen(overlay));
    if (!opening) return;

    const activeElement = sourceDocument.activeElement;
    if (
      activeElement instanceof HTMLElement &&
      activeElement.getAttribute('popovertarget') === overlay.id
    ) {
      openingInvokers.set(overlay, activeElement);
    }
    closeAll(false, overlay);
  };

  const handleToggle = (rawEvent: Event): void => {
    const overlay = rawEvent.target;
    if (!(overlay instanceof HTMLElement) || !overlay.matches(TRANSIENT_OVERLAY_SELECTOR)) return;
    const open = isPopoverOpen(overlay);
    overlay.toggleAttribute('data-open', open);
    const invoker = visibleInvokerFor(overlay);
    const label = open ? invoker?.dataset.closeLabel : invoker?.dataset.openLabel;
    if (invoker && label) {
      invoker.ariaLabel = label;
      invoker.title = label;
    }
    if (open) {
      scheduleValidation();
      return;
    }

    if (pendingFocusRestoration.delete(overlay)) {
      const activeElement = sourceDocument.activeElement;
      if (lacksUsableFocus(activeElement)) focusFallback(overlay);
    }
  };

  const closeForNavigation = (): void => {
    if (!disposed) closeAll(true);
  };

  const controller = {
    closeForNavigation,
    dispose() {
      if (disposed) return;
      disposed = true;
      const frame = validationFrame;
      validationFrame = 0;
      runCleanups(
        () => listeners.abort(),
        () => {
          if (frame !== 0) sourceWindow.cancelAnimationFrame(frame);
        },
        () => closeAll(false),
      );
    },
  };

  try {
    sourceDocument.addEventListener('beforetoggle', handleBeforeToggle, {
      capture: true,
      signal: listeners.signal,
    });
    sourceDocument.addEventListener('toggle', handleToggle, {
      capture: true,
      signal: listeners.signal,
    });
    sourceWindow.addEventListener('resize', scheduleValidation, { signal: listeners.signal });
    sourceWindow.addEventListener('orientationchange', scheduleValidation, {
      signal: listeners.signal,
    });
    return controller;
  } catch (error) {
    rethrowAfterCleanup(error, controller.dispose);
  }
}
