import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DOWNLOAD_TIMEOUT_MS,
  MANIFEST_RETRY_MS,
  MANIFEST_TIMEOUT_MS,
} from '../../../apps/site/src/features/appearance/wallpaper/model';
import { image, manifest, routeWallpaperResources, seedTwoSlots } from '../browser-fixtures';

let server: Server;
let origin: string;
let phase: 'headers' | 'body' | 'http-error';
let kind: 'manifest' | 'download';
let recovered: boolean;
let requests: number;
let cancelled: number;

test.beforeEach(async ({ page }) => {
  recovered = false;
  requests = 0;
  cancelled = 0;
  server = createServer((_request, response) => {
    requests++;
    response.statusCode = !recovered && phase === 'http-error' ? 503 : 200;
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', kind === 'manifest' ? 'application/json' : 'image/jpeg');
    const body = kind === 'manifest' ? Buffer.from(JSON.stringify(manifest)) : image;
    if (recovered) {
      response.end(body);
      return;
    }
    response.on('close', () => {
      if (!response.writableEnded) cancelled++;
    });
    if (phase !== 'headers') response.write(body.subarray(0, Math.ceil(body.length / 2)));
    // Leave either the response headers or the remaining body pending.
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await page.clock.install();
});

test.afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
});

async function useFaultEndpoint(page: Page) {
  await page.addInitScript(
    ({ origin, kind }) => {
      const fetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        const selected =
          kind === 'manifest'
            ? url.pathname === '/api/wallpapers'
            : url.hostname === 'images.unsplash.com' && url.searchParams.get('q') === '90';
        // Only redirect the address. Native fetch still owns the signal and body stream.
        return fetch(selected ? `${origin}/fault` : input, init);
      };
      if (kind === 'manifest') {
        sessionStorage.removeItem('wallpaper-slot-b-meta-v3');
        sessionStorage.removeItem('wallpaper-slot-b-data-v3');
      }
    },
    { origin, kind },
  );
}

function currentAppearance(page: Page) {
  return page.evaluate(() => ({
    photo: document.documentElement.dataset.wallpaperPhotoId,
    mode: document.documentElement.dataset.wallpaperMode,
    theme: document.documentElement.dataset.theme,
    state: sessionStorage.getItem('wallpaper-tab-state-v3'),
    current: sessionStorage.getItem('wallpaper-slot-a-data-v3'),
  }));
}

for (const responseCase of ['headers', 'body', 'http-error'] as const) {
  test(`a manifest with ${responseCase} failure is cancelled and Next recovers without replacing the current photo`, async ({
    page,
  }) => {
    phase = responseCase;
    kind = 'manifest';
    await useFaultEndpoint(page);
    await page.goto('/en/blog/');
    await expect.poll(() => requests).toBe(1);
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
    const before = await currentAppearance(page);
    await page.locator('[data-wallpaper-menu-trigger]').click();
    const next = page.locator('#wallpaper-settings [data-wallpaper-next]');
    await next.click();
    if (phase !== 'http-error') {
      await expect(next).toHaveAttribute('aria-busy', 'true');
      await page.clock.fastForward(MANIFEST_TIMEOUT_MS + 1);
    }
    await expect.poll(() => cancelled).toBe(1);
    await expect(next).toHaveAttribute('aria-busy', 'false');
    await expect(next).toBeEnabled();
    expect(await currentAppearance(page)).toEqual(before);
    expect(requests).toBe(1);

    recovered = true;
    await page.clock.fastForward(MANIFEST_RETRY_MS + 1);
    await expect.poll(() => requests).toBe(2);
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('wallpaper-slot-b-data-v3')))
      .not.toBeNull();
    await next.click();
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
    await expect(next).toHaveAttribute('aria-busy', 'false');
    expect(cancelled).toBe(1);
  });

  test(`a download with ${responseCase} failure is cancelled and can be retried without duplicate files or reports`, async ({
    page,
  }) => {
    phase = responseCase;
    kind = 'download';
    await useFaultEndpoint(page);
    const files: string[] = [];
    const reports: string[] = [];
    page.on('download', (download) => files.push(download.suggestedFilename()));
    await page.route('**/api/wallpapers/download', async (route) => {
      reports.push(route.request().postDataJSON().photoId);
      await route.fulfill({ status: 204 });
    });
    await page.goto('/en/blog/');
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
    const before = await currentAppearance(page);
    await page.locator('[data-wallpaper-menu-trigger]').click();
    const button = page.locator('#wallpaper-settings [data-wallpaper-download]');
    expect(DOWNLOAD_TIMEOUT_MS).toBe(120_000);
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
    await button.click();
    await expect.poll(() => requests).toBe(1);
    if (phase !== 'http-error') {
      await expect(button).toHaveAttribute('aria-busy', 'true');
      // An explicit high-quality download does not inherit the short metadata deadline.
      await page.clock.fastForward(MANIFEST_TIMEOUT_MS + 1);
      await expect(button).toHaveAttribute('aria-busy', 'true');
      expect(cancelled).toBe(0);
      await page.clock.fastForward(DOWNLOAD_TIMEOUT_MS - MANIFEST_TIMEOUT_MS - 2);
      await expect(button).toHaveAttribute('aria-busy', 'true');
      expect(cancelled).toBe(0);
      await page.clock.fastForward(1);
    }
    await expect.poll(() => cancelled).toBe(1);
    await expect(button).toHaveAttribute('aria-busy', 'false');
    await expect(button).toBeEnabled();
    expect(files).toEqual([]);
    expect(reports).toEqual([]);
    expect(requests).toBe(1);
    expect(await currentAppearance(page)).toEqual(before);

    recovered = true;
    const saved = page.waitForEvent('download');
    await button.click();
    const download = await saved;
    expect(await download.failure()).toBeNull();
    await expect(button).toHaveAttribute('aria-busy', 'false');
    await expect(button).toBeEnabled();
    await expect.poll(() => reports).toEqual(['photo-one']);
    expect(files).toEqual(['unsplash-photo-one.jpg']);
    expect(requests).toBe(2);
    expect(await currentAppearance(page)).toEqual(before);
  });
}
