import { expect, test } from '@playwright/test';

test('keyboard navigation focuses target content while pointer navigation preserves focus semantics', async ({
  page,
}) => {
  await page.goto('/zh/');
  const aboutLink = page.getByRole('link', { name: '关于' });
  await aboutLink.focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/zh\/about\/$/);
  await expect(page.locator('#main-content')).toBeFocused();
  const announcer = page.locator('.astro-route-announcer');
  await expect(announcer).toContainText('关于');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

  await page.getByRole('link', { name: '博客' }).click();
  await expect(page).toHaveURL(/\/zh\/blog\/$/);
  await expect(page.locator('#main-content')).not.toBeFocused();
});
