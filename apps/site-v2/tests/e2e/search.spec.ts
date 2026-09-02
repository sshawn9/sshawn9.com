import { expect, test, type Page } from '@playwright/test';

const searchRoot = (page: Page) => page.locator('[data-site-search]');
const searchInput = (page: Page) => searchRoot(page).locator('.pf-input');

async function waitForSearch(page: Page) {
  await expect(searchRoot(page)).toHaveAttribute('data-search-ready', '');
}

test('query, URL, localized results, keyboard behavior, and clear semantics stay aligned', async ({
  page,
}) => {
  await page.goto('/zh/search/?q=Git%20Identity');
  await waitForSearch(page);
  await expect(searchInput(page)).toHaveValue('Git Identity');

  const articleResult = searchRoot(page).locator(
    '.site-search-result:has(.site-search-result__link[href="/zh/blog/git-identity-management/"])',
  );
  await expect(articleResult).toBeVisible();
  await expect(articleResult.locator('.site-search-result__type')).toHaveText('文章');

  await searchInput(page).focus();
  await searchInput(page).press('ArrowDown');
  await expect(searchRoot(page).locator('.site-search-result__link').first()).toBeFocused();

  await searchInput(page).fill('景观背景');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('景观背景');
  await expect(
    searchRoot(page).locator(
      '.site-search-result__link[href="/zh/blog/rotating-scenic-backgrounds-for-my-website/"]',
    ),
  ).toBeVisible();

  await searchInput(page).press('Escape');
  await expect(searchInput(page)).toHaveValue('');
  await expect.poll(() => new URL(page.url()).searchParams.has('q')).toBe(false);
  await expect(searchRoot(page).locator('[data-search-empty]')).toBeVisible();
});

test('page and section matches stay inside one result card', async ({ page }) => {
  await page.goto('/en/search/?q=g');
  await waitForSearch(page);

  const resultsWithSections = searchRoot(page).locator(
    '.site-search-result:has(.site-search-result__sections)',
  );
  await expect.poll(() => resultsWithSections.count()).toBeGreaterThan(0);

  const resultCount = await resultsWithSections.count();
  for (let index = 0; index < resultCount; index += 1) {
    const result = resultsWithSections.nth(index);
    const card = result.locator(':scope > .site-search-result__card');
    const sections = card.locator(':scope > .site-search-result__sections');

    await expect(sections).toHaveCount(1);
    const isContained = await card.evaluate((cardElement) => {
      const sectionsElement = cardElement.querySelector<HTMLElement>(
        ':scope > .site-search-result__sections',
      );
      if (!sectionsElement) return false;

      const cardRect = cardElement.getBoundingClientRect();
      const sectionsRect = sectionsElement.getBoundingClientRect();
      return (
        sectionsRect.left >= cardRect.left &&
        sectionsRect.right <= cardRect.right &&
        sectionsRect.top >= cardRect.top &&
        sectionsRect.bottom <= cardRect.bottom
      );
    });
    expect(isContained).toBe(true);
  }
});

test('returning from a result restores the query, results, and search-page scroll', async ({
  page,
}) => {
  await page.goto('/en/search/?q=website');
  await waitForSearch(page);
  const links = searchRoot(page).locator('.site-search-result__link');
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

test('without JavaScript the search page exposes an honest static fallback', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/zh/search/');

  await expect(page.getByText('搜索需要 JavaScript')).toBeVisible();
  await expect(page.getByRole('searchbox')).toBeDisabled();
  await expect(page.getByRole('link', { name: '项目' }).last()).toHaveAttribute(
    'href',
    '/zh/projects/',
  );
  await context.close();
});

test('search loading failure releases to static navigation', async ({ page }) => {
  await page.route(/\/pagefind\/pagefind\.js(?:\?.*)?$/, (route) => route.abort());

  await page.goto('/en/search/?q=website');
  await expect(searchRoot(page)).toHaveAttribute('data-search-failed', '', { timeout: 12_000 });
  await expect(page.getByText('Search is temporarily unavailable')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Blog' }).last()).toHaveAttribute(
    'href',
    '/en/blog/',
  );
});
