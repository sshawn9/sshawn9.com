import { expect, test, type Page } from '@playwright/test';

const searchRoot = (page: Page) => page.locator('[data-site-search]');
const searchInput = (page: Page) => searchRoot(page).locator('[data-search-input]');
const searchResults = (page: Page) => searchRoot(page).locator('[data-search-results]');

test('composition keeps the committed results until the composed query is confirmed', async ({
  page,
}) => {
  await page.goto('/zh/search/?q=git');
  await expect(searchResults(page)).toHaveAttribute('data-query', 'git');
  await searchInput(page).dispatchEvent('compositionstart');
  await searchInput(page).fill('frenet');
  // Longer than the input debounce: intermediate composition must still not commit.
  await page.waitForTimeout(450);
  await expect(searchResults(page)).toHaveAttribute('data-query', 'git');
  expect(new URL(page.url()).searchParams.get('q')).toBe('git');
  await searchInput(page).dispatchEvent('compositionend');
  await expect(searchResults(page)).toHaveAttribute('data-query', 'frenet');
  await expect(searchResults(page)).not.toHaveAttribute('aria-busy', 'true');
});
