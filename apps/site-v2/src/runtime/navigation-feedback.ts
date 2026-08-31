export const NAVIGATION_SHOW_DELAY_MS = 120;
export const NAVIGATION_MIN_VISIBLE_MS = 240;
export const NAVIGATION_FADE_MS = 120;

export type NavigationFeedbackState = {
  pending: boolean;
  phase: 'idle' | 'active' | 'finishing';
  href?: string;
};

export type NavigationFeedbackClock = {
  now(): number;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(handle: number | undefined): void;
};

const IDLE_STATE: NavigationFeedbackState = { pending: false, phase: 'idle' };

export class NavigationFeedback {
  readonly #clock: NavigationFeedbackClock;
  readonly #reflect: (state: NavigationFeedbackState) => void;
  #revision = 0;
  #shownAt = 0;
  #showTimer: number | undefined;
  #finishTimer: number | undefined;
  #state = IDLE_STATE;

  constructor(clock: NavigationFeedbackClock, reflect: (state: NavigationFeedbackState) => void) {
    this.#clock = clock;
    this.#reflect = reflect;
  }

  current(): NavigationFeedbackState {
    return this.#state;
  }

  begin(href: string): number {
    const revision = ++this.#revision;
    this.#clearTimers();
    this.#shownAt = 0;
    this.#publish({ pending: true, phase: 'idle', href });
    this.#showTimer = this.#clock.setTimeout(() => {
      if (revision !== this.#revision) return;
      this.#shownAt = this.#clock.now();
      this.#publish({ pending: true, phase: 'active', href });
    }, NAVIGATION_SHOW_DELAY_MS);
    return revision;
  }

  finish(revision: number): void {
    if (revision !== this.#revision) return;

    this.#clock.clearTimeout(this.#showTimer);
    this.#showTimer = undefined;
    if (this.#state.phase !== 'active') {
      this.#reset(revision);
      return;
    }

    this.#publish({ ...this.#state, pending: false });
    const remaining = Math.max(0, NAVIGATION_MIN_VISIBLE_MS - (this.#clock.now() - this.#shownAt));
    this.#finishTimer = this.#clock.setTimeout(() => {
      if (revision !== this.#revision) return;
      this.#publish({ ...this.#state, phase: 'finishing' });
      this.#finishTimer = this.#clock.setTimeout(() => this.#reset(revision), NAVIGATION_FADE_MS);
    }, remaining);
  }

  cancel(revision: number): void {
    if (revision === this.#revision) this.#reset(revision);
  }

  dispose(): void {
    this.#revision += 1;
    this.#clearTimers();
    this.#shownAt = 0;
    this.#publish(IDLE_STATE);
  }

  #publish(state: NavigationFeedbackState): void {
    this.#state = state;
    this.#reflect(state);
  }

  #clearTimers(): void {
    this.#clock.clearTimeout(this.#showTimer);
    this.#clock.clearTimeout(this.#finishTimer);
    this.#showTimer = undefined;
    this.#finishTimer = undefined;
  }

  #reset(revision: number): void {
    if (revision !== this.#revision) return;
    this.#clearTimers();
    this.#shownAt = 0;
    this.#publish(IDLE_STATE);
  }
}

export function createBrowserFeedbackClock(sourceWindow: Window): NavigationFeedbackClock {
  return {
    now: () => sourceWindow.performance.now(),
    setTimeout: (callback, delay) => sourceWindow.setTimeout(callback, delay),
    clearTimeout: (handle) => sourceWindow.clearTimeout(handle),
  };
}

export function reflectNavigationFeedback(
  targetDocument: Document,
  state: NavigationFeedbackState,
): void {
  const root = targetDocument.documentElement;
  root.toggleAttribute('data-navigation-pending', state.pending);
  if (state.phase === 'idle') root.removeAttribute('data-navigation-progress');
  else root.dataset.navigationProgress = state.phase;

  const main = targetDocument.querySelector('main');
  if (state.pending) main?.setAttribute('aria-busy', 'true');
  else main?.removeAttribute('aria-busy');
}
