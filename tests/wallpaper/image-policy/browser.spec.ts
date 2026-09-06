import { expect, test } from '@playwright/test';
import {
  photos,
  imageUrl,
  policyKey,
  routeWallpaperResources,
  seedTwoSlots,
} from '../browser-fixtures';

test('a new document policy replaces only next and leaves the visible current untouched', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 700 });
  const requests = await routeWallpaperResources(page);
  await seedTwoSlots(page, 960);
  await page.goto('/en/blog/');
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');

  requests.length = 0;
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const current = JSON.parse(sessionStorage.getItem('wallpaper-slot-a-meta-v3') ?? '{}') as {
          policyKey?: string;
        };
        const next = JSON.parse(sessionStorage.getItem('wallpaper-slot-b-meta-v3') ?? '{}') as {
          policyKey?: string;
        };
        return { current: current.policyKey, next: next.policyKey };
      }),
    )
    .toEqual({ current: policyKey(960), next: policyKey(2400) });
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
  expect(requests).toContain(imageUrl(photos[1].rawUrl, 2400));
  expect(requests.some((request) => request.includes('photo-one'))).toBe(false);
});
