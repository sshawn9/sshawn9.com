import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WallpaperManifestSource } from '../../../apps/site/src/features/appearance/wallpaper/assets';
import {
  MANIFEST_REFRESH_MS,
  MANIFEST_RETRY_MS,
  MANIFEST_TIMEOUT_MS,
} from '../../../apps/site/src/features/appearance/wallpaper/model';
import { manifest } from '../browser-fixtures';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

const response = () => Response.json(manifest);
const windowWithFetch = (fetch: typeof globalThis.fetch) =>
  ({
    fetch,
    AbortController,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  }) as unknown as Window;

function hangingFetch(phase: 'headers' | 'body') {
  const signals: AbortSignal[] = [];
  const aborted = vi.fn();
  const fetch = vi.fn<typeof globalThis.fetch>((_input, init) => {
    const signal = init?.signal;
    if (!signal) throw new Error('Expected a request AbortSignal.');
    signals.push(signal);
    if (phase === 'headers') {
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted();
            reject(signal.reason);
          },
          { once: true },
        );
      });
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Headers arrive, but JSON consumption remains pending until abort.
        signal.addEventListener(
          'abort',
          () => {
            aborted();
            controller.error(signal.reason);
          },
          { once: true },
        );
      },
    });
    return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'application/json' } }));
  });
  return { fetch, signals, aborted };
}

it('sets one deadline when a shared request finishes, never on cached reads', async () => {
  let release!: (value: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const source = new WallpaperManifestSource(windowWithFetch(fetch));
  const first = source.load();
  const concurrent = source.load(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(source.nextRefreshAt).toBeUndefined();

  vi.setSystemTime(1_000);
  release(response());
  expect(await first).toEqual(manifest);
  expect(await concurrent).toEqual(manifest);
  expect(source.nextRefreshAt).toBe(1_000 + MANIFEST_REFRESH_MS);

  vi.setSystemTime(20 * 60_000);
  expect(await source.load()).toEqual(manifest);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(source.nextRefreshAt).toBe(1_000 + MANIFEST_REFRESH_MS);
});

it('revalidates once and gives the completed refresh its own deadline', async () => {
  let release!: (value: Response) => void;
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
  const source = new WallpaperManifestSource(windowWithFetch(fetch));
  await source.load();
  vi.setSystemTime(MANIFEST_REFRESH_MS);
  const refreshing = source.load(true);
  const concurrent = source.load();
  expect(source.nextRefreshAt).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][1].cache).toBe('no-cache');
  vi.setSystemTime(MANIFEST_REFRESH_MS + 2_000);
  release(response());
  await Promise.all([refreshing, concurrent]);
  expect(source.nextRefreshAt).toBe(2 * MANIFEST_REFRESH_MS + 2_000);
});

it('keeps the existing manifest and normal cadence after failed revalidation', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(response())
    .mockRejectedValueOnce(new Error('offline'));
  const source = new WallpaperManifestSource(windowWithFetch(fetch));
  await source.load();
  vi.setSystemTime(MANIFEST_REFRESH_MS);
  expect(await source.load(true)).toBeUndefined();
  expect(source.current).toEqual(manifest);
  expect(source.nextRefreshAt).toBe(2 * MANIFEST_REFRESH_MS);
  expect(await source.load()).toEqual(manifest);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('backs off without a manifest instead of letting buffer maintenance retry immediately', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ invalid: true }))
    .mockResolvedValueOnce(response());
  const source = new WallpaperManifestSource(windowWithFetch(fetch));
  expect(await source.load()).toBeUndefined();
  expect(source.nextRefreshAt).toBe(MANIFEST_RETRY_MS);
  vi.setSystemTime(MANIFEST_RETRY_MS - 1);
  expect(await source.load()).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(source.nextRefreshAt).toBe(MANIFEST_RETRY_MS);
  vi.setSystemTime(MANIFEST_RETRY_MS);
  expect(await source.load()).toEqual(manifest);
  expect(source.nextRefreshAt).toBe(MANIFEST_RETRY_MS + MANIFEST_REFRESH_MS);
});

it.each(['headers', 'body'] as const)(
  'aborts a shared request stalled at %s and permits a fresh request after backoff',
  async (phase) => {
    expect(MANIFEST_TIMEOUT_MS).toBe(60_000);
    const { fetch, signals, aborted } = hangingFetch(phase);
    const source = new WallpaperManifestSource(windowWithFetch(fetch));
    const first = source.load();
    const concurrent = source.load(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(MANIFEST_TIMEOUT_MS - 1);
    expect(aborted).not.toHaveBeenCalled();
    expect(source.nextRefreshAt).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(signals[0].aborted).toBe(true);
    expect(await first).toBeUndefined();
    expect(await concurrent).toBeUndefined();
    expect(source.nextRefreshAt).toBe(MANIFEST_TIMEOUT_MS + MANIFEST_RETRY_MS);
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(MANIFEST_RETRY_MS - 1);
    expect(await source.load()).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    let retrySignal: AbortSignal | undefined;
    fetch.mockImplementationOnce(async (_input, init) => {
      retrySignal = init?.signal ?? undefined;
      return response();
    });
    expect(await source.load()).toEqual(manifest);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(retrySignal).toBeDefined();
    expect(retrySignal).not.toBe(signals[0]);
    expect(retrySignal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const deadline = MANIFEST_TIMEOUT_MS + MANIFEST_RETRY_MS + MANIFEST_REFRESH_MS;
    expect(source.nextRefreshAt).toBe(deadline);
    await vi.advanceTimersByTimeAsync(2 * MANIFEST_TIMEOUT_MS);
    expect(retrySignal?.aborted).toBe(false);
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(source.current).toEqual(manifest);
    expect(source.nextRefreshAt).toBe(deadline);
  },
);

it('retains the old manifest and five-hour cadence when revalidation times out', async () => {
  const { fetch, signals, aborted } = hangingFetch('headers');
  fetch.mockResolvedValueOnce(response());
  const source = new WallpaperManifestSource(windowWithFetch(fetch));
  expect(await source.load()).toEqual(manifest);
  expect(vi.getTimerCount()).toBe(0);
  vi.setSystemTime(MANIFEST_REFRESH_MS);
  const refreshing = source.load(true);
  const concurrent = source.load();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(source.current).toEqual(manifest);
  expect(source.nextRefreshAt).toBeUndefined();
  await vi.advanceTimersByTimeAsync(MANIFEST_TIMEOUT_MS);
  expect(aborted).toHaveBeenCalledTimes(1);
  expect(signals[0].aborted).toBe(true);
  expect(await refreshing).toBeUndefined();
  expect(await concurrent).toBeUndefined();
  expect(source.current).toEqual(manifest);
  expect(source.nextRefreshAt).toBe(2 * MANIFEST_REFRESH_MS + MANIFEST_TIMEOUT_MS);
  expect(await source.load()).toEqual(manifest);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  { name: 'success', response, expected: manifest, aborted: false },
  {
    name: 'non-2xx response',
    response: () => new Response(null, { status: 503 }),
    expected: undefined,
    aborted: true,
  },
  {
    name: 'incorrect Content-Type',
    response: () => new Response('not JSON', { headers: { 'Content-Type': 'text/plain' } }),
    expected: undefined,
    aborted: true,
  },
  {
    name: 'invalid JSON body',
    response: () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
    expected: undefined,
    aborted: false,
  },
])('clears the request timeout after $name', async ({ response: result, expected, aborted }) => {
  let signal: AbortSignal | undefined;
  const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
    signal = init?.signal ?? undefined;
    return result();
  });
  const source = new WallpaperManifestSource(windowWithFetch(fetch));
  expect(await source.load()).toEqual(expected);
  expect(signal).toBeDefined();
  expect(signal?.aborted).toBe(aborted);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(MANIFEST_TIMEOUT_MS);
  expect(signal?.aborted).toBe(aborted);
  expect(vi.getTimerCount()).toBe(0);
});
