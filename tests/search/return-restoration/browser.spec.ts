import { expect, test, type Page } from '@playwright/test';
import { installSearchFixture } from '../browser-fixtures';

const searchRoot = (page: Page) => page.locator('[data-site-search]');
const searchInput = (page: Page) => searchRoot(page).locator('[data-search-input]');
const searchList = (page: Page) => searchRoot(page).locator('[data-search-list]');

async function waitForSearch(page: Page) {
  await expect(searchRoot(page)).toHaveAttribute('data-search-ready', '');
}

test('returning from a result restores the query, results, and search-page scroll', async ({
  page,
}) => {
  await installSearchFixture(
    page,
    Array.from({ length: 8 }, (_, index) => ({
      url: `/en/about/?fixture-result=${index + 1}`,
      language: 'en',
      content: `fixturecatalog entry ${index + 1}. A controlled search result for checking navigation and scroll restoration.`,
      meta: { title: `Fixture result ${index + 1}`, type: 'Article' },
    })),
  );
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto('/en/search/?q=fixturecatalog');
  await waitForSearch(page);
  const links = searchList(page).locator('.site-search-result__link');
  await expect(links.first()).toBeVisible();
  await expect(links).toHaveCount(8);
  const titles = await links.allTextContents();

  const target = links.last();
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollBy(0, 180));
  const savedY = await page.evaluate(() => scrollY);
  expect(savedY).toBeGreaterThan(300);
  await target.click();
  await expect(page).not.toHaveURL(/\/en\/search\//);

  await page.goBack();
  await expect(page).toHaveURL(/\/en\/search\/\?q=fixturecatalog/);
  await waitForSearch(page);
  await expect(searchInput(page)).toHaveValue('fixturecatalog');
  await expect(links).toHaveText(titles);
  await expect
    .poll(() => page.evaluate((saved) => Math.abs(scrollY - saved), savedY))
    .toBeLessThanOrEqual(100);
});
