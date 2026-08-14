import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleWallpaperRequest, refreshWallpaperManifest } from '../../worker/index';
import type { WallpaperManifest } from '../../src/lib/wallpaper';

class MemoryKv {
  values = new Map<string, string>();

  async get(key: string, type: 'json') {
    const value = this.values.get(key);
    if (type === 'json' && value) return JSON.parse(value) as unknown;
    return undefined;
  }

  async put(key: string, value: string) {
    this.values.set(key, value);
  }
}

function unsplashPhoto(index: number) {
  return {
    id: `photo-${index}`,
    width: 3600,
    height: 2400,
    urls: { raw: `https://images.unsplash.com/photo-${index}` },
    links: {
      html: `https://unsplash.com/photos/photo-${index}`,
      download_location: `https://api.unsplash.com/photos/photo-${index}/download`,
    },
    user: {
      name: `Photographer ${index}`,
      links: { html: `https://unsplash.com/@photographer-${index}` },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('wallpaper Worker', () => {
  it('stores only supported photos after reporting their download events', async () => {
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
          ],
        });
      }
      return Response.json({ url: 'https://images.unsplash.com/tracked' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const manifest = await refreshWallpaperManifest({
      WALLPAPER_MANIFEST: kv,
      UNSPLASH_ACCESS_KEY: 'test-access-key',
    });

    expect(manifest.photos).toHaveLength(6);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('query=scenic+natural+landscape');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('orientation=landscape');
    expect(manifest.photos[0]?.photographerUrl).toContain('utm_source=sshawn9.com');
    expect(JSON.parse(kv.values.get('wallpaper-manifest-v1') ?? '{}')).toEqual(manifest);
  });

  it('does not replace the stored manifest when a refresh fails', async () => {
    const kv = new MemoryKv();
    const existing: WallpaperManifest = {
      version: 1,
      updatedAt: '2026-08-13T00:00:00.000Z',
      photos: [
        {
          id: 'existing',
          width: 3600,
          height: 2400,
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

  it('serves a cached manifest without contacting Unsplash', async () => {
    const kv = new MemoryKv();
    const manifest: WallpaperManifest = {
      version: 1,
      updatedAt: new Date().toISOString(),
      photos: [
        {
          id: 'cached',
          width: 3600,
          height: 2400,
          rawUrl: 'https://images.unsplash.com/cached',
          photographerName: 'Cached Photographer',
          photographerUrl: 'https://unsplash.com/@cached',
          photoUrl: 'https://unsplash.com/photos/cached',
        },
      ],
    };
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
    expect(await response.json()).toEqual(manifest);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
