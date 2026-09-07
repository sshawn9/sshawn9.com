import { expect, test, type Page } from '@playwright/test';
import { image, routeWallpaperResources, seedTwoSlots } from '../browser-fixtures';

type AppearanceSnapshot = {
  theme: string | undefined;
  savedTheme: string | null;
  mode: string | undefined;
  wallpaperEnabled: string | null;
  autoRotation: string | null;
  currentPhoto: string | undefined;
  tabState: string | null;
};

async function appearanceSnapshot(page: Page): Promise<AppearanceSnapshot> {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    savedTheme: localStorage.getItem('theme'),
    mode: document.documentElement.dataset.wallpaperMode,
    wallpaperEnabled: localStorage.getItem('wallpaper-enabled'),
    autoRotation: localStorage.getItem('wallpaper-auto-rotation'),
    currentPhoto: document.documentElement.dataset.wallpaperPhotoId,
    tabState: sessionStorage.getItem('wallpaper-tab-state-v3'),
  }));
}

test('theme and scenic mode change only their own preference and presentation', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600, { autoRotation: false });
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  await page.goto('/en/blog/');
  const menu = page.locator('[data-wallpaper-menu-trigger]');
  await menu.click();

  const before = await appearanceSnapshot(page);
  await page.locator('[data-theme-toggle]').first().click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const afterTheme = await appearanceSnapshot(page);
  expect(afterTheme).toEqual({ ...before, theme: 'dark', savedTheme: 'dark' });

  await menu.click();
  const enabledControl = page.locator('#wallpaper-settings [data-wallpaper-enabled-control]');
  const enabled = enabledControl.locator('[data-wallpaper-enabled]');
  await enabledControl.click();
  await expect(enabled).not.toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'default');
  expect(await appearanceSnapshot(page)).toEqual({
    ...afterTheme,
    mode: 'default',
    wallpaperEnabled: 'false',
  });

  await enabledControl.click();
  await expect(enabled).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'scenic');
  expect(await appearanceSnapshot(page)).toEqual(afterTheme);
});

test('auto rotation and next change only their owned state', async ({ page }) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600, { autoRotation: false });
  await page.goto('/en/blog/');
  await page.locator('[data-wallpaper-menu-trigger]').click();

  const beforeAuto = await appearanceSnapshot(page);
  const autoRotationControl = page.locator(
    '#wallpaper-settings [data-wallpaper-auto-rotation-control]',
  );
  const autoRotation = autoRotationControl.locator('[data-wallpaper-auto-rotation]');
  await autoRotationControl.click();
  await expect(autoRotation).toBeChecked();
  const afterAuto = await appearanceSnapshot(page);
  expect(afterAuto).toEqual({ ...beforeAuto, autoRotation: 'true' });

  const next = page.locator('#wallpaper-settings [data-wallpaper-next]');
  await next.click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  await expect(next).toHaveAttribute('aria-busy', 'false');
  const afterNext = await appearanceSnapshot(page);
  expect(afterNext.theme).toBe(afterAuto.theme);
  expect(afterNext.mode).toBe(afterAuto.mode);
  expect(afterNext.autoRotation).toBe(afterAuto.autoRotation);
  expect(afterNext.currentPhoto).toBe('photo-two');
  expect(afterNext.tabState).not.toBe(afterAuto.tabState);
});

test('download saves the visible photo without changing appearance or the queue', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  let releaseDownload: () => void = () => {};
  const downloadGate = new Promise<void>((resolve) => {
    releaseDownload = resolve;
  });
  let downloadRequested = false;
  let reportedPhoto: string | undefined;
  await page.route('https://images.unsplash.com/photo-one?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') !== '90') {
      await route.fallback();
      return;
    }
    downloadRequested = true;
    await downloadGate;
    await route.fulfill({ contentType: 'image/jpeg', body: image });
  });
  await page.route('**/api/wallpapers/download', async (route) => {
    reportedPhoto = ((await route.request().postDataJSON()) as { photoId?: string }).photoId;
    await route.fulfill({ status: 204 });
  });

  await page.goto('/en/blog/');
  await page.locator('[data-wallpaper-menu-trigger]').click();
  const downloadButton = page.locator('#wallpaper-settings [data-wallpaper-download]');
  const before = await appearanceSnapshot(page);
  const downloadEvent = page.waitForEvent('download');
  await downloadButton.click();
  await expect.poll(() => downloadRequested).toBe(true);
  await expect(downloadButton).toHaveAttribute('aria-busy', 'true');
  releaseDownload();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('unsplash-photo-one.jpg');
  await expect(downloadButton).toHaveAttribute('aria-busy', 'false');
  await expect(downloadButton).toBeEnabled();
  expect(await appearanceSnapshot(page)).toEqual(before);
  await expect.poll(() => reportedPhoto).toBe('photo-one');
});
