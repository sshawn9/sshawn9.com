import { expect, test } from '@playwright/test';
import { routeWallpaperResources, seedTwoSlots } from '../../wallpaper/browser-fixtures';

test('pending document navigation leaves header and wallpaper controls usable', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  let release!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  const target = '/en/blog/git-operations-reference/';
  await page.route(`**${target}`, async (route) => {
    if (route.request().resourceType() === 'fetch') await response;
    await route.continue();
  });
  try {
    await page.goto('/en/blog/');
    const header = page.locator('.site-header');
    const before = await header.boundingBox();
    const article = page.getByRole('link', { name: 'Git Operations Reference', exact: true });
    await article.evaluate((link) => {
      (link as HTMLElement).dataset.astroPrefetch = 'false';
    });
    await article.click();
    await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
    const theme = header.locator('[data-theme-toggle]').first();
    const oldTheme = await theme.getAttribute('aria-label');
    await theme.click();
    await expect(theme).not.toHaveAttribute('aria-label', oldTheme!);
    const chosenTheme = await theme.getAttribute('aria-label');
    await page.locator('[data-wallpaper-menu-trigger]').click();
    await page.locator('#wallpaper-settings [data-wallpaper-next]').click();
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
    const pending = await header.boundingBox();
    expect(pending).not.toBeNull();
    expect(pending!.x).toBeCloseTo(before!.x, 0);
    expect(pending!.y).toBeCloseTo(before!.y, 0);
    expect(pending!.height).toBeCloseTo(before!.height, 0);
    release();
    await expect(page).toHaveURL(new RegExp(`${target}$`));
    await expect(theme).toHaveAttribute('aria-label', chosenTheme!);
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
    await expect(page.locator('[data-wallpaper-credit-photographer]')).toHaveText(
      'Second Photographer',
    );
    await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending');
  } finally {
    release();
  }
});
