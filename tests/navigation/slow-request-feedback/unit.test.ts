import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  NAVIGATION_FADE_MS,
  NAVIGATION_MIN_VISIBLE_MS,
  NAVIGATION_SHOW_DELAY_MS,
  NavigationFeedback,
  type NavigationFeedbackState,
} from '../../../apps/site/src/runtime/navigation-feedback';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

function feedback() {
  const states: NavigationFeedbackState[] = [];
  const subject = new NavigationFeedback(
    {
      now: () => Date.now(),
      setTimeout: (callback, delay) => setTimeout(callback, delay) as unknown as number,
      clearTimeout: (handle) => clearTimeout(handle),
    },
    (state) => states.push({ ...state }),
  );
  return { subject, states };
}

test('a fast navigation becomes busy immediately but never flashes progress', () => {
  const { subject, states } = feedback();
  const revision = subject.begin('/en/blog/');

  expect(subject.current()).toEqual({ pending: true, phase: 'idle', href: '/en/blog/' });
  vi.advanceTimersByTime(NAVIGATION_SHOW_DELAY_MS - 1);
  subject.finish(revision);
  vi.runAllTimers();
  expect(states.every((state) => state.phase === 'idle')).toBe(true);
  expect(subject.current()).toEqual({ pending: false, phase: 'idle' });
  expect(vi.getTimerCount()).toBe(0);
});

test('prepared resources cancel a delayed show without pretending the navigation has committed', () => {
  const { subject, states } = feedback();
  const revision = subject.begin('/en/blog/');
  vi.advanceTimersByTime(NAVIGATION_SHOW_DELAY_MS - 1);
  subject.prepared(revision);

  // Even a long outgoing animation or script settling phase must not start progress.
  vi.advanceTimersByTime(1_000);
  expect(subject.current()).toEqual({ pending: true, phase: 'idle', href: '/en/blog/' });
  subject.finish(revision);
  expect(states.every((state) => state.phase === 'idle')).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test('a shown bar keeps its minimum and fades without delaying the real completion', () => {
  const { subject } = feedback();
  const revision = subject.begin('/en/blog/');
  vi.advanceTimersByTime(NAVIGATION_SHOW_DELAY_MS - 1);
  expect(subject.current().phase).toBe('idle');
  vi.advanceTimersByTime(1);
  expect(subject.current().phase).toBe('active');

  subject.prepared(revision);
  subject.finish(revision);
  expect(subject.current().pending).toBe(false);
  vi.advanceTimersByTime(NAVIGATION_MIN_VISIBLE_MS - 1);
  expect(subject.current().phase).toBe('active');
  vi.advanceTimersByTime(1);
  expect(subject.current().phase).toBe('finishing');
  vi.advanceTimersByTime(NAVIGATION_FADE_MS - 1);
  expect(subject.current().phase).toBe('finishing');
  vi.advanceTimersByTime(1);
  expect(subject.current()).toEqual({ pending: false, phase: 'idle' });
  expect(vi.getTimerCount()).toBe(0);
});

test('a replacement inherits the existing show deadline and ignores the old task', () => {
  const { subject, states } = feedback();
  const first = subject.begin('/en/blog/');
  vi.advanceTimersByTime(80);
  const second = subject.begin('/en/projects/');

  subject.prepared(first);
  subject.finish(first);
  subject.cancel(first);
  vi.advanceTimersByTime(NAVIGATION_SHOW_DELAY_MS - 80 - 1);
  expect(subject.current().phase).toBe('idle');
  vi.advanceTimersByTime(1);
  expect(subject.current()).toEqual({ pending: true, phase: 'active', href: '/en/projects/' });
  expect(states.filter((state) => !state.pending)).toHaveLength(0);
  subject.cancel(second);
  expect(vi.getTimerCount()).toBe(0);
});

test('a replacement keeps an already-visible bar and its original minimum deadline', () => {
  const { subject, states } = feedback();
  const first = subject.begin('/en/blog/');
  vi.advanceTimersByTime(NAVIGATION_SHOW_DELAY_MS + 80);
  const beforeReplacement = states.length;
  const second = subject.begin('/en/projects/');
  subject.prepared(first);
  subject.finish(first);
  subject.cancel(first);
  expect(states.slice(beforeReplacement).every((state) => state.phase === 'active')).toBe(true);

  subject.finish(second);
  expect(subject.current().pending).toBe(false);
  vi.advanceTimersByTime(NAVIGATION_MIN_VISIBLE_MS - 80);
  expect(subject.current().phase).toBe('finishing');
  vi.advanceTimersByTime(NAVIGATION_FADE_MS);
  expect(subject.current().phase).toBe('idle');
});

test('a new wait after resource preparation gets a fresh show deadline', () => {
  const { subject } = feedback();
  const first = subject.begin('/en/blog/');
  subject.prepared(first);
  vi.advanceTimersByTime(100);
  const second = subject.begin('/en/projects/');
  vi.advanceTimersByTime(NAVIGATION_SHOW_DELAY_MS - 1);
  expect(subject.current().phase).toBe('idle');
  vi.advanceTimersByTime(1);
  expect(subject.current().phase).toBe('active');
  subject.cancel(second);
});

test('taking over the visible completion tail cancels its stale cleanup timer', () => {
  const { subject } = feedback();
  const first = subject.begin('/en/blog/');
  vi.advanceTimersByTime(NAVIGATION_SHOW_DELAY_MS);
  subject.finish(first);
  const second = subject.begin('/en/projects/');
  vi.advanceTimersByTime(NAVIGATION_MIN_VISIBLE_MS + NAVIGATION_FADE_MS);
  expect(subject.current()).toEqual({ pending: true, phase: 'active', href: '/en/projects/' });
  subject.cancel(second);
});

test('a navigation starting during finishing gets a fresh delay and minimum active time', () => {
  const { subject } = feedback();
  const first = subject.begin('/en/blog/');
  vi.advanceTimersByTime(NAVIGATION_SHOW_DELAY_MS);
  subject.finish(first);
  vi.advanceTimersByTime(NAVIGATION_MIN_VISIBLE_MS);
  vi.advanceTimersByTime(NAVIGATION_FADE_MS / 2);
  expect(subject.current()).toEqual({
    pending: false,
    phase: 'finishing',
    href: '/en/blog/',
  });

  const second = subject.begin('/en/projects/');
  expect(subject.current()).toEqual({
    pending: true,
    phase: 'idle',
    href: '/en/projects/',
  });
  expect(vi.getTimerCount()).toBe(1);

  // A's old fade cleanup would fire here; only B's fresh show timer may remain.
  vi.advanceTimersByTime(NAVIGATION_FADE_MS / 2);
  expect(subject.current()).toEqual({
    pending: true,
    phase: 'idle',
    href: '/en/projects/',
  });
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(NAVIGATION_SHOW_DELAY_MS - NAVIGATION_FADE_MS / 2 - 1);
  expect(subject.current().phase).toBe('idle');
  vi.advanceTimersByTime(1);
  expect(subject.current()).toEqual({
    pending: true,
    phase: 'active',
    href: '/en/projects/',
  });

  subject.finish(second);
  vi.advanceTimersByTime(NAVIGATION_MIN_VISIBLE_MS - 1);
  expect(subject.current().phase).toBe('active');
  vi.advanceTimersByTime(1);
  expect(subject.current().phase).toBe('finishing');
  vi.advanceTimersByTime(NAVIGATION_FADE_MS);
  expect(subject.current()).toEqual({ pending: false, phase: 'idle' });
  expect(vi.getTimerCount()).toBe(0);
});

test('a separate navigation after the prior presentation ends starts hidden again', () => {
  const { subject, states } = feedback();
  const first = subject.begin('/en/blog/');
  vi.advanceTimersByTime(NAVIGATION_SHOW_DELAY_MS);
  subject.finish(first);
  vi.runAllTimers();
  const beforeNext = states.length;
  const second = subject.begin('/en/projects/');
  subject.prepared(second);
  subject.finish(second);
  vi.runAllTimers();
  expect(states.slice(beforeNext).every((state) => state.phase === 'idle')).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test.each(['idle', 'active', 'finishing'] as const)(
  'cancel immediately clears a %s presentation',
  (phase) => {
    const { subject, states } = feedback();
    const revision = subject.begin('/en/blog/');
    if (phase !== 'idle') vi.advanceTimersByTime(NAVIGATION_SHOW_DELAY_MS);
    if (phase === 'finishing') {
      subject.finish(revision);
      vi.advanceTimersByTime(NAVIGATION_MIN_VISIBLE_MS);
    }
    expect(subject.current().phase).toBe(phase);
    subject.cancel(revision);
    expect(subject.current()).toEqual({ pending: false, phase: 'idle' });
    const count = states.length;
    vi.runAllTimers();
    expect(states).toHaveLength(count);
    expect(vi.getTimerCount()).toBe(0);
  },
);

test('dispose clears timers and invalidates every old callback', () => {
  const { subject, states } = feedback();
  const revision = subject.begin('/en/blog/');

  subject.dispose();
  subject.prepared(revision);
  subject.finish(revision);
  vi.runAllTimers();
  expect(subject.current()).toEqual({ pending: false, phase: 'idle' });
  expect(states.at(-1)).toEqual({ pending: false, phase: 'idle' });
  expect(vi.getTimerCount()).toBe(0);
});
