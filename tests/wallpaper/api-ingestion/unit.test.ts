import { afterEach, expect, it, vi } from 'vitest';
import { refreshWallpaperManifest } from '../../../worker/index';
import { MemoryKv, unsplashPhoto } from '../worker-fixtures';

afterEach(() => vi.unstubAllGlobals());

it('stores supported photos without reporting unused candidates as downloads', async () => {
  const kv = new MemoryKv();
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === '/search/photos') {
      return Response.json({
        results: [
          ...Array.from({ length: 6 }, (_, index) => unsplashPhoto(index)),
          {
            ...unsplashPhoto(7),
            urls: { raw: 'https://example.com/not-an-unsplash-image' },
          },
          { ...unsplashPhoto(8), blur_hash: null },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  const manifest = await refreshWallpaperManifest({
    WALLPAPER_MANIFEST: kv,
    UNSPLASH_ACCESS_KEY: 'test-access-key',
  });

  expect(manifest.photos).toHaveLength(6);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0]?.[0])).toContain('query=scenic+natural+landscape');
  expect(String(fetchMock.mock.calls[0]?.[0])).toContain('orientation=landscape');
  expect(manifest.photos[0]?.photographerUrl).toContain('utm_source=sshawn9.com');
  expect(manifest.photos[0]?.downloadLocation).toContain('api.unsplash.com');
  expect(JSON.parse(kv.values.get('wallpaper-manifest-v1') ?? '{}')).toEqual(manifest);
});
