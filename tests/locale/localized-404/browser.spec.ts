import { expect, test } from '@playwright/test';

test('the root fallback preserves the 404 status and uses the route locale', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('PARAGLIDE_LOCALE', 'en'));

  const response = await page.goto('/zh/does-not-exist/');

  expect(response?.status()).toBe(404);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page).toHaveTitle('页面未找到 · SHAWN');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('这里是 404 页面');
  await expect(page.getByRole('link', { name: '回到首页' })).toHaveAttribute('href', '/zh/');
  await expect(page.getByRole('link', { name: '搜索内容' })).toHaveAttribute('href', '/zh/search/');
});
