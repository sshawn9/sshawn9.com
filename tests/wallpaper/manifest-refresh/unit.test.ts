import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WallpaperManifestSource } from '../../../apps/site/src/features/appearance/wallpaper/assets';
import {
  MANIFEST_REFRESH_MS,
  MANIFEST_RETRY_MS,
} from '../../../apps/site/src/features/appearance/wallpaper/model';
import { manifest } from '../browser-fixtures';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

const response = () => Response.json(manifest);
const windowWithFetch = (fetch: typeof globalThis.fetch) => ({ fetch }) as unknown as Window;

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
