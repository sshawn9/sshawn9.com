import { afterEach, expect, it, vi } from 'vitest';
import { handleWallpaperRequest } from '../../../worker/index';
import { MemoryKv, storedManifest } from '../worker-fixtures';
import type { WallpaperManifest } from '@sshawn9/site-domain/wallpaper';

afterEach(() => vi.unstubAllGlobals());

it('serves a cached manifest without contacting Unsplash', async () => {
  const kv = new MemoryKv();
  const manifest = storedManifest();
  await kv.put('wallpaper-manifest-v1', JSON.stringify(manifest));
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const response = await handleWallpaperRequest(
    new Request('https://sshawn9.com/api/wallpapers'),
    {
      ASSETS: { fetch: vi.fn() },
      WALLPAPER_MANIFEST: kv,
      UNSPLASH_ACCESS_KEY: 'test-access-key',
    },
    { waitUntil: vi.fn() },
  );

  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('public, max-age=900');
  const body = (await response.json()) as WallpaperManifest;
  expect(body.photos[0]).toEqual({
    id: 'cached',
    createdAt: '2026-01-01T00:00:00.000Z',
    blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    rawUrl: 'https://images.unsplash.com/cached',
    photographerName: 'Cached Photographer',
    photographerUrl: 'https://unsplash.com/@cached',
    photoUrl: 'https://unsplash.com/photos/cached',
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('returns 503 for an empty cache without letting a visitor initialize it', async () => {
  const kv = new MemoryKv();
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const response = await handleWallpaperRequest(
    new Request('https://sshawn9.com/api/wallpapers'),
    {
      ASSETS: { fetch: vi.fn() },
      WALLPAPER_MANIFEST: kv,
      UNSPLASH_ACCESS_KEY: 'test-access-key',
    },
    { waitUntil: vi.fn() },
  );

  expect(response.status).toBe(503);
  expect(response.headers.get('Retry-After')).toBe('60');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(kv.putCalls).toBe(0);
});

it('does not refresh an existing manifest during a user request', async () => {
  const kv = new MemoryKv();
  const existing = storedManifest('2026-08-01T00:00:00.000Z');
  await kv.put('wallpaper-manifest-v1', JSON.stringify(existing));
  const fetchMock = vi.fn();
  const waitUntil = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  const response = await handleWallpaperRequest(
    new Request('https://sshawn9.com/api/wallpapers'),
    {
      ASSETS: { fetch: vi.fn() },
      WALLPAPER_MANIFEST: kv,
      UNSPLASH_ACCESS_KEY: 'test-access-key',
    },
    { waitUntil },
  );

  expect(response.status).toBe(200);
  expect(((await response.json()) as WallpaperManifest).updatedAt).toBe(existing.updatedAt);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(waitUntil).not.toHaveBeenCalled();
});
