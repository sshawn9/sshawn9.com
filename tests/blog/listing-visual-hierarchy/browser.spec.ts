import { expect, test } from '@playwright/test';

const blogPath = '/en/blog/';

test('listing emphasis and pagination retain the tuned information hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(blogPath);

  const resultCount = page.locator('[data-blog-result-count]');
  const total = await page.locator('[data-blog-article]').count();
  await expect(resultCount).toHaveText(`Articles 1–5 of ${total}`);
  await expect(page.locator('[data-blog-page-status]')).toHaveText(
    `Page 1 of ${Math.ceil(total / 5)}`,
  );
  await expect(page.getByRole('combobox', { name: 'Articles per page' })).toHaveAttribute(
    'value',
    '5',
  );

  const previous = page.locator('[data-blog-page="previous"]');
  const next = page.locator('[data-blog-page="next"]');
  await expect(previous).toBeVisible();
  await expect(previous).toHaveAttribute('aria-disabled', 'true');
  await expect(next).toBeVisible();
  const pagination = page.locator('[data-blog-pagination]');
  await expect(pagination).toHaveAttribute('data-positioned', '');
  const firstPaginationBox = (await pagination.boundingBox())!;
  expect(firstPaginationBox.y).toBeGreaterThan(0);
  expect(firstPaginationBox.y + firstPaginationBox.height).toBeLessThan(900);

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

  await page.goto(`${blogPath}?page=99`);
  await expect(page.locator('[data-blog-page-status]')).toHaveText(
    `Page ${Math.ceil(total / 5)} of ${Math.ceil(total / 5)}`,
  );
  await expect(previous).toBeVisible();
  await expect(next).toBeVisible();
  await expect(next).toHaveAttribute('aria-disabled', 'true');
  await expect(pagination).toHaveAttribute('data-positioned', '');
  expect(await pagination.boundingBox()).toEqual(firstPaginationBox);
});
