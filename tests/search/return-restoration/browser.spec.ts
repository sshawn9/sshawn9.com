import { expect, test, type Page } from '@playwright/test';

const searchRoot = (page: Page) => page.locator('[data-site-search]');
const searchInput = (page: Page) => searchRoot(page).locator('.pf-input');
const searchList = (page: Page) => searchRoot(page).locator('[data-search-list]');

async function waitForSearch(page: Page) {
  await expect(searchRoot(page)).toHaveAttribute('data-search-ready', '');
}

test('returning from a result restores the query, results, and search-page scroll', async ({
  page,
}) => {
  await page.goto('/en/search/?q=website');
  await waitForSearch(page);
  const links = searchList(page).locator('.site-search-result__link');
  await expect(links.first()).toBeVisible();
  await expect.poll(() => links.count()).toBeGreaterThan(1);

  const target = links.last();
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollBy(0, 180));
  const savedY = await page.evaluate(() => scrollY);
  expect(savedY).toBeGreaterThan(300);
  await target.click();
  await expect(page).not.toHaveURL(/\/en\/search\//);

  await page.goBack();
  await expect(page).toHaveURL(/\/en\/search\/\?q=website/);
  await waitForSearch(page);
  await expect(searchInput(page)).toHaveValue('website');
  await expect(links.first()).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThan(Math.max(300, savedY - 100));
});
