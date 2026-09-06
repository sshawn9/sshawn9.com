import { afterEach, expect, it, vi } from 'vitest';
import { refreshWallpaperManifest } from '../../../worker/index';
import { MemoryKv } from '../worker-fixtures';
import type { WallpaperManifest } from '@sshawn9/site-domain/wallpaper';

afterEach(() => vi.unstubAllGlobals());

it('does not replace the stored manifest when a refresh fails', async () => {
  const kv = new MemoryKv();
  const existing: WallpaperManifest = {
    version: 2,
    updatedAt: '2026-08-13T00:00:00.000Z',
    photos: [
      {
        id: 'existing',
        createdAt: '2026-01-01T00:00:00.000Z',
        blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        rawUrl: 'https://images.unsplash.com/existing',
        photographerName: 'Existing Photographer',
        photographerUrl: 'https://unsplash.com/@existing',
        photoUrl: 'https://unsplash.com/photos/existing',
      },
    ],
  };
  await kv.put('wallpaper-manifest-v1', JSON.stringify(existing));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 503 })),
  );

  await expect(
    refreshWallpaperManifest({
      WALLPAPER_MANIFEST: kv,
      UNSPLASH_ACCESS_KEY: 'test-access-key',
    }),
  ).rejects.toThrow('Unsplash search failed');
  expect(JSON.parse(kv.values.get('wallpaper-manifest-v1') ?? '{}')).toEqual(existing);
});
