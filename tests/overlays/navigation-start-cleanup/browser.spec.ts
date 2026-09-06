import { expect, test } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

test('persistent popovers close at navigation start instead of surviving until page swap', async ({
  page,
}) => {
  let releaseResponse = () => {};
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });

  await page.route('**/en/projects/', async (route) => {
    if (route.request().resourceType() !== 'fetch') {
      await route.continue();
      return;
    }
    await responseGate;
    await route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/blog/');
  await page.locator('[data-wallpaper-menu-trigger]').click();
  await expect(page.locator('#wallpaper-settings')).toHaveCSS('display', 'block');

  await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>(
      '.site-header__nav-link[href="/en/projects/"]',
    );
    if (!link) throw new Error('Missing Projects navigation link.');
    link.dataset.astroPrefetch = 'false';
    link.click();
  });

  await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
  await expect(page.locator('#wallpaper-settings')).not.toHaveCSS('display', 'block');
  await expect(page.locator('[data-blog-listing]')).toBeVisible();

  releaseResponse();
  await expect(page).toHaveURL(/\/en\/projects\/$/);
});

test('modal figure and media viewers close while navigation is preparing', async ({ page }) => {
  let releaseBlogResponse = () => {};
  let gateBlogResponse = false;
  const blogResponseGate = new Promise<void>((resolve) => {
    releaseBlogResponse = resolve;
  });
  await page.route('**/en/blog/', async (route) => {
    if (!gateBlogResponse || route.request().resourceType() !== 'fetch') {
      await route.continue();
      return;
    }
    await blogResponseGate;
    await route.continue();
  });

  await page.goto('/en/blog/frenet-arc-length-conversion/');
  const figureToggle = page.locator('[data-figure-focus-toggle]').first();
  await figureToggle.scrollIntoViewIfNeeded();
  await figureToggle.click();
  await expect(page.locator('[data-figure-focus-dialog]')).toHaveAttribute('open', '');

  gateBlogResponse = true;
  await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>(
      '.site-header__nav-link[href="/en/blog/"]',
    );
    if (!link) throw new Error('Missing Blog navigation link.');
    link.dataset.astroPrefetch = 'false';
    link.click();
  });
  await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
  await expect(page.locator('[data-figure-focus-dialog]')).not.toHaveAttribute('open', '');
  releaseBlogResponse();
  await expect(page).toHaveURL(/\/en\/blog\/$/);

  let releaseSecondBlogResponse = () => {};
  const secondBlogResponseGate = new Promise<void>((resolve) => {
    releaseSecondBlogResponse = resolve;
  });
  await page.unroute('**/en/blog/');
  await page.route('**/en/blog/', async (route) => {
    if (route.request().resourceType() !== 'fetch') {
      await route.continue();
      return;
    }
    await secondBlogResponseGate;
    await route.continue();
  });

  await page.goto('/en/blog/self-hosting-tools-and-services/');
  await expect(page.locator('.article-prose')).toHaveAttribute(
    'data-article-media-runtime',
    'ready',
  );
  const mediaItem = page.locator('a[data-article-media-item]').first();
  await mediaItem.scrollIntoViewIfNeeded();
  await mediaItem.click();
  await expect(page.locator('.pswp')).toBeVisible();

  await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>(
      '.site-header__nav-link[href="/en/blog/"]',
    );
    if (!link) throw new Error('Missing Blog navigation link.');
    link.dataset.astroPrefetch = 'false';
    link.click();
  });
  await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
  await expect(page.locator('.pswp')).not.toBeVisible();
  releaseSecondBlogResponse();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
});
