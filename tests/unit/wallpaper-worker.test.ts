import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleWallpaperDownloadRequest,
  handleWallpaperRequest,
  refreshWallpaperManifest,
} from '../../worker/index';
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

function storedManifest(updatedAt = new Date().toISOString()) {
  return {
    version: 1 as const,
    updatedAt,
    photos: [
      {
        id: 'cached',
        rawUrl: 'https://images.unsplash.com/cached',
        photographerName: 'Cached Photographer',
        photographerUrl: 'https://unsplash.com/@cached',
        photoUrl: 'https://unsplash.com/photos/cached',
        downloadLocation: 'https://api.unsplash.com/photos/cached/download?ixid=cached',
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('wallpaper Worker', () => {
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

  it('does not replace the stored manifest when a refresh fails', async () => {
    const kv = new MemoryKv();
    const existing: WallpaperManifest = {
      version: 1,
      updatedAt: '2026-08-13T00:00:00.000Z',
      photos: [
        {
          id: 'existing',
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
    const body = (await response.json()) as WallpaperManifest;
    expect(body.photos[0]).toEqual({
      id: 'cached',
      rawUrl: 'https://images.unsplash.com/cached',
      photographerName: 'Cached Photographer',
      photographerUrl: 'https://unsplash.com/@cached',
      photoUrl: 'https://unsplash.com/photos/cached',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a download only for a photo in the current manifest', async () => {
    const kv = new MemoryKv();
    await kv.put('wallpaper-manifest-v1', JSON.stringify(storedManifest()));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({ url: 'https://images.unsplash.com/cached' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    let backgroundTask: Promise<unknown> | undefined;

    const response = await handleWallpaperDownloadRequest(
      new Request('https://sshawn9.com/api/wallpapers/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://sshawn9.com',
        },
        body: JSON.stringify({ photoId: 'cached' }),
      }),
      {
        ASSETS: { fetch: vi.fn() },
        WALLPAPER_MANIFEST: kv,
        UNSPLASH_ACCESS_KEY: 'test-access-key',
      },
      {
        waitUntil(task) {
          backgroundTask = task;
        },
      },
    );

    expect(response.status).toBe(202);
    await backgroundTask;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.unsplash.com/photos/cached/download?ixid=cached',
    );
  });

  it('rejects download reports for photos outside the current manifest', async () => {
    const kv = new MemoryKv();
    await kv.put('wallpaper-manifest-v1', JSON.stringify(storedManifest()));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleWallpaperDownloadRequest(
      new Request('https://sshawn9.com/api/wallpapers/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://sshawn9.com',
        },
        body: JSON.stringify({ photoId: 'not-in-manifest' }),
      }),
      {
        ASSETS: { fetch: vi.fn() },
        WALLPAPER_MANIFEST: kv,
        UNSPLASH_ACCESS_KEY: 'test-access-key',
      },
      { waitUntil: vi.fn() },
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 503 when the initial manifest cannot be created', async () => {
    const kv = new MemoryKv();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    );

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
  });

  it('serves a stale manifest while refreshing it in the background', async () => {
    const kv = new MemoryKv();
    const existing = storedManifest('2026-08-01T00:00:00.000Z');
    await kv.put('wallpaper-manifest-v1', JSON.stringify(existing));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ results: Array.from({ length: 4 }, (_, index) => unsplashPhoto(index)) }),
      ),
    );
    let backgroundTask: Promise<unknown> | undefined;

    const response = await handleWallpaperRequest(
      new Request('https://sshawn9.com/api/wallpapers'),
      {
        ASSETS: { fetch: vi.fn() },
        WALLPAPER_MANIFEST: kv,
        UNSPLASH_ACCESS_KEY: 'test-access-key',
      },
      {
        waitUntil(task) {
          backgroundTask = task;
        },
      },
    );

    expect(response.status).toBe(200);
    expect(((await response.json()) as WallpaperManifest).updatedAt).toBe(existing.updatedAt);
    await backgroundTask;
    expect(
      (JSON.parse(kv.values.get('wallpaper-manifest-v1') ?? '{}') as WallpaperManifest).updatedAt,
    ).not.toBe(existing.updatedAt);
  });
});
