import { expect, test } from '@playwright/test';

test('fallback article content cannot override the requested interface language', async ({
  page,
}) => {
  await page.goto('/en/blog/obsidian-wayland-app-id-mismatch/');

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('article[data-article-page]')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.locator('.article-fallback-notice')).toBeVisible();
});
