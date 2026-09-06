import { afterEach, expect, it, vi } from 'vitest';
import { refreshWallpaperManifest } from '../../../worker/index';
import { MemoryKv, unsplashPhoto, storedWallpaperPhoto } from '../worker-fixtures';

afterEach(() => vi.unstubAllGlobals());

it('does not rewrite the pool when the fetched candidates contain no changes', async () => {
  const kv = new MemoryKv();
  const existing = {
    version: 2 as const,
    updatedAt: '2026-08-13T00:00:00.000Z',
    photos: Array.from({ length: 4 }, (_, index) => storedWallpaperPhoto(index)),
  };
  await kv.put('wallpaper-manifest-v1', JSON.stringify(existing));
  kv.putCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({ results: Array.from({ length: 4 }, (_, index) => unsplashPhoto(index)) }),
    ),
  );

  const manifest = await refreshWallpaperManifest({
    WALLPAPER_MANIFEST: kv,
    UNSPLASH_ACCESS_KEY: 'test-access-key',
  });

  expect(manifest).toEqual(existing);
  expect(kv.putCalls).toBe(0);
});
