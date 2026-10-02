import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequestScheduler } from '../../../apps/site/tools/cache-probe/scheduler.mjs';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('cache-probe request scheduling', () => {
  it('slow-fills initially and waits a full interval after a full slot opens', async () => {
    const pending = [deferred(), deferred(), deferred()];
    const starts: Array<[number, number]> = [];
    const scheduler = createRequestScheduler({ concurrency: 2, minInterval: 1, maxInterval: 1 });
    const run = scheduler.run([0, 1, 2], (item) => {
      starts.push([item, Date.now()]);
      return pending[item].promise;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(starts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(starts).toEqual([
      [0, 1_000],
      [1, 2_000],
    ]);

    pending[0].resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(999);
    expect(starts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts[2]).toEqual([2, 3_000]);

    pending[1].resolve();
    pending[2].resolve();
    await run;
  });

  it('does not reset an in-flight refill interval when an under-full task finishes', async () => {
    const first = deferred();
    const starts: number[] = [];
    const scheduler = createRequestScheduler({ concurrency: 3, minInterval: 1, maxInterval: 1 });
    const run = scheduler.run([0, 1], (item) => {
      starts.push(Date.now());
      return item === 0 ? first.promise : undefined;
    });

    await vi.advanceTimersByTimeAsync(1_500);
    expect(starts).toEqual([1_000]);
    first.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(499);
    expect(starts).toEqual([1_000]);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toEqual([1_000, 2_000]);
    await run;
  });

  it('draws a fresh random interval for every refill', async () => {
    const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(1);
    const starts: number[] = [];
    const scheduler = createRequestScheduler({
      concurrency: 4,
      minInterval: 1,
      maxInterval: 3,
      random,
    });
    const run = scheduler.run([0, 1, 2], () => starts.push(Date.now()));

    await vi.advanceTimersByTimeAsync(6_000);
    await run;
    expect(starts).toEqual([1_000, 3_000, 6_000]);
    expect(random).toHaveBeenCalledTimes(3);
  });

  it('keeps pauses across runs and waits a new full interval after recovery', async () => {
    const scheduler = createRequestScheduler({ concurrency: 1, minInterval: 1, maxInterval: 1 });
    scheduler.pauseUntil(5_000);
    await scheduler.run([], () => undefined);

    const starts: number[] = [];
    const run = scheduler.run([0], () => starts.push(Date.now()));
    await vi.advanceTimersByTimeAsync(5_999);
    expect(starts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(starts).toEqual([6_000]);
  });

  it('cancels refill immediately for a pause and keeps the latest of multiple deadlines', async () => {
    const first = deferred();
    const starts: number[] = [];
    const scheduler = createRequestScheduler({ concurrency: 2, minInterval: 1, maxInterval: 1 });
    const run = scheduler.run([0, 1], (item) => {
      starts.push(Date.now());
      return item === 0 ? first.promise : undefined;
    });

    await vi.advanceTimersByTimeAsync(1_500);
    scheduler.pauseUntil(5_000);
    scheduler.pauseUntil(4_000);
    first.resolve();
    await vi.advanceTimersByTimeAsync(4_499);
    expect(starts).toEqual([1_000]);
    expect(scheduler.pausedUntil).toBe(5_000);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(starts).toEqual([1_000, 6_000]);
  });

  it('stop prevents queued starts but lets active work settle', async () => {
    const active = deferred();
    const starts: number[] = [];
    const scheduler = createRequestScheduler({ concurrency: 2, minInterval: 1, maxInterval: 1 });
    const run = scheduler.run([0, 1], () => {
      starts.push(Date.now());
      return active.promise;
    });
    await vi.advanceTimersByTimeAsync(1_000);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(starts).toEqual([1_000]);
    active.resolve();
    await run;
  });

  it('abort cancels refill but waits for active work to settle', async () => {
    const controller = new AbortController();
    const active = deferred();
    const starts: number[] = [];
    const scheduler = createRequestScheduler({
      concurrency: 2,
      minInterval: 1,
      maxInterval: 1,
      signal: controller.signal,
    });
    const run = scheduler.run([0, 1], () => {
      starts.push(Date.now());
      return active.promise;
    });
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(starts).toEqual([1_000]);
    active.resolve();
    await run;
  });

  it('drains all active rejections, rejects once, and never starts queued work after failure', async () => {
    const active = [deferred(), deferred()];
    const firstError = new Error('first failure');
    const starts: number[] = [];
    const scheduler = createRequestScheduler({ concurrency: 2, minInterval: 1, maxInterval: 1 });
    const observed = scheduler
      .run([0, 1, 2], (item) => {
        starts.push(Date.now());
        return active[item].promise;
      })
      .catch((error) => error);

    await vi.advanceTimersByTimeAsync(2_000);
    active[0].reject(firstError);
    await Promise.resolve();
    active[1].reject(new Error('second failure'));
    expect(await observed).toBe(firstError);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(starts).toEqual([1_000, 2_000]);
  });

  it('never exceeds the concurrency limit and rejects overlapping runs', async () => {
    let active = 0;
    let maximum = 0;
    const scheduler = createRequestScheduler({
      concurrency: 3,
      minInterval: 0.1,
      maxInterval: 0.1,
    });
    const run = scheduler.run([0, 1, 2, 3, 4, 5, 6], async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      active--;
    });
    expect(() => scheduler.run([7], () => undefined)).toThrow('already running');
    await vi.runAllTimersAsync();
    await run;
    expect(maximum).toBe(3);
  });

  it('chunks intervals larger than the platform timeout limit', async () => {
    const starts: number[] = [];
    const scheduler = createRequestScheduler({
      concurrency: 1,
      minInterval: 3_000_000,
      maxInterval: 3_000_000,
    });
    const run = scheduler.run([0], () => starts.push(Date.now()));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(starts).toEqual([]);
    scheduler.stop();
    await run;
  });
});
