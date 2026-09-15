import { afterEach, expect, it, vi } from 'vitest';
import worker from '../../../worker/index';
import { MemoryKv, storedManifest } from '../worker-fixtures';

const origin = 'https://sshawn9.com';
const manifestKey = 'wallpaper-manifest-v1';
const failures = ['KV rejection', 'invalid stored JSON'] as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(failure: (typeof failures)[number]) {
  const kv = new MemoryKv();
  const stored = JSON.stringify(storedManifest('2026-09-15T00:00:00.000Z'));
  kv.values.set(manifestKey, failure === 'invalid stored JSON' ? '{' : stored);
  const get = vi.spyOn(kv, 'get');
  const expectedError =
    failure === 'KV rejection' ? new Error('KV read failed.') : expect.any(SyntaxError);
  if (failure === 'KV rejection') get.mockRejectedValue(expectedError);
  const upstream = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', upstream);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const env = {
    WALLPAPER_MANIFEST: kv,
    UNSPLASH_ACCESS_KEY: 'test-access-key',
    ASSETS: { fetch: vi.fn() },
  };
  const context = { waitUntil: vi.fn<(task: Promise<unknown>) => void>() };
  return { kv, stored, get, expectedError, upstream, log, env, context };
}

function manifestRequest(method: string) {
  return new Request(`${origin}/api/wallpapers${method === 'POST' ? '/download' : ''}`, {
    method,
    ...(method === 'POST'
      ? {
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify({ photoId: 'cached' }),
        }
      : {}),
  });
}

for (const failure of failures) {
  it.each(['GET', 'HEAD', 'POST'])(
    `returns 503 without side effects for ${failure} on %s, then recovers on the next request`,
    async (method) => {
      const { kv, stored, get, expectedError, upstream, log, env, context } = setup(failure);
      const before = kv.values.get(manifestKey);

      const response = await worker.fetch(manifestRequest(method), env, context);

      expect(response.status).toBe(503);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Retry-After')).toBe('60');
      expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
      expect(response.headers.get('ETag')).toBeNull();
      expect(await response.text()).toBe(
        method === 'HEAD' ? '' : JSON.stringify({ error: 'Wallpaper manifest unavailable.' }),
      );
      expect(log).toHaveBeenCalledExactlyOnceWith(
        'Unable to read the wallpaper manifest.',
        expectedError,
      );
      expect(get).toHaveBeenCalledExactlyOnceWith(manifestKey, 'json');
      expect(upstream).not.toHaveBeenCalled();
      expect(context.waitUntil).not.toHaveBeenCalled();
      expect(kv.putCalls).toBe(0);
      expect(kv.values.get(manifestKey)).toBe(before);

      // Repair only the fixture; the Worker must not retain a failed read.
      get.mockRestore();
      kv.values.set(manifestKey, stored);
      const recovered = await worker.fetch(manifestRequest(method), env, context);
      expect(recovered.status).toBe(method === 'POST' ? 202 : 200);
      if (method === 'POST') {
        expect(context.waitUntil).toHaveBeenCalledOnce();
        await context.waitUntil.mock.calls[0]![0];
        expect(upstream).toHaveBeenCalledOnce();
      } else {
        expect(recovered.headers.get('ETag')).toBe('W/"wallpapers-2026-09-15T00:00:00.000Z"');
        expect(upstream).not.toHaveBeenCalled();
        if (method === 'HEAD') expect(await recovered.text()).toBe('');
      }
      expect(log).toHaveBeenCalledOnce();
      expect(kv.putCalls).toBe(0);
    },
  );

  it(`keeps the scheduled refresh failed and preserves storage after ${failure}`, async () => {
    const { kv, expectedError, upstream, log, env, context } = setup(failure);
    const before = kv.values.get(manifestKey);

    worker.scheduled(undefined, env, context);
    expect(context.waitUntil).toHaveBeenCalledOnce();
    await expect(context.waitUntil.mock.calls[0]![0]).rejects.toEqual(expectedError);

    expect(log).toHaveBeenCalledExactlyOnceWith(
      'Scheduled wallpaper refresh failed.',
      expectedError,
    );
    expect(upstream).not.toHaveBeenCalled();
    expect(kv.putCalls).toBe(0);
    expect(kv.values.get(manifestKey)).toBe(before);
  });
}

it.each([
  { path: '/api/wallpapers', method: 'DELETE', status: 405 },
  { path: '/api/wallpapers/download', method: 'GET', status: 405 },
  { headers: { Origin: 'https://example.com' }, status: 403 },
  { headers: { 'Content-Type': 'text/plain' }, status: 415 },
  { body: '{', status: 400 },
  { body: JSON.stringify({ photoId: '' }), status: 400 },
])('preserves request validation ($status) before a failing KV read: %j', async (input) => {
  const { get, kv, upstream, log, env, context } = setup('KV rejection');
  const request = new Request(`${origin}${input.path ?? '/api/wallpapers/download'}`, {
    method: input.method ?? 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...input.headers },
    ...(input.method ? {} : { body: input.body ?? JSON.stringify({ photoId: 'cached' }) }),
  });

  const response = await worker.fetch(request, env, context);

  expect(response.status).toBe(input.status);
  expect(get).not.toHaveBeenCalled();
  expect(upstream).not.toHaveBeenCalled();
  expect(context.waitUntil).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
  expect(kv.putCalls).toBe(0);
});
