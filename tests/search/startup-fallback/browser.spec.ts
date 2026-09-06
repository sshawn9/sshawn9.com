import { expect, test } from '@playwright/test';

test('search loading failure exposes a static fallback link', async ({ page }) => {
  await page.route(/\/pagefind\/pagefind\.js(?:\?.*)?$/, (route) => route.abort());

  await page.goto('/en/search/?q=website');
  await expect(page.locator('[data-site-search]')).toHaveAttribute('data-search-failed', '', {
    timeout: 12_000,
  });
  await expect(page.getByText('Search is temporarily unavailable')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Blog' }).last()).toHaveAttribute(
    'href',
    '/en/blog/',
  );
});
