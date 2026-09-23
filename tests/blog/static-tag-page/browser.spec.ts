import { expect, test, type Page } from '@playwright/test';

function blogListing(page: Page) {
  return page.locator('[data-blog-listing]');
}

test('a static tag page canonicalizes ignored filters without losing its controller', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('blog-page-size', '20'));
  await page.goto('/en/tags/astro/?tag=unused&page=99&pageSize=50');
  await expect(page).toHaveURL(/\/en\/tags\/astro\/$/);
  await expect(blogListing(page)).toHaveAttribute('data-blog-runtime-ready', '');
  await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '[]');
  await expect(page.getByRole('combobox', { name: 'Articles per page' })).toHaveAttribute(
    'value',
    '20',
  );
  await page.getByRole('combobox', { name: 'Articles per page' }).click();
  await page.getByRole('option', { name: '5', exact: true }).click();
  await expect(page).toHaveURL(/\/en\/tags\/astro\/$/);
  expect(errors).toEqual([]);
});
