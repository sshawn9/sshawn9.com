import { expect, test } from '@playwright/test';
import { image, routeWallpaperResources, seedTwoSlots } from '../browser-fixtures';

test('a failed candidate request leaves the current photo intact and permits a successful retry', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await page.addInitScript(() => {
    sessionStorage.removeItem('wallpaper-slot-b-meta-v3');
    sessionStorage.removeItem('wallpaper-slot-b-data-v3');
  });
  let failImages = true;
  let failedRequests = 0;
  let releaseFailures: () => void = () => {};
  const failureGate = new Promise<void>((resolve) => {
    releaseFailures = resolve;
  });
  await page.route('https://images.unsplash.com/**', async (route) => {
    if (!failImages) {
      await route.fulfill({ contentType: 'image/png', body: image });
      return;
    }
    failedRequests += 1;
    await failureGate;
    await route.abort('failed');
  });

  await page.goto('/en/blog/');
  await page.locator('[data-wallpaper-menu-trigger]').click();
  const next = page.locator('#wallpaper-settings [data-wallpaper-next]');
  await expect(next).toBeEnabled();
  await expect.poll(() => failedRequests).toBeGreaterThan(0);
  await next.click();
  await expect(next).toHaveAttribute('aria-busy', 'true');
  releaseFailures();
  await expect(next).toHaveAttribute('aria-busy', 'false');
  await expect(next).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
  await expect(page.locator('[data-wallpaper-credit-photographer]')).toHaveText(
    'First Photographer',
  );

  failImages = false;
  await next.click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  await expect(page.locator('[data-wallpaper-credit-photographer]')).toHaveText(
    'Second Photographer',
  );
  await expect(next).toHaveAttribute('aria-busy', 'false');
  await expect(next).toBeEnabled();
});

test('disabling scenic mode cancels a pending decode without consuming the next photo', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await page.addInitScript(() => {
    const originalDecode = Image.prototype.decode;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    Object.assign(window, {
      __wallpaperCancellationGate: {
        get held() {
          return held;
        },
        release,
      },
    });
    Image.prototype.decode = function decode() {
      const decoded = originalDecode.call(this);
      if (held || !this.src.startsWith('data:image/')) return decoded;
      held = true;
      return gate.then(() => decoded);
    };
  });

  await page.goto('/en/blog/');
  await page.locator('[data-wallpaper-menu-trigger]').click();
  const next = page.locator('#wallpaper-settings [data-wallpaper-next]');
  const enabledControl = page.locator('#wallpaper-settings [data-wallpaper-enabled-control]');
  const enabled = enabledControl.locator('[data-wallpaper-enabled]');
  await next.click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __wallpaperCancellationGate?: { held: boolean } })
            .__wallpaperCancellationGate?.held ?? false,
      ),
    )
    .toBe(true);
  await enabledControl.click();
  await expect(enabled).not.toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'default');
  await page.evaluate(() => {
    (
      window as Window & { __wallpaperCancellationGate?: { release(): void } }
    ).__wallpaperCancellationGate?.release();
  });
  await expect(next).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');

  await enabledControl.click();
  await expect(enabled).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'scenic');
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
});
