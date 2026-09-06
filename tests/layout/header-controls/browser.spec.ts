import { expect, test } from '@playwright/test';

test('the header exposes theme and utility controls across desktop and mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/blog/');

  const header = page.locator('.site-header');
  const github = header.getByRole('link', { name: "View Shawn's GitHub profile" }).first();
  const locale = header.getByRole('link', { name: 'Switch to 中文' }).first();
  const theme = header.locator('[data-theme-toggle]').first();
  await expect(github).toBeVisible();
  await expect(locale).toBeVisible();
  await expect(theme).toBeVisible();
  await expect(theme).toHaveAccessibleName('Switch to dark mode');
  await expect(theme).toHaveCSS('border-top-style', 'none');
  expect((await theme.boundingBox())?.width).toBe(40);
  await expect(theme.locator('.site-header__theme-light')).toBeVisible();
  await expect(theme.locator('.site-header__theme-dark')).toBeHidden();

  await theme.click();
  await expect(theme).toHaveAccessibleName('Switch to light mode');
  await expect(theme.locator('.site-header__theme-light')).toBeHidden();
  await expect(theme.locator('.site-header__theme-dark')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const menu = header.locator('[data-mobile-menu-trigger]');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAccessibleName('Open navigation');
  await menu.click();
  await expect(menu).toHaveAccessibleName('Close navigation');
  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNavigation.getByRole('link', { name: 'Projects' })).toBeVisible();
  await expect(
    page
      .locator('[data-shell-mobile-menu]')
      .getByRole('link', { name: "View Shawn's GitHub profile" }),
  ).toBeVisible();
});
