import { expect, test, type Page } from '@playwright/test';

const comparisonPath = '/en/blog/my-personal-website/compare/?base=1&compare=2';

function visibleLocator(page: Page, selector: string) {
  return page.locator(`${selector}:visible`);
}

test('comparison layout follows its width threshold and preserves an explicit display mode', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(comparisonPath);
  await expect(page.locator('[data-diff-panel="split"]')).toBeVisible();
  expect(
    await page.locator('[data-version-comparison-main]').evaluate((main) => main.clientWidth),
  ).toBeGreaterThanOrEqual(760);

  await visibleLocator(page, '[data-diff-mode="unified"]').click();
  await expect(page.locator('[data-diff-panel="unified"]')).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 900 });
  expect(
    await page.locator('[data-version-comparison-main]').evaluate((main) => main.clientWidth),
  ).toBeLessThan(760);
  await expect(page.locator('[data-diff-panel="unified"]')).toBeVisible();

  await page.reload();
  await expect(page.locator('[data-diff-panel="unified"]')).toBeVisible();
  await visibleLocator(page, '[data-diff-mode="split"]').click();
  await expect(page.locator('[data-diff-panel="split"]')).toBeVisible();
});
