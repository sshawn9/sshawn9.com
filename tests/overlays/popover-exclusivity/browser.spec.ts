import { expect, test } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

const versionedArticlePath = '/en/blog/my-personal-website/';

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
