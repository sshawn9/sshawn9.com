import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleWallpaperDownloadRequest,
  handleWallpaperRequest,
  refreshWallpaperManifest,
} from '../../worker/index';
import type { WallpaperManifest } from '../../src/lib/wallpaper';

class MemoryKv {
  values = new Map<string, string>();
  putCalls = 0;

  async get(key: string, type: 'json') {
    const value = this.values.get(key);
    if (type === 'json' && value) return JSON.parse(value) as unknown;
    return undefined;
  }

  async put(key: string, value: string) {
    this.putCalls += 1;
    this.values.set(key, value);
  }
}

function unsplashPhoto(index: number) {
  return {
    id: `photo-${index}`,
    created_at: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
    blur_hash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
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

function storedWallpaperPhoto(index: number) {
  const photographerUrl = new URL(`https://unsplash.com/@photographer-${index}`);
  photographerUrl.searchParams.set('utm_source', 'sshawn9.com');
  photographerUrl.searchParams.set('utm_medium', 'referral');
  photographerUrl.searchParams.set('utm_content', 'credit-photographer');
  const photoUrl = new URL(`https://unsplash.com/photos/photo-${index}`);
  photoUrl.searchParams.set('utm_source', 'sshawn9.com');
  photoUrl.searchParams.set('utm_medium', 'referral');
  photoUrl.searchParams.set('utm_content', 'credit-photo');

  return {
    id: `photo-${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(),
    blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    rawUrl: `https://images.unsplash.com/photo-${index}`,
    photographerName: `Photographer ${index}`,
    photographerUrl: photographerUrl.toString(),
    photoUrl: photoUrl.toString(),
    downloadLocation: `https://api.unsplash.com/photos/photo-${index}/download`,
  };
}

function storedManifest(updatedAt = new Date().toISOString()) {
  return {
    version: 2 as const,
    updatedAt,
    photos: [
      {
        id: 'cached',
        createdAt: '2026-01-01T00:00:00.000Z',
        blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
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
});
