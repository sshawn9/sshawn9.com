import { expect, test, type Page } from '@playwright/test';
import { manifest, routeWallpaperResources, seedTwoSlots } from '../browser-fixtures';

type ManifestRefreshWindow = Window & { __wallpaperManifestRefreshAt?: number };

async function waitForManifestRefresh(page: Page) {
  // A request being received does not mean the page has processed its response.
  await expect
    .poll(() =>
      page.evaluate(
        () => ((window as ManifestRefreshWindow).__wallpaperManifestRefreshAt ?? 0) > Date.now(),
      ),
    )
    .toBe(true);
}

async function prepare(page: Page) {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await page.clock.install();
  await page.addInitScript(() => {
    const browserWindow = window as ManifestRefreshWindow;
    const schedule = browserWindow.setTimeout.bind(browserWindow);
    const interval = 5 * 60 * 60_000;
    browserWindow.setTimeout = (handler, delay, ...args) => {
      const id = schedule(handler, delay, ...args);
      if (delay !== undefined && delay > interval - 60_000 && delay <= interval) {
        browserWindow.__wallpaperManifestRefreshAt = Date.now() + delay;
      }
      return id;
    };
  });
  let requests = 0;
  await page.route('**/api/wallpapers', async (route) => {
    requests += 1;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) });
  });
  await page.goto('/en/blog/');
  await expect.poll(() => requests).toBe(1);
  await waitForManifestRefresh(page);
  await page.locator('[data-wallpaper-menu-trigger]').click();
  return () => requests;
}

test('advance, spare preparation and preference changes do not postpone manifest revalidation', async ({
  page,
}) => {
  const requests = await prepare(page);
  await page.clock.fastForward(4 * 60 * 60_000);
  const next = page.locator('#wallpaper-settings [data-wallpaper-next]');
  await next.click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  await expect(next).toHaveAttribute('aria-busy', 'false');
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(sessionStorage.getItem('wallpaper-slot-a-meta-v3') ?? '{}').photo?.id,
      ),
    )
    .toBe('photo-one');
  const enabled = page.locator('#wallpaper-settings [data-wallpaper-enabled-control]');
  await enabled.click();
  await enabled.click();
  await page.locator('[data-theme-toggle]').first().click();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await page.clock.fastForward(59 * 60_000);
  expect(requests()).toBe(1);
  await page.clock.fastForward(61_000);
  await expect.poll(requests).toBe(2);
  await waitForManifestRefresh(page);
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  await page.clock.fastForward((5 * 60 - 1) * 60_000);
  expect(requests()).toBe(2);
  await page.clock.fastForward(61_000);
  await expect.poll(requests).toBe(3);
});

test('visibility pauses the timer but retains the deadline and performs one overdue refresh', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    Object.assign(window, {
      __setWallpaperHidden(value: boolean) {
        hidden = value;
        document.dispatchEvent(new Event('visibilitychange'));
      },
    });
  });
  const setHidden = (hidden: boolean) =>
    page.evaluate((hidden) => {
      (
        window as Window & { __setWallpaperHidden?: (value: boolean) => void }
      ).__setWallpaperHidden?.(hidden);
    }, hidden);
  const requests = await prepare(page);
  await page.clock.fastForward(4 * 60 * 60_000);
  await setHidden(true);
  await page.clock.fastForward(2 * 60 * 60_000);
  expect(requests()).toBe(1);
  await setHidden(false);
  await expect.poll(requests).toBe(2);
  await waitForManifestRefresh(page);
  await page.clock.fastForward(3 * 60 * 60_000);
  await setHidden(true);
  await page.clock.fastForward(60 * 60_000);
  await setHidden(false);
  expect(requests()).toBe(2);
  await page.clock.fastForward(59 * 60_000);
  expect(requests()).toBe(2);
  await page.clock.fastForward(61_000);
  await expect.poll(requests).toBe(3);
});
