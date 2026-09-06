import { expect, test, type Page } from '@playwright/test';

const searchRoot = (page: Page) => page.locator('[data-site-search]');
const searchResults = (page: Page) => searchRoot(page).locator('[data-search-results]');
const searchList = (page: Page) => searchRoot(page).locator('[data-search-list]');
const resultCards = (page: Page) => searchList(page).locator('.site-search-result');

async function waitForSearch(page: Page) {
  await expect(searchRoot(page)).toHaveAttribute('data-search-ready', '');
}

test('narrow search cards contain long titles, paths, and highlighted text without clipping', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/en/search/?q=g');
  await expect(searchResults(page)).toHaveAttribute('data-query', 'g');

  const expectResultsToFit = async () => {
    const geometry = await searchList(page).evaluate((list) => {
      const bounds = list.getBoundingClientRect();
      return {
        viewport: document.documentElement.clientWidth,
        body: document.body.scrollWidth,
        outsideList: [...list.querySelectorAll('.site-search-result__card')].filter((card) => {
          const box = card.getBoundingClientRect();
          return box.left < bounds.left - 1 || box.right > bounds.right + 1;
        }).length,
        // Primary text must wrap, not merely be hidden by the page's overflow policy.
        overflowingText: [
          ...list.querySelectorAll<HTMLElement>(
            '.site-search-result__title, .site-search-result__excerpt',
          ),
        ].filter((text) => text.scrollWidth > text.clientWidth + 1).length,
      };
    });
    expect(geometry.body).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.outsideList).toBe(0);
    expect(geometry.overflowingText).toBe(0);
  };

  await expectResultsToFit();
  // Keep the boundary test independent of which documents happen to rank first.
  await resultCards(page)
    .first()
    .evaluate((card) => {
      card.querySelector('.site-search-result__link')!.textContent =
        'UnbrokenSearchResultTitle'.repeat(8);
      const mark = document.createElement('mark');
      mark.textContent = 'LongHighlightedIdentifier'.repeat(8);
      card
        .querySelector('.site-search-result__excerpt')!
        .replaceChildren('https://example.com/' + 'long-path-segment'.repeat(8) + ' ', mark);
    });
  for (const width of [320, 1440, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await expectResultsToFit();
  }
});

test('section groups remain geometrically contained by their result cards', async ({ page }) => {
  await page.goto('/en/search/?q=g');
  await waitForSearch(page);

  const resultsWithSections = searchList(page).locator(
    '.site-search-result:has(.site-search-result__sections:not([hidden]))',
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
