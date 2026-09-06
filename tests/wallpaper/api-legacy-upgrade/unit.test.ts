import { afterEach, expect, it, vi } from 'vitest';
import { refreshWallpaperManifest } from '../../../worker/index';
import { MemoryKv, unsplashPhoto } from '../worker-fixtures';

afterEach(() => vi.unstubAllGlobals());

it('rebuilds a pre-BlurHash manifest in the existing v1 key', async () => {
  const kv = new MemoryKv();
  await kv.put(
    'wallpaper-manifest-v1',
    JSON.stringify({
      version: 2,
      updatedAt: '2026-08-13T00:00:00.000Z',
      photos: [
        {
          id: 'legacy-photo',
          createdAt: '2026-08-12T00:00:00.000Z',
          rawUrl: 'https://images.unsplash.com/legacy-photo',
          photographerName: 'Legacy Photographer',
          photographerUrl: 'https://unsplash.com/@legacy',
          photoUrl: 'https://unsplash.com/photos/legacy-photo',
          downloadLocation: 'https://api.unsplash.com/photos/legacy-photo/download',
        },
      ],
    }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        results: Array.from({ length: 4 }, (_, index) => unsplashPhoto(index)),
      }),
    ),
  );

  const manifest = await refreshWallpaperManifest({
    WALLPAPER_MANIFEST: kv,
    UNSPLASH_ACCESS_KEY: 'test-access-key',
  });

  expect(manifest.version).toBe(2);
  expect(JSON.parse(kv.values.get('wallpaper-manifest-v1') ?? '{}')).toEqual(manifest);
  expect(kv.values.has('wallpaper-manifest-v2')).toBe(false);
});
