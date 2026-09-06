import { expect, test } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

test('Frenet and closed-loop islands render their expected plot containers', async ({ page }) => {
  await page.goto('/en/blog/frenet-arc-length-conversion/');
  await expect(page.locator('[data-frenet-explorer]')).toHaveCount(10);

  const firstExplorer = page.locator('[data-frenet-explorer="phi"]').first();
  await firstExplorer.scrollIntoViewIfNeeded();
  await expect(firstExplorer.locator('.frenet-main-plot .plot-container')).toBeVisible({
    timeout: 30_000,
  });

  await page.goto('/en/blog/closed-loop-control-timing/');
  await expect(page.locator('.closed-loop-control-timing-plot svg')).toBeVisible({
    timeout: 30_000,
  });
});
