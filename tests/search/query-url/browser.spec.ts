import { expect, test, type Page } from '@playwright/test';
import {
  clearViewProbeEvents,
  installViewNavigationProbe,
  viewProbe,
} from '../../navigation/view-probe';

const searchPath = '/en/search/';

const searchRoot = (page: Page) => page.locator('[data-site-search]');
const searchInput = (page: Page) => searchRoot(page).locator('.pf-input');
const searchList = (page: Page) => searchRoot(page).locator('[data-search-list]');

async function waitForSearch(page: Page) {
  await expect(searchRoot(page)).toHaveAttribute('data-search-ready', '');
}

test('query, URL, and localized results stay aligned', async ({ page }) => {
  await page.goto('/zh/search/?q=Git%20Identity');
  await waitForSearch(page);
  await expect(searchInput(page)).toHaveValue('Git Identity');

  const articleResult = searchList(page).locator(
    '.site-search-result:has(.site-search-result__link[href="/zh/blog/git-identity-management/"])',
  );
  await expect(articleResult).toBeVisible();
  await expect(articleResult.locator('.site-search-result__type')).toHaveText('文章');

  await searchInput(page).fill('景观背景');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('景观背景');
  await expect(
    searchList(page).locator(
      '.site-search-result__link[href="/zh/blog/rotating-scenic-backgrounds-for-my-website/"]',
    ),
  ).toBeVisible();
});

test('search query replacement is lifecycle-silent, keeps history length, and applies traversal in place', async ({
  page,
}) => {
  await installViewNavigationProbe(page);
  await page.goto(`${searchPath}?q=website`);
  await waitForSearch(page);
  const root = page.locator('[data-site-search]');
  await root.evaluate((element) => (element.dataset.viewNavigationIdentity = 'search'));
  const queryAHistoryLength = await page.evaluate(() => history.length);

  await page.locator('a.site-header__search[href="/en/search/"]').click();
  await expect(page).toHaveURL(/\/en\/search\/$/);
  await waitForSearch(page);
  expect(await page.evaluate(() => history.length)).toBe(queryAHistoryLength + 1);
  expect(await root.getAttribute('data-view-navigation-identity')).toBe('search');
  await clearViewProbeEvents(page);
  const queryBHistoryLength = await page.evaluate(() => history.length);

  await searchInput(page).fill('git identity');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('git identity');
  await expect(page.locator('[data-search-results]')).toHaveAttribute('data-query', 'git identity');
  expect(await page.evaluate(() => history.length)).toBe(queryBHistoryLength);
  expect(await root.getAttribute('data-view-navigation-identity')).toBe('search');
  expect((await viewProbe(page))?.astroEvents).toEqual([]);

  await page.goBack();
  await expect(page).toHaveURL(/\/en\/search\/\?q=website$/);
  await expect(searchInput(page)).toHaveValue('website');
  await expect(page.locator('[data-search-results]')).toHaveAttribute('data-query', 'website');
  expect(await root.getAttribute('data-view-navigation-identity')).toBe('search');

  let searchHtmlFetches = 0;
  page.on('request', (request) => {
    if (request.resourceType() === 'fetch' && new URL(request.url()).pathname === searchPath) {
      searchHtmlFetches += 1;
    }
  });
  const historyLengthBeforeHash = await page.evaluate(() => history.length);
  await clearViewProbeEvents(page);
  await searchInput(page).fill('git identity');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('git identity');
  await expect(page.locator('[data-search-results]')).toHaveAttribute('data-query', 'git identity');
  expect(await page.evaluate(() => history.length)).toBe(historyLengthBeforeHash);
  expect((await viewProbe(page))?.astroEvents).toEqual([]);

  const skipLink = page.locator('a.skip-link[href="#main-content"]');
  await skipLink.focus();
  await skipLink.press('Enter');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('git identity');
  await expect.poll(() => new URL(page.url()).hash).toBe('#main-content');
  await expect(page.locator('#main-content')).toBeFocused();
  expect(searchHtmlFetches).toBe(0);
});
