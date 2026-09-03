import { expect, test, type Page } from '@playwright/test';

const versionedArticlePath = '/en/blog/my-personal-website/';

test.describe.configure({ timeout: 60_000 });

async function viewportGeometry(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.site-header__inner');
    const box = header?.getBoundingClientRect();
    return { left: box?.left ?? -1, width: box?.width ?? -1, scrollY };
  });
}

test('transient popovers stay exclusive and close when their invoking layout disappears', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(versionedArticlePath);

  const mobileMenu = page.locator('[data-shell-mobile-menu]');
  const wallpaperSettings = page.locator('#wallpaper-settings');
  await page.locator('[data-mobile-menu-trigger]').click();
  await expect(mobileMenu).toHaveCSS('display', 'block');
  await expect(mobileMenu.locator('[data-wallpaper-enabled-control]')).toBeVisible();
  await expect(mobileMenu.locator('[data-wallpaper-menu-trigger]')).toHaveCount(0);

  await page.evaluate(() => {
    const toggle = document.querySelector<HTMLButtonElement>('[data-article-mobile-toc-toggle]');
    toggle?.focus();
    toggle?.click();
  });
  await expect(mobileMenu).not.toHaveCSS('display', 'block');
  await expect(page.locator('#article-toc-mobile')).toHaveCSS('display', 'block');

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('#article-toc-mobile')).not.toHaveCSS('display', 'block');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return active?.hasAttribute('data-site-identity') ? 'home' : (active?.tagName ?? 'none');
      }),
    )
    .toBe('home');

  const versionToggle = page.locator('#article-sidebar [data-article-popover-toggle]');
  const comparison = page.locator('#article-version-comparison-desktop');
  await page.locator('[data-wallpaper-menu-trigger]').click();
  await expect(wallpaperSettings).toHaveCSS('display', 'block');
  await versionToggle.evaluate((toggle) => {
    (toggle as HTMLButtonElement).focus();
    (toggle as HTMLButtonElement).click();
  });
  await expect(wallpaperSettings).not.toHaveCSS('display', 'block');
  await expect(comparison).toHaveCSS('display', 'block');

  await page.setViewportSize({ width: 800, height: 900 });
  await expect(comparison).not.toHaveCSS('display', 'block');
  await expect(page.locator('[data-site-identity]')).toBeFocused();
});

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
  const figurePageGeometry = await viewportGeometry(page);
  await figureToggle.click();
  await expect(page.locator('[data-figure-focus-dialog]')).toHaveAttribute('open', '');
  const focusedFigureGeometry = await viewportGeometry(page);
  expect(focusedFigureGeometry.left).toBeCloseTo(figurePageGeometry.left, 1);
  expect(focusedFigureGeometry.width).toBeCloseTo(figurePageGeometry.width, 1);
  await expect
    .poll(() => viewportGeometry(page).then((geometry) => geometry.scrollY))
    .toBeCloseTo(figurePageGeometry.scrollY, 1);

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
  const mediaPageGeometry = await viewportGeometry(page);
  await mediaItem.click();
  await expect(page.locator('.pswp')).toBeVisible();
  const mediaViewerGeometry = await viewportGeometry(page);
  expect(mediaViewerGeometry.left).toBeCloseTo(mediaPageGeometry.left, 1);
  expect(mediaViewerGeometry.width).toBeCloseTo(mediaPageGeometry.width, 1);
  expect(mediaViewerGeometry.scrollY).toBeCloseTo(mediaPageGeometry.scrollY, 1);

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
