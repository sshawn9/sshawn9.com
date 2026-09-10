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

/** Keeps navigation readiness separate from delayed, anti-flicker presentation. */
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
    this.#clock.clearTimeout(this.#finishTimer);
    this.#finishTimer = undefined;
    // Transfer a continuous wait's deadline or already-visible bar. Once the
    // old bar is fading/idle, a new wait gets a fresh presentation.
    const phase = this.#state.phase === 'active' ? 'active' : 'idle';
    this.#publish({ pending: true, phase, href });
    if (phase === 'idle' && this.#showTimer === undefined) {
      this.#showTimer = this.#clock.setTimeout(() => {
        this.#showTimer = undefined;
        this.#shownAt = this.#clock.now();
        // This timer belongs to the waiting interval, not its first navigation.
        this.#publish({ ...this.#state, phase: 'active' });
      }, NAVIGATION_SHOW_DELAY_MS);
    }
    return revision;
  }

  /** Resource-ready navigation must not first light the bar during its fade. */
  prepared(revision: number): void {
    if (revision !== this.#revision) return;
    this.#clock.clearTimeout(this.#showTimer);
    this.#showTimer = undefined;
  }

  finish(revision: number): void {
    if (revision !== this.#revision || !this.#state.pending) return;
    this.prepared(revision);
    if (this.#state.phase === 'idle') {
      this.#reset(revision);
      return;
    }

    // Content and aria-busy finish now; only the visible bar stays for its minimum.
    this.#publish({ ...this.#state, pending: false });
    const remaining = Math.max(0, NAVIGATION_MIN_VISIBLE_MS - (this.#clock.now() - this.#shownAt));
    this.#finishTimer = this.#clock.setTimeout(() => {
      if (revision !== this.#revision) return;
      this.#publish({ ...this.#state, phase: 'finishing' });
      this.#finishTimer = this.#clock.setTimeout(() => this.#reset(revision), NAVIGATION_FADE_MS);
    }, remaining);
  }

  cancel(revision: number): void {
    this.#reset(revision);
  }

  dispose(): void {
    this.#reset(++this.#revision);
  }

  #publish(state: NavigationFeedbackState): void {
    this.#state = state;
    this.#reflect(state);
  }

  #reset(revision: number): void {
    if (revision !== this.#revision) return;
    this.#clock.clearTimeout(this.#showTimer);
    this.#clock.clearTimeout(this.#finishTimer);
    this.#showTimer = undefined;
    this.#finishTimer = undefined;
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

/** Initial font preparation and navigation can overlap; neither clears the other. */
export function reflectPageBusy(targetDocument: Document): void {
  const root = targetDocument.documentElement;
  const pending =
    root.dataset.fontState === 'loading' || root.hasAttribute('data-navigation-pending');
  const main = targetDocument.querySelector('main');
  if (pending) main?.setAttribute('aria-busy', 'true');
  else main?.removeAttribute('aria-busy');
}

export function reflectNavigationFeedback(
  targetDocument: Document,
  state: NavigationFeedbackState,
): void {
  const root = targetDocument.documentElement;
  root.toggleAttribute('data-navigation-pending', state.pending);
  if (state.phase === 'idle') root.removeAttribute('data-navigation-progress');
  else root.dataset.navigationProgress = state.phase;
  reflectPageBusy(targetDocument);
}
