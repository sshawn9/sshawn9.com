import { afterEach, expect, it, vi } from 'vitest';
import { refreshWallpaperManifest } from '../../../worker/index';
import { MemoryKv, unsplashPhoto, storedWallpaperPhoto } from '../worker-fixtures';

afterEach(() => vi.unstubAllGlobals());

it('orders the pool by Unsplash creation time and evicts the oldest entries above 250', async () => {
  const kv = new MemoryKv();
  const existing = {
    version: 2 as const,
    updatedAt: '2026-08-13T00:00:00.000Z',
    photos: Array.from({ length: 248 }, (_, index) => storedWallpaperPhoto(index)).reverse(),
  };
  await kv.put('wallpaper-manifest-v1', JSON.stringify(existing));
  const updatedDuplicate = {
    ...unsplashPhoto(247),
    user: {
      ...unsplashPhoto(247).user,
      name: 'Updated Photographer',
    },
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        results: [unsplashPhoto(250), updatedDuplicate, unsplashPhoto(248), unsplashPhoto(249)],
      }),
    ),
  );

  const manifest = await refreshWallpaperManifest({
    WALLPAPER_MANIFEST: kv,
    UNSPLASH_ACCESS_KEY: 'test-access-key',
  });

  expect(manifest.photos).toHaveLength(250);
  expect(manifest.photos[0]?.id).toBe('photo-1');
  expect(manifest.photos.slice(-3).map((photo) => photo.id)).toEqual([
    'photo-248',
    'photo-249',
    'photo-250',
  ]);
  expect(manifest.photos.find((photo) => photo.id === 'photo-247')?.photographerName).toBe(
    'Updated Photographer',
  );
});
