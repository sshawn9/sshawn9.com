import { expect, test, type Page } from '@playwright/test';

const searchRoot = (page: Page) => page.locator('[data-site-search]');
const searchInput = (page: Page) => searchRoot(page).locator('[data-search-input]');
const searchResults = (page: Page) => searchRoot(page).locator('[data-search-results]');
const searchSummary = (page: Page) => searchRoot(page).locator('[data-search-summary]');
const searchStatus = (page: Page) => searchRoot(page).locator('[data-search-status]');
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

async function failPagefindFragments(page: Page) {
  let fail = false;
  let observeFirstFragment: () => void = () => {};
  const firstFragment = new Promise<void>((resolve) => {
    observeFirstFragment = resolve;
  });

  await page.route(/\/pagefind\/fragment\/.*\.pf_fragment(?:\?.*)?$/, async (route) => {
    if (!fail) {
      await route.continue();
      return;
    }

    observeFirstFragment();
    await route.abort();
  });

  return {
    fail() {
      fail = true;
    },
    firstFragment,
  };
}

async function waitForSearch(page: Page) {
  await expect(searchRoot(page)).toHaveAttribute('data-search-ready', '');
}

test('a warm query keeps sampled frames populated and commits summary with results', async ({
  page,
}) => {
  await page.goto('/en/search/?q=website');
  await waitForSearch(page);

  const sharedLink = searchList(page).locator(
    '.site-search-result__link[href="/en/blog/my-personal-website/"]',
  );
  await expect(sharedLink).toBeVisible();
  const sharedExcerpt = sharedLink.locator(
    'xpath=ancestor::li[contains(@class, "site-search-result")]//p[contains(@class, "site-search-result__excerpt")]',
  );
  const previousExcerptMarkup = await sharedExcerpt.innerHTML();
  const previousSummary = (await searchSummary(page).textContent())?.trim();
  expect(previousSummary).toBeTruthy();

  const timeline = await searchResults(page).evaluateHandle((surface) => {
    const list = surface.querySelector<HTMLElement>('[data-search-list]');
    const summary = surface
      .closest('[data-site-search]')
      ?.querySelector<HTMLElement>('[data-search-summary]');
    const state = {
      active: true,
      frames: [] as Array<{
        cardCount: number;
        hidden: boolean;
        transparent: boolean;
        query: string | null;
        summary: string;
      }>,
      stop() {
        state.active = false;
      },
    };
    const sample = () => {
      if (!state.active || !list) return;
      const style = getComputedStyle(list);
      const surfaceStyle = getComputedStyle(surface);
      state.frames.push({
        cardCount: list.querySelectorAll('.site-search-result').length,
        hidden:
          list.hasAttribute('hidden') ||
          surface.hasAttribute('hidden') ||
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          surfaceStyle.display === 'none' ||
          surfaceStyle.visibility === 'hidden',
        transparent: style.opacity === '0' || surfaceStyle.opacity === '0',
        query: surface.getAttribute('data-query'),
        summary: summary?.textContent?.trim() ?? '',
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    return state;
  });

  try {
    await searchInput(page).fill('personal website');
    await expect(searchResults(page)).toHaveAttribute('data-query', 'personal website');
    await expect(sharedLink).toBeVisible();
    await expect.poll(() => sharedExcerpt.innerHTML()).not.toBe(previousExcerptMarkup);
    await expect
      .poll(() =>
        timeline.evaluate(({ frames }) =>
          frames.some((frame) => frame.query === 'personal website'),
        ),
      )
      .toBe(true);
  } finally {
    await timeline.evaluate(({ stop }) => stop());
  }

  const frames = await timeline.evaluate(({ frames }) => frames);
  expect(frames.length).toBeGreaterThan(0);
  expect(frames).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ query: 'website', summary: previousSummary }),
      expect.objectContaining({ query: 'personal website' }),
    ]),
  );
  expect(frames.every((frame) => frame.cardCount > 0 && !frame.hidden && !frame.transparent)).toBe(
    true,
  );
  const committedFrame = frames.find((frame) => frame.query === 'personal website');
  expect(committedFrame?.summary).not.toBe(previousSummary);
});

test('a slow result fragment keeps the previous cards and summary visible until the replacement commits', async ({
  page,
}) => {
  const fragments = await deferPagefindFragments(page);
  await page.goto('/en/search/?q=website');
  await waitForSearch(page);

  const previousCard = resultCards(page).first();
  await expect(previousCard).toBeVisible();
  const previousSummary = (await searchSummary(page).textContent())?.trim();
  expect(previousSummary).toBeTruthy();

  fragments.defer();
  await searchInput(page).fill('frenet');
  await expect(searchResults(page)).toHaveAttribute('aria-busy', 'true');
  await fragments.firstFragment;

  await expect(previousCard).toBeVisible();
  await expect(searchSummary(page)).toHaveText(previousSummary!);
  await expect(searchResults(page)).toHaveAttribute('data-query', 'website');
  await expect(searchResults(page)).not.toBeHidden();

  fragments.release();
  await expect(searchResults(page)).toHaveAttribute('data-query', 'frenet');
  await expect(searchResults(page)).not.toHaveAttribute('aria-busy', 'true');
});

test('a refresh fragment error leaves the previous results usable and reports the error in the search region', async ({
  page,
}) => {
  const fragments = await failPagefindFragments(page);
  await page.goto('/en/search/?q=website');
  await waitForSearch(page);

  const previousCard = resultCards(page).first();
  await expect(previousCard).toBeVisible();
  const previousSummary = (await searchSummary(page).textContent())?.trim();
  expect(previousSummary).toBeTruthy();

  fragments.fail();
  await searchInput(page).fill('frenet');
  await fragments.firstFragment;
  await expect(searchStatus(page)).toBeVisible();
  await expect(previousCard).toBeVisible();
  await expect(searchSummary(page)).toHaveText(previousSummary!);
  await expect(searchResults(page)).toHaveAttribute('data-query', 'website');
  await expect(searchRoot(page)).not.toHaveAttribute('data-search-failed', '');
  await expect(searchResults(page)).not.toHaveAttribute('aria-busy', 'true');
  const usableLink = previousCard.locator('.site-search-result__link');
  const href = await usableLink.getAttribute('href');
  await usableLink.click();
  await expect(page).toHaveURL(new RegExp(`${href!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
});

test('a timed-out replacement keeps old results and a later query can recover', async ({
  page,
}) => {
  const fragments = await deferPagefindFragments(page);
  try {
    await page.goto('/en/search/?q=website');
    await expect(searchResults(page)).toHaveAttribute('data-query', 'website');
    const previousSummary = await searchSummary(page).textContent();
    fragments.defer();
    await searchInput(page).fill('frenet');
    await fragments.firstFragment;
    await expect(searchResults(page)).not.toHaveAttribute('aria-busy', 'true', { timeout: 12_000 });
    await expect(searchStatus(page)).toBeVisible();
    await expect(searchSummary(page)).toHaveText(previousSummary!);
    await expect(resultCards(page).first()).toBeVisible();
    await searchInput(page).fill('personal website');
    await expect(searchResults(page)).toHaveAttribute('data-query', 'personal website');
    fragments.release();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(searchResults(page)).toHaveAttribute('data-query', 'personal website');
    await expect(searchStatus(page)).toBeHidden();
  } finally {
    fragments.release();
  }
});

test('new result fonts are prepared while the previous result remains visible', async ({
  page,
}) => {
  await page.goto('/zh/search/?q=git');
  await expect(searchResults(page)).toHaveAttribute('data-query', 'git');
  const previousSummary = await searchSummary(page).textContent();
  const fontGate = await page.evaluateHandle(() => {
    const fonts = document.fonts;
    const check = fonts.check.bind(fonts);
    const load = fonts.load.bind(fonts);
    let release: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = {
      requests: 0,
      release() {
        fonts.check = check;
        fonts.load = load;
        release();
      },
    };
    // Model a cold font response without relying on which unicode-range subsets are cached.
    fonts.check = () => false;
    fonts.load = async (font, text) => {
      state.requests += 1;
      await ready;
      return load(font, text);
    };
    return state;
  });
  try {
    await searchInput(page).fill('frenet');
    await expect.poll(() => fontGate.evaluate(({ requests }) => requests)).toBeGreaterThan(0);
    await expect(searchResults(page)).toHaveAttribute('data-query', 'git');
    await expect(searchResults(page)).toHaveAttribute('aria-busy', 'true');
    await expect(resultCards(page).first()).toBeVisible();
    await expect(searchSummary(page)).toHaveText(previousSummary!);
    await fontGate.evaluate(({ release }) => release());
    await expect(searchResults(page)).toHaveAttribute('data-query', 'frenet');
    await expect(searchResults(page)).not.toHaveAttribute('aria-busy', 'true');
  } finally {
    await fontGate.evaluate(({ release }) => release());
  }
});
