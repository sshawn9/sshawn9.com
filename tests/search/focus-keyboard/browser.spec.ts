import { expect, test, type Page } from '@playwright/test';

const searchRoot = (page: Page) => page.locator('[data-site-search]');
const searchInput = (page: Page) => searchRoot(page).locator('.pf-input');
const searchResults = (page: Page) => searchRoot(page).locator('[data-search-results]');
const searchList = (page: Page) => searchRoot(page).locator('[data-search-list]');

async function waitForSearch(page: Page) {
  await expect(searchRoot(page)).toHaveAttribute('data-search-ready', '');
}

test('keyboard movement enters results and Escape clears the query', async ({ page }) => {
  await page.goto('/zh/search/?q=Git%20Identity');
  await waitForSearch(page);
  await expect(searchList(page).locator('.site-search-result__link').first()).toBeVisible();
  await searchInput(page).focus();
  await searchInput(page).press('ArrowDown');
  await expect(searchList(page).locator('.site-search-result__link').first()).toBeFocused();

  await searchInput(page).focus();
  await searchInput(page).press('Escape');
  await expect(searchInput(page)).toHaveValue('');
  await expect.poll(() => new URL(page.url()).searchParams.has('q')).toBe(false);
  await expect(searchResults(page)).toHaveAttribute('data-query', '');
  await expect(searchRoot(page).locator('[data-search-empty]')).toBeVisible();
});

test('a committed replacement restores result focus only while it remains the user focus', async ({
  page,
}) => {
  await page.goto('/en/search/?q=website');
  await waitForSearch(page);

  const sharedHref = '/en/blog/my-personal-website/';
  const sharedLink = searchList(page).locator(`.site-search-result__link[href="${sharedHref}"]`);
  await expect(sharedLink).toBeVisible();

  const fontGate = await page.evaluateHandle(() => {
    const fonts = document.fonts;
    const check = fonts.check.bind(fonts);
    const load = fonts.load.bind(fonts);
    let releaseCurrent: () => void = () => {};
    let ready = Promise.resolve();
    const state = {
      requests: 0,
      block() {
        ready = new Promise<void>((resolve) => {
          releaseCurrent = resolve;
        });
      },
      release() {
        releaseCurrent();
      },
      restore() {
        fonts.check = check;
        fonts.load = load;
        releaseCurrent();
      },
    };
    fonts.check = () => false;
    fonts.load = async (font, text) => {
      state.requests += 1;
      await ready;
      return load(font, text);
    };
    return state;
  });

  try {
    await fontGate.evaluate(({ block }) => block());
    const firstRequestCount = await fontGate.evaluate(({ requests }) => requests);
    await searchInput(page).fill('personal website');
    await expect
      .poll(() => fontGate.evaluate(({ requests }) => requests))
      .toBeGreaterThan(firstRequestCount);
    await sharedLink.focus();
    await expect(sharedLink).toBeFocused();
    await fontGate.evaluate(({ release }) => release());
    await expect(searchResults(page)).toHaveAttribute('data-query', 'personal website');
    await expect(
      searchList(page).locator(`.site-search-result__link[href="${sharedHref}"]`),
    ).toBeFocused();

    await fontGate.evaluate(({ block }) => block());
    const secondRequestCount = await fontGate.evaluate(({ requests }) => requests);
    await searchInput(page).fill('website');
    await expect
      .poll(() => fontGate.evaluate(({ requests }) => requests))
      .toBeGreaterThan(secondRequestCount);
    await searchInput(page).focus();
    await fontGate.evaluate(({ release }) => release());
    await expect(searchResults(page)).toHaveAttribute('data-query', 'website');
    await expect(searchInput(page)).toBeFocused();
  } finally {
    await fontGate.evaluate(({ restore }) => restore());
  }
});
