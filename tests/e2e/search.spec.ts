import { expect, test, type Page } from '@playwright/test';

const searchRoot = (page: Page) => page.locator('[data-site-search]');
const searchInput = (page: Page) => searchRoot(page).locator('.pf-input');

async function expectQuery(page: Page, query: string | null) {
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe(query);
}

test('site search restores its query, labels results, and preserves it across navigation', async ({
  page,
}) => {
  const query = '壁纸';
  await page.goto(`/zh/search/?q=${encodeURIComponent(query)}`);

  await expect(searchRoot(page)).toHaveAttribute('data-search-ready', '');
  await expect(searchInput(page)).toHaveValue(query);
  await expect(searchRoot(page).locator('[data-site-search-empty]')).toBeHidden();

  const articleResult = searchRoot(page)
    .locator('.site-search-result')
    .filter({
      has: page.locator(
        '.site-search-result__link[href="/zh/blog/rotating-scenic-backgrounds-for-my-website/"]',
      ),
    });
  await expect(articleResult).toBeVisible({ timeout: 15_000 });
  await expect(articleResult.locator('.site-search-result__type')).toHaveText('文章');

  await searchInput(page).focus();
  await page.keyboard.press('ArrowDown');
  await expect(searchRoot(page).locator('.site-search-result__link').first()).toBeFocused();

  await articleResult.locator('.site-search-result__link').click();
  await expect(page).toHaveURL(/\/zh\/blog\/rotating-scenic-backgrounds-for-my-website\/$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/zh\/search\/\?q=/);
  await expect(searchRoot(page)).toHaveAttribute('data-search-ready', '');
  await expect(searchInput(page)).toHaveValue(query);
  await expect(articleResult).toBeVisible({ timeout: 15_000 });

  await searchRoot(page).locator('.pf-input-clear').click();
  await expect(searchInput(page)).toHaveValue('');
  await expectQuery(page, null);
  await expect(searchRoot(page).locator('[data-site-search-empty]')).toBeVisible();
});

test('search keeps its query when leaving through primary navigation and returning', async ({
  page,
}) => {
  const query = '技术';
  await page.goto('/zh/about/');
  await page.locator('[data-site-header-sync="desktop-search"]').click();

  await expect(searchRoot(page)).toHaveAttribute('data-search-ready', '');
  await searchInput(page).fill(query);
  await expectQuery(page, query);

  await searchInput(page).press('Escape');
  await expect(searchInput(page)).not.toBeFocused();
  await expect(searchInput(page)).toHaveValue(query);
  await expectQuery(page, query);
  await expect(searchRoot(page).locator('pagefind-keyboard-hints')).toHaveCount(0);

  await page.locator('[data-site-header-sync="desktop-projects"]').click();
  await expect(page).toHaveURL(/\/zh\/projects\/$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/zh\/search\/\?q=/);
  await expect(searchRoot(page)).toHaveAttribute('data-search-ready', '');
  await expect(searchInput(page)).toHaveValue(query);
});

test('full-site search keeps homepage, project listing, and unfinished About discoverable', async ({
  page,
}) => {
  await page.goto('/zh/search/');
  await expect(searchRoot(page)).toHaveAttribute('data-search-ready', '');

  await searchInput(page).fill('项目、研究与技术写作');
  await expectQuery(page, '项目、研究与技术写作');
  const homeResult = searchRoot(page).locator(
    '.site-search-result:has(.site-search-result__link[href="/zh/"])',
  );
  await expect(homeResult).toBeVisible({ timeout: 15_000 });
  await expect(homeResult.locator('.site-search-result__type')).toHaveText('页面');

  await searchInput(page).fill('自动驾驶运动控制');
  await expectQuery(page, '自动驾驶运动控制');
  const projectListingResult = searchRoot(page).locator(
    '.site-search-result:has(.site-search-result__link[href="/zh/projects/"])',
  );
  await expect(projectListingResult).toBeVisible({ timeout: 15_000 });
  await expect(projectListingResult.locator('.site-search-result__type')).toHaveText('页面');

  await searchInput(page).fill('酝酿');
  await expectQuery(page, '酝酿');
  const aboutResult = searchRoot(page).locator(
    '.site-search-result:has(.site-search-result__link[href="/zh/about/"])',
  );
  await expect(aboutResult).toBeVisible({ timeout: 15_000 });
  await expect(aboutResult.locator('.site-search-result__type')).toHaveText('页面');
});

test('English search uses the English index and result labels', async ({ page }) => {
  const query = 'wallpaper';
  await page.goto(`/en/search/?q=${query}`);

  await expect(searchInput(page)).toHaveValue(query);
  const articleResult = searchRoot(page).locator(
    '.site-search-result:has(.site-search-result__link[href="/en/blog/rotating-scenic-backgrounds-for-my-website/"])',
  );
  await expect(articleResult).toBeVisible({ timeout: 15_000 });
  await expect(articleResult.locator('.site-search-result__type')).toHaveText('Article');
});

test('search keeps the previous candidates visible until the next results are ready', async ({
  page,
}) => {
  await page.goto('/en/search/?q=gi');

  const resultsFrame = searchRoot(page).locator('[data-site-search-results]');
  const firstResult = resultsFrame
    .locator('pagefind-results .site-search-result[data-pf-result-index="0"]')
    .locator('.site-search-result__link');
  await expect(firstResult).toBeVisible({ timeout: 15_000 });
  const previousTitle = await firstResult.textContent();

  await searchInput(page).press('t');
  await expect(resultsFrame).toHaveAttribute('data-search-results-refreshing', '');

  const snapshot = resultsFrame.locator('[data-site-search-results-snapshot]');
  await expect(snapshot).toBeVisible();
  await expect(
    snapshot
      .locator('.site-search-result[data-pf-result-index="0"]')
      .locator('.site-search-result__link'),
  ).toHaveText(previousTitle ?? '');
  await expect(resultsFrame.locator('pagefind-results')).toHaveAttribute('aria-hidden', 'true');

  await expect(resultsFrame).not.toHaveAttribute('data-search-results-refreshing', '', {
    timeout: 15_000,
  });
  await expect(snapshot).toHaveCount(0);
  await expect(searchInput(page)).toHaveValue('git');
  await expectQuery(page, 'git');
});

test('search provides a useful fallback without client JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  await page.goto('/zh/search/');
  await expect(page.locator('.site-search-noscript')).toContainText('搜索需要 JavaScript');
  await expect(page.locator('.site-search__interactive')).toBeHidden();

  await context.close();
});
