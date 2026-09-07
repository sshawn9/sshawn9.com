import { expect, test } from '@playwright/test';

test('the system theme is followed only until the visitor makes an explicit choice', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/en/blog/');
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveClass(/\bdark\b/);

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).not.toHaveClass(/\bdark\b/);

  await page.locator('[data-theme-toggle]').first().click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page).toHaveURL(/\/en\/projects\/$/);
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveClass(/\bdark\b/);
});

test('a corrupt saved theme safely falls back to the current system preference', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('theme', 'sepia'));
  await page.goto('/en/blog/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-appearance-ready', 'true');
  await expect(page.locator('[data-theme-toggle]').first()).toBeEnabled();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
