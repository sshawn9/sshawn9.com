type FocusState = {
  figure: HTMLElement;
  parent: Node;
  nextSibling: Node | null;
  placeholder: HTMLElement;
  scrollX: number;
  scrollY: number;
};

const ELEMENT_NAME = 'figure-focus-controller';

class FigureFocusController extends HTMLElement {
  #dialog: HTMLDialogElement | undefined;
  #state: FocusState | undefined;
  #active = false;

  #handleClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element) || !this.#dialog) return;

    if (target === this.#dialog) {
      this.#restoreFigure();
      return;
    }

    const toggle = target.closest<HTMLButtonElement>('[data-figure-focus-toggle]');
    const figure = toggle?.closest<HTMLElement>('[data-figure-focus]');
    if (!toggle || !figure || toggle.getAttribute('aria-controls') !== this.#dialog.id) {
      return;
    }

    if (figure.hasAttribute('data-focus-active')) this.#restoreFigure();
    else this.#openFigure(figure);
  };

  #handleClose = (): void => this.#restoreFigure();
  #handleBeforeSwap = (): void => this.#restoreFigure(false);

  connectedCallback(): void {
    if (this.#active) return;
    const dialog = this.querySelector<HTMLDialogElement>('[data-figure-focus-dialog]');
    if (!dialog) return;

    this.#active = true;
    this.#dialog = dialog;
    dialog.addEventListener('close', this.#handleClose);
    this.ownerDocument.addEventListener('click', this.#handleClick);
    this.ownerDocument.addEventListener('astro:before-preparation', this.#handleBeforeSwap);
    this.ownerDocument.addEventListener('astro:before-swap', this.#handleBeforeSwap);
  }

  disconnectedCallback(): void {
    if (!this.#active) return;
    this.#restoreFigure(false);
    this.#dialog?.removeEventListener('close', this.#handleClose);
    this.ownerDocument.removeEventListener('click', this.#handleClick);
    this.ownerDocument.removeEventListener('astro:before-preparation', this.#handleBeforeSwap);
    this.ownerDocument.removeEventListener('astro:before-swap', this.#handleBeforeSwap);
    this.#dialog = undefined;
    this.#active = false;
  }

  #updateToggle(figure: HTMLElement, expanded: boolean): HTMLButtonElement | null {
    const toggle = figure.querySelector<HTMLButtonElement>('[data-figure-focus-toggle]');
    if (!toggle) return null;
    const label = expanded ? toggle.dataset.collapseLabel : toggle.dataset.expandLabel;
    toggle.setAttribute('aria-pressed', String(expanded));
    if (label) {
      toggle.setAttribute('aria-label', label);
      toggle.title = label;
    }
    return toggle;
  }

  #restorePagePosition(state: FocusState): void {
    window.scrollTo(state.scrollX, state.scrollY);
    requestAnimationFrame(() => window.scrollTo(state.scrollX, state.scrollY));
  }

  #restoreFigure(restoreFocus = true): void {
    const dialog = this.#dialog;
    const state = this.#state;
    if (!dialog || !state) {
      this.ownerDocument.documentElement.removeAttribute('data-figure-focus-open');
      if (dialog?.open) dialog.close();
      return;
    }

    this.#state = undefined;
    const { figure, parent, nextSibling, placeholder } = state;
    if (placeholder.isConnected) placeholder.replaceWith(figure);
    else {
      const reference = nextSibling?.parentNode === parent ? nextSibling : null;
      parent.insertBefore(figure, reference);
    }
    figure.removeAttribute('data-focus-active');
    const toggle = this.#updateToggle(figure, false);
    this.ownerDocument.documentElement.removeAttribute('data-figure-focus-open');
    if (dialog.open) dialog.close();
    this.#restorePagePosition(state);
    if (restoreFocus) requestAnimationFrame(() => toggle?.focus({ preventScroll: true }));
  }

  #openFigure(figure: HTMLElement): void {
    const dialog = this.#dialog;
    const stage = dialog?.querySelector<HTMLElement>('[data-figure-focus-stage]');
    if (!dialog || !stage || dialog.open) return;

    // Capture the page before inserting the placeholder. Scroll anchoring may
    // compensate while the placeholder and live figure briefly coexist.
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const placeholder = this.ownerDocument.createElement('div');
    const figureStyle = getComputedStyle(figure);
    placeholder.className = 'frenet-figure-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.style.height = `${figure.getBoundingClientRect().height}px`;
    placeholder.style.marginBlockStart = figureStyle.marginBlockStart;
    placeholder.style.marginBlockEnd = figureStyle.marginBlockEnd;
    figure.before(placeholder);
    this.#state = {
      figure,
      parent: figure.parentNode!,
      nextSibling: figure.nextSibling,
      placeholder,
      scrollX,
      scrollY,
    };
    stage.append(figure);
    figure.setAttribute('data-focus-active', '');
    this.#updateToggle(figure, true);
    this.ownerDocument.documentElement.setAttribute('data-figure-focus-open', '');
    dialog.showModal();
    this.#restorePagePosition(this.#state);
  }
}

export function defineFigureFocusController(): void {
  if (!customElements.get(ELEMENT_NAME)) {
    customElements.define(ELEMENT_NAME, FigureFocusController);
  }
}
