import { afterEach, expect, it, vi } from 'vitest';
import { isWallpaperManifest, type WallpaperManifest } from '@sshawn9/site-domain/wallpaper';
import { handleWallpaperRequest, refreshWallpaperManifest } from '../../../worker/index';
import { MemoryKv, storedWallpaperPhoto, unsplashPhoto } from '../worker-fixtures';

afterEach(() => vi.unstubAllGlobals());

async function readPublicManifest(kv: MemoryKv) {
  const response = await handleWallpaperRequest(
    new Request('https://sshawn9.com/api/wallpapers'),
    {
      WALLPAPER_MANIFEST: kv,
      UNSPLASH_ACCESS_KEY: 'test-access-key',
      ASSETS: { fetch: vi.fn() },
    },
    { waitUntil: vi.fn() },
  );
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  expect(isWallpaperManifest(body)).toBe(true);
  const manifest = body as WallpaperManifest;
  for (const photo of manifest.photos) expect(photo).not.toHaveProperty('downloadLocation');
  return manifest;
}

async function preparePool() {
  const kv = new MemoryKv();
  const existing = {
    version: 2,
    updatedAt: '2026-08-13T00:00:00.000Z',
    photos: Array.from({ length: 4 }, (_, index) => storedWallpaperPhoto(index)),
  };
  await kv.put('wallpaper-manifest-v1', JSON.stringify(existing));
  kv.putCalls = 0;
  return { kv, existing };
}

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
  expect((await readPublicManifest(kv)).photos.map((photo) => photo.id)).toEqual(
    manifest.photos.map((photo) => photo.id),
  );
});

const original = unsplashPhoto(1);
it.each([
  {
    name: 'an HTTP image',
    candidate: { ...original, urls: { raw: 'http://images.unsplash.com/photo-1' } },
  },
  {
    name: 'an HTTP photo page',
    candidate: {
      ...original,
      links: { ...original.links, html: 'http://unsplash.com/photos/photo-1' },
    },
  },
  {
    name: 'an HTTP photographer page',
    candidate: {
      ...original,
      user: { ...original.user, links: { html: 'http://unsplash.com/@photographer-1' } },
    },
  },
  {
    name: 'a lookalike photo host',
    candidate: {
      ...original,
      links: { ...original.links, html: 'https://notunsplash.com/photos/photo-1' },
    },
  },
  {
    name: 'a lookalike photographer host',
    candidate: {
      ...original,
      user: { ...original.user, links: { html: 'https://notunsplash.com/@photographer-1' } },
    },
  },
  {
    name: 'an invalid download endpoint',
    candidate: {
      ...original,
      links: {
        ...original.links,
        download_location: 'https://api.unsplash.com.example.org/download',
      },
    },
  },
  { name: 'missing nested fields', candidate: { ...original, user: null } },
])(
  'rejects $name before it can replace an existing photo, while accepting valid new photos',
  async ({ candidate }) => {
    const { kv, existing } = await preparePool();
    await readPublicManifest(kv);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ results: [candidate, unsplashPhoto(4)] })),
    );

    await refreshWallpaperManifest({
      WALLPAPER_MANIFEST: kv,
      UNSPLASH_ACCESS_KEY: 'test-access-key',
    });

    const published = await readPublicManifest(kv);
    expect(published.photos.map((photo) => photo.id)).toEqual([
      'photo-0',
      'photo-1',
      'photo-2',
      'photo-3',
      'photo-4',
    ]);
    expect(JSON.parse(kv.values.get('wallpaper-manifest-v1') ?? '{}').photos).toEqual([
      ...existing.photos,
      storedWallpaperPhoto(4),
    ]);
    expect(kv.putCalls).toBe(1);
  },
);

it('keeps the readable pool and its timestamp unchanged when every new candidate is unusable', async () => {
  const { kv, existing } = await preparePool();
  const before = await readPublicManifest(kv);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        results: [
          null,
          {},
          { ...unsplashPhoto(4), urls: { raw: 'http://images.unsplash.com/photo-4' } },
          { ...unsplashPhoto(5), width: '3600' },
        ],
      }),
    ),
  );

  expect(
    await refreshWallpaperManifest({
      WALLPAPER_MANIFEST: kv,
      UNSPLASH_ACCESS_KEY: 'test-access-key',
    }),
  ).toEqual(existing);
  expect(await readPublicManifest(kv)).toEqual(before);
  expect(kv.putCalls).toBe(0);
});

it('does not write a new pool with fewer than four valid distinct photos', async () => {
  const kv = new MemoryKv();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        results: [
          unsplashPhoto(0),
          unsplashPhoto(1),
          unsplashPhoto(2),
          unsplashPhoto(2),
          { ...unsplashPhoto(3), urls: { raw: 'http://images.unsplash.com/photo-3' } },
        ],
      }),
    ),
  );

  await expect(
    refreshWallpaperManifest({ WALLPAPER_MANIFEST: kv, UNSPLASH_ACCESS_KEY: 'test-access-key' }),
  ).rejects.toThrow('only 3 usable wallpaper photos');
  expect(kv.putCalls).toBe(0);
  expect(kv.values.has('wallpaper-manifest-v1')).toBe(false);
});
