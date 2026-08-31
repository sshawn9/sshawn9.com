export {};

const ELEMENT_NAME = 'interactive-figure-status';

type FigureStatus = 'fallback' | 'loading' | 'ready' | 'error';

class InteractiveFigureStatus extends HTMLElement {
  #island: HTMLElement | undefined;

  #handleHydrationError = (): void => {
    this.dataset.state = 'error';
  };

  static get observedAttributes(): string[] {
    return ['data-state'];
  }

  connectedCallback(): void {
    const figure = this.closest<HTMLElement>('[data-figure-focus]');
    this.#island = figure?.querySelector<HTMLElement>('astro-island') ?? undefined;
    this.#island?.addEventListener('astro:hydration-error', this.#handleHydrationError);

    if (this.dataset.state !== 'ready' && this.dataset.state !== 'error') {
      this.dataset.state = 'loading';
    } else {
      this.#render();
    }
  }

  disconnectedCallback(): void {
    this.#island?.removeEventListener('astro:hydration-error', this.#handleHydrationError);
    this.#island = undefined;
  }

  attributeChangedCallback(): void {
    this.#render();
  }

  #render(): void {
    const message = this.querySelector<HTMLElement>('[data-interactive-figure-status-message]');
    if (!message) return;

    const state = (this.dataset.state ?? 'fallback') as FigureStatus;
    if (state === 'ready') {
      message.hidden = true;
      return;
    }

    message.hidden = false;
    message.setAttribute('role', state === 'error' ? 'alert' : 'status');
    const label = state === 'error' ? this.dataset.errorLabel : this.dataset.loadingLabel;
    if (label) message.textContent = label;
  }
}

export function defineInteractiveFigureStatus(): void {
  if (!customElements.get(ELEMENT_NAME)) {
    customElements.define(ELEMENT_NAME, InteractiveFigureStatus);
  }
}
