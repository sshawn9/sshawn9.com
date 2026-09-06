import { expect, test } from '@playwright/test';
import { dataUrl, routeWallpaperResources } from '../browser-fixtures';

test('each tab prepares exactly current and next even while scenic mode is off', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await page.addInitScript(() => {
    localStorage.setItem('wallpaper-enabled', 'false');
    localStorage.setItem('wallpaper-auto-rotation', 'false');
  });
  await page.goto('/en/blog/');

  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(sessionStorage.getItem('wallpaper-tab-state-v3') ?? '{}') as {
          currentSlot?: 'a' | 'b';
        };
        if (!state.currentSlot) return undefined;
        const nextSlot = state.currentSlot === 'a' ? 'b' : 'a';
        return {
          currentData: sessionStorage.getItem(`wallpaper-slot-${state.currentSlot}-data-v3`),
          nextData: sessionStorage.getItem(`wallpaper-slot-${nextSlot}-data-v3`),
        };
      }),
    )
    .toEqual({ currentData: dataUrl, nextData: dataUrl });

  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'default');
  await expect(page.locator('.wallpaper__stage')).toHaveCSS('opacity', '0');
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith('wallpaper-slot-'))
        .sort(),
    ),
  ).toEqual([
    'wallpaper-slot-a-data-v3',
    'wallpaper-slot-a-meta-v3',
    'wallpaper-slot-b-data-v3',
    'wallpaper-slot-b-meta-v3',
  ]);
});
