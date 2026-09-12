const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * Start requests gradually while keeping at most one refill timer alive.
 *
 * @param {{
 *   concurrency: number,
 *   minInterval: number,
 *   maxInterval: number,
 *   signal?: AbortSignal,
 *   random?: () => number,
 *   now?: () => number,
 * }} options Intervals are expressed in seconds.
 */
export function createRequestScheduler({
  concurrency,
  minInterval,
  maxInterval,
  signal,
  random = Math.random,
  now = Date.now,
}) {
  if (!Number.isInteger(concurrency) || concurrency < 1)
    throw new Error('concurrency must be a positive integer.');
  if (!Number.isFinite(minInterval) || minInterval < 0)
    throw new Error('minInterval must be a non-negative finite number.');
  if (!Number.isFinite(maxInterval) || maxInterval < minInterval)
    throw new Error('maxInterval must be a finite number at least as large as minInterval.');
  if (typeof random !== 'function' || typeof now !== 'function')
    throw new Error('random and now must be functions.');

  let timer = null;
  let pauseDeadline = 0;
  let stopped = signal?.aborted ?? false;
  let currentRun = null;

  const clearTimer = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  // Node clamps overflowing delays to 1 ms. Rechecking a deadline in bounded
  // chunks preserves long waits without creating additional timers.
  const waitUntil = (deadline, callback) => {
    const check = () => {
      timer = null;
      const remaining = deadline - now();
      if (remaining > 0) {
        timer = setTimeout(check, Math.min(remaining, MAX_TIMEOUT_MS));
        return;
      }
      callback();
    };
    timer = setTimeout(check, Math.min(Math.max(0, deadline - now()), MAX_TIMEOUT_MS));
  };

  const finish = (run) => {
    if (currentRun !== run || run.active !== 0) return;
    const hasPending = run.next < run.items.length;
    if (hasPending && !run.failed && !stopped) return;
    clearTimer();
    currentRun = null;
    if (run.failed) run.reject(run.failure);
    else run.resolve();
  };

  const schedule = (run) => {
    if (
      currentRun !== run ||
      timer !== null ||
      stopped ||
      run.failed ||
      run.next >= run.items.length ||
      run.active >= concurrency
    )
      return;

    if (now() < pauseDeadline) {
      waitUntil(pauseDeadline, () => schedule(run));
      return;
    }

    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample > 1) {
      run.failed = true;
      run.failure = new Error('random must return a finite number between 0 and 1.');
      run.next = run.items.length;
      finish(run);
      return;
    }
    const interval = minInterval + (maxInterval - minInterval) * sample;
    waitUntil(now() + interval * 1000, () => startOne(run));
  };

  const taskSettled = (run, failed = false, error) => {
    const wasFull = run.active === concurrency;
    run.active--;
    if (failed && !run.failed) {
      run.failed = true;
      run.failure = error;
      run.next = run.items.length;
      clearTimer();
    }
    if (currentRun !== run) return;
    if (run.failed || stopped || run.next >= run.items.length) {
      finish(run);
      return;
    }
    // A completion only creates a new interval when the pool had been full.
    // Otherwise the already-running refill timer keeps its original deadline.
    if (wasFull || timer === null) schedule(run);
  };

  const startOne = (run) => {
    if (currentRun !== run || stopped || run.failed) return finish(run);
    if (now() < pauseDeadline) return schedule(run);
    if (run.next >= run.items.length || run.active >= concurrency) return finish(run);

    const item = run.items[run.next++];
    run.active++;
    let result;
    try {
      result = run.task(item);
    } catch (error) {
      taskSettled(run, true, error);
      return;
    }
    Promise.resolve(result).then(
      () => taskSettled(run),
      (error) => taskSettled(run, true, error),
    );

    if (run.next < run.items.length && run.active < concurrency) schedule(run);
  };

  const stopNewTasks = () => {
    signal?.removeEventListener('abort', stopNewTasks);
    if (stopped) return;
    stopped = true;
    clearTimer();
    if (!currentRun) return;
    currentRun.next = currentRun.items.length;
    finish(currentRun);
  };

  if (!stopped) signal?.addEventListener('abort', stopNewTasks, { once: true });

  return {
    /**
     * @template T
     * @param {Iterable<T>} items
     * @param {(item: T) => unknown | Promise<unknown>} task
     * @returns {Promise<void>}
     */
    run(items, task) {
      if (currentRun) throw new Error('The request scheduler is already running.');
      if (typeof task !== 'function') throw new Error('task must be a function.');
      const queued = Array.from(items);
      if (!queued.length || stopped) return Promise.resolve();

      return new Promise((resolve, reject) => {
        const run = {
          items: queued,
          task,
          next: 0,
          active: 0,
          failed: false,
          failure: undefined,
          resolve,
          reject,
        };
        currentRun = run;
        schedule(run);
      });
    },

    pauseUntil(timestampMs) {
      if (!Number.isFinite(timestampMs)) throw new Error('pauseUntil requires a finite timestamp.');
      pauseDeadline = Math.max(pauseDeadline, timestampMs);
      if (!currentRun || stopped || currentRun.next >= currentRun.items.length) return;
      clearTimer();
      schedule(currentRun);
    },

    stop: stopNewTasks,

    get pausedUntil() {
      return pauseDeadline;
    },
  };
}
