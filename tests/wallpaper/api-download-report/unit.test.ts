import { afterEach, expect, it, vi } from 'vitest';
import { handleWallpaperDownloadRequest } from '../../../worker/index';
import { MemoryKv, storedManifest } from '../worker-fixtures';

afterEach(() => vi.unstubAllGlobals());

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
