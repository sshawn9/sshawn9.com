import { expect, test } from '@playwright/test';
import { routeWallpaperResources, seedTwoSlots } from '../browser-fixtures';

test('a saved photo and attribution own every warm-refresh first frame without replay', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const imageRequests = await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await page.addInitScript(() => {
    document.addEventListener('transitionrun', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-backdrop-surface]')) return;
      document.documentElement.dataset.wallpaperTransitionRuns = String(
        Number(document.documentElement.dataset.wallpaperTransitionRuns ?? '0') + 1,
      );
    });
    const observer = new PerformanceObserver((entries, self) => {
      if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      self.disconnect();
      const root = document.documentElement;
      const active = document.querySelector<HTMLElement>(
        '.wallpaper__image[data-wallpaper-slot="a"]',
      );
      const credit = document.querySelector<HTMLElement>('[data-wallpaper-credit]');
      root.dataset.wallpaperFirstPaint = JSON.stringify({
        id: root.dataset.wallpaperPhotoId,
        image: active ? getComputedStyle(active).backgroundImage !== 'none' : false,
        credit: credit?.textContent?.includes('First Photographer') ?? false,
      });
    });
    observer.observe({ type: 'paint', buffered: true });
  });

  await page.goto('/en/blog/');
  imageRequests.length = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
    await expect(page.locator('html')).toHaveAttribute(
      'data-wallpaper-first-paint',
      JSON.stringify({ id: 'photo-one', image: true, credit: true }),
    );
    expect(
      await page.evaluate(() =>
        Number(document.documentElement.dataset.wallpaperTransitionRuns ?? '0'),
      ),
    ).toBe(0);
  }
  expect(imageRequests).toEqual([]);
});
