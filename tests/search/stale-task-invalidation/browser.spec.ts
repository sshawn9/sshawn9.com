import { expect, test, type Page } from '@playwright/test';

const searchRoot = (page: Page) => page.locator('[data-site-search]');
const searchInput = (page: Page) => searchRoot(page).locator('[data-search-input]');
const searchResults = (page: Page) => searchRoot(page).locator('[data-search-results]');
const searchList = (page: Page) => searchRoot(page).locator('[data-search-list]');
const resultCards = (page: Page) => searchList(page).locator('.site-search-result');

async function deferPagefindFragments(page: Page) {
  let defer = false;
  let releaseFragments: () => void = () => {};
  let observeFirstFragment: () => void = () => {};
  const firstFragment = new Promise<void>((resolve) => {
    observeFirstFragment = resolve;
  });
  const fragmentGate = new Promise<void>((resolve) => {
    releaseFragments = resolve;
  });

  await page.route(/\/pagefind\/fragment\/.*\.pf_fragment(?:\?.*)?$/, async (route) => {
    if (!defer) {
      await route.continue();
      return;
    }

    observeFirstFragment();
    await fragmentGate;
    await route.continue();
  });

  return {
    defer() {
      defer = true;
    },
    firstFragment,
    release() {
      releaseFragments();
    },
  };
}

async function waitForSearch(page: Page) {
  await expect(searchRoot(page)).toHaveAttribute('data-search-ready', '');
}

test('clearing a query invalidates delayed work and cannot let it restore stale cards', async ({
  page,
}) => {
  const fragments = await deferPagefindFragments(page);
  await page.goto('/en/search/?q=website');
  await waitForSearch(page);
  await expect(resultCards(page).first()).toBeVisible();

  fragments.defer();
  await searchInput(page).fill('frenet');
  await fragments.firstFragment;
  await expect(searchResults(page)).toHaveAttribute('aria-busy', 'true');

  await searchInput(page).fill('');
  await expect.poll(() => new URL(page.url()).searchParams.has('q')).toBe(false);
  await expect(searchResults(page)).toHaveAttribute('data-query', '');
  await expect(resultCards(page)).toHaveCount(0);

  fragments.release();
  await page.waitForTimeout(500);
  await expect(searchResults(page)).toHaveAttribute('data-query', '');
  await expect(resultCards(page)).toHaveCount(0);
});

test('a superseded result cannot commit during the next input debounce', async ({ page }) => {
  const fragments = await deferPagefindFragments(page);
  await page.goto('/en/search/?q=website');
  await expect(searchResults(page)).toHaveAttribute('data-query', 'website');
  const observed = await searchResults(page).evaluateHandle((element) => {
    const queries: Array<string | null> = [];
    const observer = new MutationObserver(() => queries.push(element.getAttribute('data-query')));
    observer.observe(element, { attributes: true, attributeFilter: ['data-query'] });
    return { queries, stop: () => observer.disconnect() };
  });

  try {
    fragments.defer();
    await searchInput(page).fill('frenet');
    await fragments.firstFragment;
    await searchInput(page).fill('git identity');
    fragments.release();
    await expect(searchResults(page)).toHaveAttribute('data-query', 'git identity');
    expect(await observed.evaluate(({ queries }) => queries)).not.toContain('frenet');
  } finally {
    fragments.release();
    await observed.evaluate(({ stop }) => stop());
  }
});
