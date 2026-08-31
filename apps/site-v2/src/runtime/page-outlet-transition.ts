import type { TransitionBeforeSwapEvent } from 'astro:transitions/client';

export const PAGE_OUTLET_FADE_MS = 180;

const OUTLET_SELECTOR = '.page-outlet';
const ENTERING_ATTRIBUTE = 'data-page-outlet-entering';
const LEAVING_ATTRIBUTE = 'data-page-outlet-leaving';

type OwnedAnimation = {
  element: HTMLElement;
  animation: Animation;
};

/**
 * Keeps page motion on the live outlet instead of a full-height transition
 * snapshot. A tall snapshot changes geometry when the target page is shorter,
 * which can expose the outgoing page's top while leaving a deep scroll.
 */
export class PageOutletTransition {
  readonly #document: Document;
  readonly #window: Window;
  readonly #reducedMotion: MediaQueryList;
  #leaving?: OwnedAnimation;
  #entering?: OwnedAnimation;
  #enterAfterSwap = false;

  constructor(sourceDocument: Document, sourceWindow: Window) {
    this.#document = sourceDocument;
    this.#window = sourceWindow;
    this.#reducedMotion = sourceWindow.matchMedia('(prefers-reduced-motion: reduce)');
  }

  /** Runs only after the target document and its required assets are ready. */
  async prepareOutgoing(signal: AbortSignal): Promise<void> {
    if (signal.aborted || this.#reducedMotion.matches) return;

    this.#finishEnteringForExit();
    this.#cancelLeaving();
    const outlet = this.#document.querySelector<HTMLElement>(OUTLET_SELECTOR);
    if (!outlet || typeof outlet.animate !== 'function') return;

    const initialOpacity = this.#window.getComputedStyle(outlet).opacity;
    outlet.style.opacity = initialOpacity;
    outlet.setAttribute(LEAVING_ATTRIBUTE, '');
    const animation = outlet.animate([{ opacity: initialOpacity }, { opacity: 0 }], {
      duration: PAGE_OUTLET_FADE_MS,
      easing: 'ease',
      fill: 'forwards',
    });
    const owned = { element: outlet, animation };
    this.#leaving = owned;
    const cancel = (): void => animation.cancel();
    signal.addEventListener('abort', cancel, { once: true });

    try {
      await animation.finished;
      if (!signal.aborted && this.#leaving === owned) this.#enterAfterSwap = true;
    } catch {
      // Cancellation restores the still-current page below.
    } finally {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted && this.#leaving === owned) this.#cancelLeaving();
    }
  }

  prepareSwap(event: TransitionBeforeSwapEvent): void {
    if (!this.#enterAfterSwap) return;
    const targetOutlet = event.newDocument.querySelector<HTMLElement>(OUTLET_SELECTOR);
    if (!targetOutlet) {
      this.#enterAfterSwap = false;
      return;
    }
    targetOutlet.style.opacity = '0';
    targetOutlet.setAttribute(ENTERING_ATTRIBUTE, '');
  }

  enterTarget(): void {
    this.#releaseLeavingAfterSwap();
    if (!this.#enterAfterSwap) return;
    this.#enterAfterSwap = false;

    const outlet = this.#document.querySelector<HTMLElement>(
      `${OUTLET_SELECTOR}[${ENTERING_ATTRIBUTE}]`,
    );
    if (!outlet) return;
    if (typeof outlet.animate !== 'function') {
      this.#resetElement(outlet, ENTERING_ATTRIBUTE);
      return;
    }
    const animation = outlet.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: PAGE_OUTLET_FADE_MS,
      easing: 'ease',
      fill: 'forwards',
    });
    const owned = { element: outlet, animation };
    this.#entering = owned;
    void animation.finished
      .catch(() => undefined)
      .then(() => {
        if (this.#entering !== owned) return;
        this.#entering = undefined;
        this.#resetElement(outlet, ENTERING_ATTRIBUTE);
        animation.cancel();
      });
  }

  cancel(): void {
    this.#enterAfterSwap = false;
    this.#cancelLeaving();
    this.#cancelEntering();
  }

  dispose(): void {
    this.cancel();
  }

  #finishEnteringForExit(): void {
    const owned = this.#entering;
    if (!owned) return;
    const opacity = this.#window.getComputedStyle(owned.element).opacity;
    owned.animation.cancel();
    this.#entering = undefined;
    owned.element.style.opacity = opacity;
    owned.element.removeAttribute(ENTERING_ATTRIBUTE);
  }

  #cancelEntering(): void {
    const owned = this.#entering;
    if (!owned) return;
    owned.animation.cancel();
    this.#entering = undefined;
    this.#resetElement(owned.element, ENTERING_ATTRIBUTE);
  }

  #cancelLeaving(): void {
    const owned = this.#leaving;
    if (!owned) return;
    owned.animation.cancel();
    this.#leaving = undefined;
    this.#resetElement(owned.element, LEAVING_ATTRIBUTE);
  }

  #releaseLeavingAfterSwap(): void {
    const owned = this.#leaving;
    if (!owned) return;
    owned.animation.cancel();
    this.#leaving = undefined;
    this.#resetElement(owned.element, LEAVING_ATTRIBUTE);
  }

  #resetElement(element: HTMLElement, attribute: string): void {
    element.style.removeProperty('opacity');
    element.removeAttribute(attribute);
  }
}
