import { afterEach, expect, it, vi } from 'vitest';
import { handleWallpaperRequest, refreshWallpaperManifest } from '../../../worker/index';
import { MemoryKv, storedWallpaperPhoto } from '../worker-fixtures';

afterEach(() => vi.unstubAllGlobals());

it.each([
  { name: 'an upstream HTTP error', response: () => new Response(null, { status: 503 }) },
  {
    name: 'invalid JSON',
    response: () => new Response('{', { headers: { 'Content-Type': 'application/json' } }),
  },
  { name: 'a null response', response: () => Response.json(null) },
  { name: 'missing results', response: () => Response.json({}) },
  { name: 'non-array results', response: () => Response.json({ results: {} }) },
])('preserves the readable pool after $name', async ({ response }) => {
  const kv = new MemoryKv();
  const existing = {
    version: 2,
    updatedAt: '2026-08-13T00:00:00.000Z',
    photos: Array.from({ length: 4 }, (_, index) => storedWallpaperPhoto(index)),
  };
  await kv.put('wallpaper-manifest-v1', JSON.stringify(existing));
  kv.putCalls = 0;
  const env = {
    WALLPAPER_MANIFEST: kv,
    UNSPLASH_ACCESS_KEY: 'test-access-key',
    ASSETS: { fetch: vi.fn() },
  };
  const read = () =>
    handleWallpaperRequest(new Request('https://sshawn9.com/api/wallpapers'), env, {
      waitUntil: vi.fn(),
    });
  const before = await read();
  expect(before.status).toBe(200);
  const beforeBody = await before.text();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response()),
  );

  await expect(refreshWallpaperManifest(env)).rejects.toThrow();
  expect(JSON.parse(kv.values.get('wallpaper-manifest-v1') ?? '{}')).toEqual(existing);
  expect(kv.putCalls).toBe(0);
  const after = await read();
  expect(after.status).toBe(200);
  expect(await after.text()).toBe(beforeBody);
  expect(after.headers.get('ETag')).toBe(before.headers.get('ETag'));
});
