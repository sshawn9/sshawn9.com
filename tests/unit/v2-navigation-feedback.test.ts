import { describe, expect, it } from 'vitest';
import {
  NAVIGATION_FADE_MS,
  NAVIGATION_MIN_VISIBLE_MS,
  NAVIGATION_SHOW_DELAY_MS,
  NavigationFeedback,
  type NavigationFeedbackClock,
  type NavigationFeedbackState,
} from '../../apps/site-v2/src/runtime/navigation-feedback';

class ManualClock implements NavigationFeedbackClock {
  #nextHandle = 1;
  #time = 0;
  #tasks = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.#time;
  }

  setTimeout(callback: () => void, delay: number): number {
    const handle = this.#nextHandle++;
    this.#tasks.set(handle, { at: this.#time + delay, callback });
    return handle;
  }

  clearTimeout(handle: number | undefined): void {
    if (handle !== undefined) this.#tasks.delete(handle);
  }

  advance(duration: number): void {
    const target = this.#time + duration;
    while (true) {
      const next = [...this.#tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      this.#tasks.delete(next[0]);
      this.#time = next[1].at;
      next[1].callback();
    }
    this.#time = target;
  }
}

describe('v2 navigation feedback', () => {
  it('does not flash for a navigation that finishes before the show delay', () => {
    const clock = new ManualClock();
    const states: NavigationFeedbackState[] = [];
    const feedback = new NavigationFeedback(clock, (state) => states.push({ ...state }));
    const id = feedback.begin('https://example.com/en/blog/');

    clock.advance(NAVIGATION_SHOW_DELAY_MS - 1);
    feedback.finish(id);
    clock.advance(NAVIGATION_SHOW_DELAY_MS + NAVIGATION_FADE_MS);

    expect(states).toEqual([
      { pending: true, phase: 'idle', href: 'https://example.com/en/blog/' },
      { pending: false, phase: 'idle' },
    ]);
  });

  it('keeps a shown indicator stable for its minimum duration and fade', () => {
    const clock = new ManualClock();
    const states: NavigationFeedbackState[] = [];
    const feedback = new NavigationFeedback(clock, (state) => states.push({ ...state }));
    const id = feedback.begin('https://example.com/en/blog/');

    clock.advance(NAVIGATION_SHOW_DELAY_MS);
    clock.advance(20);
    feedback.finish(id);
    expect(feedback.current()).toMatchObject({ pending: false, phase: 'active' });

    clock.advance(NAVIGATION_MIN_VISIBLE_MS - 20);
    expect(feedback.current().phase).toBe('finishing');
    clock.advance(NAVIGATION_FADE_MS);
    expect(feedback.current()).toEqual({ pending: false, phase: 'idle' });
  });

  it('ignores late completion from a superseded navigation', () => {
    const clock = new ManualClock();
    const feedback = new NavigationFeedback(clock, () => {});
    const first = feedback.begin('https://example.com/first');
    const second = feedback.begin('https://example.com/second');

    feedback.finish(first);
    expect(feedback.current().href).toBe('https://example.com/second');
    feedback.cancel(second);
    expect(feedback.current()).toEqual({ pending: false, phase: 'idle' });
  });

  it('clears pending timers and visible state when its document runtime is disposed', () => {
    const clock = new ManualClock();
    const states: NavigationFeedbackState[] = [];
    const feedback = new NavigationFeedback(clock, (state) => states.push({ ...state }));
    feedback.begin('https://example.com/en/blog/');

    feedback.dispose();
    clock.advance(NAVIGATION_SHOW_DELAY_MS + NAVIGATION_MIN_VISIBLE_MS + NAVIGATION_FADE_MS);

    expect(feedback.current()).toEqual({ pending: false, phase: 'idle' });
    expect(states.at(-1)).toEqual({ pending: false, phase: 'idle' });
  });
});
