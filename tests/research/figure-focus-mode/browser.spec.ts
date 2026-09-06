import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

async function viewportGeometry(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.site-header__inner');
    const box = header?.getBoundingClientRect();
    return { left: box?.left ?? -1, width: box?.width ?? -1, scrollY };
  });
}

test('focus mode moves and restores the same live figure instance', async ({ page }) => {
  await page.goto('/en/blog/frenet-arc-length-conversion/');
  const explorer = page.locator('[data-frenet-explorer="phi"]').first();
  await explorer.scrollIntoViewIfNeeded();
  await expect(explorer.locator('.frenet-main-plot .plot-container')).toBeVisible({
    timeout: 30_000,
  });

  const figure = page.locator('[data-figure-focus]').filter({ has: explorer });
  await explorer.evaluate((element) => {
    element.dataset.identityProbe = 'original';
  });
  await figure.locator('[data-figure-focus-toggle]').click();

  const dialog = page.locator('[data-figure-focus-dialog]');
  await expect(dialog).toHaveAttribute('open', '');
  await expect(dialog.locator('[data-identity-probe="original"]')).toHaveCount(1);

  await dialog.locator('[data-figure-focus-toggle]').click();
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(figure.locator('[data-identity-probe="original"]')).toHaveCount(1);
  await expect(figure.locator('[data-figure-focus-toggle]')).toBeFocused();
});

test('opening figure focus mode preserves shell geometry and page scroll', async ({ page }) => {
  await page.goto('/en/blog/frenet-arc-length-conversion/');
  const toggle = page.locator('[data-figure-focus-toggle]').first();
  await toggle.scrollIntoViewIfNeeded();
  const before = await viewportGeometry(page);
  await toggle.click();
  await expect(page.locator('[data-figure-focus-dialog]')).toHaveAttribute('open', '');
  const after = await viewportGeometry(page);
  expect(after.left).toBeCloseTo(before.left, 1);
  expect(after.width).toBeCloseTo(before.width, 1);
  await expect
    .poll(() => viewportGeometry(page).then((value) => value.scrollY))
    .toBeCloseTo(before.scrollY, 1);
});
