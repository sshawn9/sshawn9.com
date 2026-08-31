import { expect, test } from '@playwright/test';

test('storage rejection keeps the document and in-memory controls usable', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const reject = () => {
      throw new DOMException('Storage is unavailable.', 'SecurityError');
    };
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      Object.defineProperty(Storage.prototype, method, {
        configurable: true,
        value: reject,
      });
    }
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/blog/');

  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-font-state', /^(ready|degraded)$/);
  await expect(page.locator('[data-blog-listing]')).toHaveAttribute('data-blog-runtime-ready', '');

  const root = page.locator('html');
  const previousTheme = await root.getAttribute('data-theme');
  await page.locator('[data-shell-sync-key="theme-toggle"]').click();
  if (previousTheme) await expect(root).not.toHaveAttribute('data-theme', previousTheme);

  await page.getByRole('button', { name: 'Collapse blog sidebar' }).click();
  await expect(page.locator('[data-blog-sidebar-layout]')).toHaveAttribute(
    'data-sidebar-collapsed',
    '',
  );

  await page.locator('[data-shell-sync-key="projects"]').click();
  await expect(page).toHaveURL(/\/en\/projects\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Projects');
  expect(pageErrors).toEqual([]);
});
