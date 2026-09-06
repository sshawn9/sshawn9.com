import { expect, test } from '@playwright/test';

const blogPath = '/en/blog/';

function blogListing(page: import('@playwright/test').Page) {
  return page.locator('[data-blog-listing]');
}

test('mobile tag disclosure remains usable after a collapsed desktop sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(blogPath);
  await page.getByRole('button', { name: 'Collapse blog sidebar' }).click();
  await page.setViewportSize({ width: 760, height: 900 });

  const sidebar = page.getByRole('complementary', { name: 'Article tags' });
  const mobileToggle = page.getByRole('button', { name: 'Article tags' });
  const tagDefinitions = page.locator('[data-blog-tag-definition]');
  expect(await tagDefinitions.count()).toBeGreaterThan(0);
  await expect(sidebar).toBeVisible();
  await expect(sidebar).not.toHaveAttribute('aria-hidden', 'true');
  await expect(mobileToggle).toBeVisible();
  await expect(tagDefinitions.first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page
      .locator('.blog-tag-name')
      .evaluateAll((elements) =>
        elements.every((element) => element.scrollWidth <= element.clientWidth + 1),
      ),
  ).toBe(true);

  await mobileToggle.click();
  await expect(mobileToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(tagDefinitions.first()).toBeHidden();
  await mobileToggle.click();
  await expect(mobileToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(tagDefinitions.first()).toBeVisible();
});

test('mobile pagination and traversal retain the live tag disclosure state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(blogPath);
  const disclosure = page.locator('[data-blog-mobile-toggle]');
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await page.locator('[data-blog-page="next"]').click();
  await expect(blogListing(page)).toHaveAttribute('data-current-page', '2');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await page.goBack();
  await expect(blogListing(page)).toHaveAttribute('data-current-page', '1');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
});
