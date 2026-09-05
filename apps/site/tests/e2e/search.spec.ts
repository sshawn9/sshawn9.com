import { expect, test, type Page } from '@playwright/test';

const searchRoot = (page: Page) => page.locator('[data-site-search]');
const searchInput = (page: Page) => searchRoot(page).locator('.pf-input');
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

test('query, URL, localized results, keyboard behavior, and clear semantics stay aligned', async ({
  page,
}) => {
  await page.goto('/zh/search/?q=Git%20Identity');
  await waitForSearch(page);
  await expect(searchInput(page)).toHaveValue('Git Identity');

  const articleResult = searchList(page).locator(
    '.site-search-result:has(.site-search-result__link[href="/zh/blog/git-identity-management/"])',
  );
  await expect(articleResult).toBeVisible();
  await expect(articleResult.locator('.site-search-result__type')).toHaveText('文章');

  await searchInput(page).focus();
  await searchInput(page).press('ArrowDown');
  await expect(searchList(page).locator('.site-search-result__link').first()).toBeFocused();

  await searchInput(page).fill('景观背景');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('景观背景');
  await expect(
    searchList(page).locator(
      '.site-search-result__link[href="/zh/blog/rotating-scenic-backgrounds-for-my-website/"]',
    ),
  ).toBeVisible();

  await searchInput(page).press('Escape');
  await expect(searchInput(page)).toHaveValue('');
  await expect.poll(() => new URL(page.url()).searchParams.has('q')).toBe(false);
  await expect(searchResults(page)).toHaveAttribute('data-query', '');
  await expect(searchRoot(page).locator('[data-search-empty]')).toBeVisible();
});

test('page and section matches stay inside one result card', async ({ page }) => {
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

test('a warm query never paints an empty list and commits its summary with its result query', async ({
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

test('a slow result fragment keeps the previous cards and summary visible until one commit', async ({
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

test('a refresh fragment error leaves the previous results usable and reports the error nearby', async ({
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

test('composition keeps the committed results until the composed query is confirmed', async ({
  page,
}) => {
  await page.goto('/zh/search/?q=git');
  await expect(searchResults(page)).toHaveAttribute('data-query', 'git');
  await searchInput(page).dispatchEvent('compositionstart');
  await searchInput(page).fill('frenet');
  // Longer than the component debounce: intermediate composition must still not commit.
  await page.waitForTimeout(450);
  await expect(searchResults(page)).toHaveAttribute('data-query', 'git');
  expect(new URL(page.url()).searchParams.get('q')).toBe('git');
  await searchInput(page).dispatchEvent('compositionend');
  await expect(searchResults(page)).toHaveAttribute('data-query', 'frenet');
  await expect(searchResults(page)).not.toHaveAttribute('aria-busy', 'true');
});
