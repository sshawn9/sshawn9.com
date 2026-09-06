import { expect, test } from '@playwright/test';

const blogPath = '/en/blog/';

test('listing emphasis and pagination retain the tuned information hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(blogPath);

  const results = page.locator('[data-blog-results]');
  const resultCount = page.locator('[data-blog-result-count]');
  await expect(resultCount).toHaveText(/Articles: \d+ · Page 1 of 2/);
  await expect(page.locator('[data-blog-page-status]')).toHaveCount(0);

  const previous = page.locator('[data-blog-page="previous"]');
  const next = page.locator('[data-blog-page="next"]');
  await expect(previous).toBeHidden();
  await expect(next).toBeVisible();
  const firstResultsBox = await results.boundingBox();
  const nextBox = await next.boundingBox();
  expect(firstResultsBox).not.toBeNull();
  expect(nextBox).not.toBeNull();
  expect(
    Math.abs(nextBox!.x + nextBox!.width - (firstResultsBox!.x + firstResultsBox!.width)),
  ).toBeLessThan(1);
  const footerBox = await page.locator('.site-footer').boundingBox();
  expect(footerBox).not.toBeNull();
  expect(footerBox!.y - (nextBox!.y + nextBox!.height)).toBeGreaterThanOrEqual(60);

  const firstTitle = page.locator('.blog-article h2 a').first();
  await expect(firstTitle).toHaveCSS('text-decoration-line', 'none');
  await firstTitle.hover();
  await expect(firstTitle).toHaveCSS('text-decoration-line', 'underline');

  const selectedFilter = page.locator('[data-blog-tag-definition][data-tag-slug="astro"]');
  await selectedFilter.click();
  await expect(selectedFilter).toHaveCSS('font-weight', '700');
  const selectedArticleTag = page
    .locator('[data-blog-article]:not([hidden]) [data-blog-filter-link][data-selected]')
    .first();
  await expect(selectedArticleTag).toBeVisible();
  expect(
    await selectedArticleTag.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.color !== style.backgroundColor;
    }),
  ).toBe(true);

  await page.goto(`${blogPath}?page=2`);
  await expect(resultCount).toHaveText(/Articles: \d+ · Page 2 of 2/);
  await expect(previous).toBeVisible();
  await expect(next).toBeHidden();
  const secondResultsBox = await results.boundingBox();
  const previousBox = await previous.boundingBox();
  expect(secondResultsBox).not.toBeNull();
  expect(previousBox).not.toBeNull();
  expect(Math.abs(previousBox!.x - secondResultsBox!.x)).toBeLessThan(1);
});
