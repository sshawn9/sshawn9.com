import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  NavigationFeedback,
  NAVIGATION_SHOW_DELAY_MS,
  type NavigationFeedbackState,
} from '../../../apps/site/src/runtime/navigation-feedback';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function feedback() {
  const states: NavigationFeedbackState[] = [];
  const subject = new NavigationFeedback(
    {
      now: () => Date.now(),
      setTimeout: (callback, delay) => setTimeout(callback, delay) as unknown as number,
      clearTimeout: (handle) => clearTimeout(handle),
    },
    (state) => states.push(state),
  );
  return { subject, states };
}

test('a fast navigation finishes without flashing delayed progress', () => {
  const { subject, states } = feedback();
  subject.finish(subject.begin('/en/blog/'));
  vi.runAllTimers();
  expect(states.every((state) => state.phase === 'idle')).toBe(true);
  expect(subject.current()).toEqual({ pending: false, phase: 'idle' });
  expect(vi.getTimerCount()).toBe(0);
});

test('stale completion and cancellation cannot clear a newer navigation', () => {
  const { subject } = feedback();
  const old = subject.begin('/en/blog/');
  vi.advanceTimersByTime(NAVIGATION_SHOW_DELAY_MS);
  subject.finish(old);
  const current = subject.begin('/en/projects/');
  subject.finish(old);
  subject.cancel(old);
  vi.runAllTimers();
  expect(subject.current()).toEqual({ pending: true, phase: 'active', href: '/en/projects/' });
  subject.finish(current);
  vi.runAllTimers();
  expect(subject.current()).toEqual({ pending: false, phase: 'idle' });
  expect(vi.getTimerCount()).toBe(0);
});

test.each(['cancel', 'dispose'] as const)(
  '%s removes pending feedback and its timers',
  (action) => {
    const { subject, states } = feedback();
    const revision = subject.begin('/en/blog/');
    vi.advanceTimersByTime(NAVIGATION_SHOW_DELAY_MS);
    subject.finish(revision);
    if (action === 'cancel') subject.cancel(revision);
    else subject.dispose();
    const count = states.length;
    vi.runAllTimers();
    expect(states).toHaveLength(count);
    expect(subject.current()).toEqual({ pending: false, phase: 'idle' });
    expect(vi.getTimerCount()).toBe(0);
  },
);
