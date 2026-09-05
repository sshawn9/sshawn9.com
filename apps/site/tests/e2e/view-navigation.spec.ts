import { expect, test, type Page } from '@playwright/test';

const blogPath = '/en/blog/';
const searchPath = '/en/search/';

function blogListing(page: Page) {
  return page.locator('[data-blog-listing]');
}

function blogTag(page: Page, slug: string) {
  return page.locator(`[data-blog-tag-definition][data-tag-slug="${slug}"]`);
}

function searchInput(page: Page) {
  return page.locator('.pf-input');
}

async function waitForSearch(page: Page) {
  await expect(page.locator('[data-site-search]')).toHaveAttribute('data-search-ready', '');
}

async function installViewNavigationProbe(page: Page) {
  await page.addInitScript(() => {
    const probe = {
      astroEvents: [] as string[],
      outletOpacities: [] as number[],
      frames: 0,
      active: true,
      stop() {
        probe.active = false;
      },
    };
    Object.defineProperty(window, '__viewNavigationProbe', { configurable: true, value: probe });
    for (const name of [
      'astro:before-preparation',
      'astro:before-swap',
      'astro:after-swap',
      'astro:page-load',
    ]) {
      document.addEventListener(name, () => probe.astroEvents.push(name));
    }
    const sample = () => {
      if (!probe.active) return;
      const outlet = document.querySelector<HTMLElement>('.page-outlet');
      if (outlet) probe.outletOpacities.push(Number.parseFloat(getComputedStyle(outlet).opacity));
      probe.frames += 1;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function viewProbe(page: Page) {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __viewNavigationProbe?: {
            astroEvents: string[];
            outletOpacities: number[];
            frames: number;
          };
        }
      ).__viewNavigationProbe,
  );
}

async function clearViewProbeEvents(page: Page) {
  await page.evaluate(() => {
    const probe = (window as Window & { __viewNavigationProbe?: { astroEvents: string[] } })
      .__viewNavigationProbe;
    if (probe) probe.astroEvents.length = 0;
  });
}

async function installViewTransactionProbe(page: Page) {
  await page.addInitScript(() => {
    const transactions = {
      settled: [] as Promise<void>[],
    };
    Object.defineProperty(window, '__viewTransactionProbe', {
      configurable: true,
      value: transactions,
    });

    const startViewTransition = document.startViewTransition;
    if (!startViewTransition) return;
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: (updateCallback: Parameters<typeof startViewTransition>[0]) => {
        const transition = startViewTransition.call(document, updateCallback);
        transactions.settled.push(transition.updateCallbackDone.catch(() => undefined));
        return transition;
      },
    });
  });
}

async function waitForViewTransactions(page: Page) {
  await page.evaluate(async () => {
    const probe = (
      window as Window & {
        __viewTransactionProbe?: { settled: Promise<void>[] };
      }
    ).__viewTransactionProbe;
    if (!probe) throw new Error('Expected view-transition probe');

    for (;;) {
      const count = probe.settled.length;
      await Promise.all([...probe.settled]);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (count === probe.settled.length) return;
    }
  });
}

async function pageLoadCount(page: Page) {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __viewNavigationProbe?: { astroEvents: string[] };
        }
      ).__viewNavigationProbe?.astroEvents.filter((name) => name === 'astro:page-load').length ?? 0,
  );
}

async function waitForPageLoadAnnouncerBoundary(page: Page, previousPageLoads: number) {
  await expect.poll(() => pageLoadCount(page)).toBe(previousPageLoads + 1);
  // Astro appends its route announcer after dispatching page-load. Cross two
  // frames so the assertion observes the resource-creation boundary itself.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test('blog tag views commit locally, retain the shell, and restore target history state', async ({
  page,
}) => {
  await installViewNavigationProbe(page);
  let documentRequests = 0;
  let blogHtmlFetches = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest()) documentRequests += 1;
    const url = new URL(request.url());
    if (request.resourceType() === 'fetch' && url.pathname === blogPath) {
      blogHtmlFetches += 1;
    }
  });

  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(blogPath);
  const listing = blogListing(page);
  const panel = page.locator('[data-blog-mobile-panel]');
  const main = page.locator('main');
  const sidebar = page.locator('#blog-sidebar');
  const mainIdentity = await main.evaluate((element) => {
    element.dataset.viewNavigationIdentity = 'main';
    return element.dataset.viewNavigationIdentity;
  });
  const sidebarIdentity = await sidebar.evaluate((element) => {
    element.dataset.viewNavigationIdentity = 'sidebar';
    return element.dataset.viewNavigationIdentity;
  });
  documentRequests = 0;
  blogHtmlFetches = 0;

  await blogTag(page, 'astro').click();
  await expect(listing).toHaveAttribute('data-selected-tags', '["astro"]');
  await expect(page).toHaveURL(/\/en\/blog\/\?tag=astro$/);
  await panel.evaluate((element) => element.scrollTo(0, 96));
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const astroPanelY = await panel.evaluate((element) => element.scrollTop);

  await blogTag(page, 'git').click();
  await expect(listing).toHaveAttribute('data-selected-tags', '["astro","git"]');
  await expect(page).toHaveURL(/\?tag=astro&tag=git$/);
  await panel.evaluate((element) => element.scrollTo(0, 16));
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(16);
  const astroAndGitPanelY = await panel.evaluate((element) => element.scrollTop);
  // scrollTo changes layout synchronously; the browser delivers its scroll
  // event on the next frame. Traverse only once this entry has been saved.
  await expect
    .poll(() => page.evaluate(() => history.state?.sshawn9?.regions?.['blog-sidebar-tags']?.y))
    .toBe(astroAndGitPanelY);

  await page.goBack();
  await expect(page).toHaveURL(/\?tag=astro$/);
  await expect(listing).toHaveAttribute('data-selected-tags', '["astro"]');
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(astroPanelY);
  // The region scroll listener persists in an animation frame. Let that commit before
  // asking the browser to traverse to the other local history entry.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await page.goForward();
  await expect(page).toHaveURL(/\?tag=astro&tag=git$/);
  await expect(listing).toHaveAttribute('data-selected-tags', '["astro","git"]');
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(astroAndGitPanelY);

  expect(await main.getAttribute('data-view-navigation-identity')).toBe(mainIdentity);
  expect(await sidebar.getAttribute('data-view-navigation-identity')).toBe(sidebarIdentity);
  expect(documentRequests).toBe(0);
  expect(blogHtmlFetches).toBe(0);
  const probe = await viewProbe(page);
  expect(probe?.outletOpacities.every((opacity) => opacity > 0.99)).toBe(true);
});

test('two tag clicks in one frame retain both history entries and traverse one intent at a time', async ({
  page,
}) => {
  await page.goto(blogPath);
  await page.evaluate(() => {
    const astro = document.querySelector<HTMLElement>(
      '[data-blog-tag-definition][data-tag-slug="astro"]',
    );
    const git = document.querySelector<HTMLElement>(
      '[data-blog-tag-definition][data-tag-slug="git"]',
    );
    if (!astro || !git) throw new Error('Expected blog tag fixtures');
    astro.click();
    git.click();
  });

  await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["astro","git"]');
  await expect(page).toHaveURL(/\?tag=astro&tag=git$/);
  await page.goBack();
  await expect(page).toHaveURL(/\?tag=astro$/);
  await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["astro"]');
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '[]');
});

test('a latest blog tag intent cancels a slow back traversal without rewriting the about entry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 240 });
  await page.goto('/en/about/');
  await expect(page.locator('.about-page')).toBeVisible();
  await page.evaluate(() => scrollTo({ top: 160, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => history.state?.sshawn9?.page.y)).toBeGreaterThan(0);
  const aboutSnapshot = await page.evaluate(() => structuredClone(history.state?.sshawn9));
  expect(aboutSnapshot).toBeTruthy();

  await page
    .locator('a.site-header__nav-link[href="/en/blog/"]')
    .evaluate((link) => (link as HTMLAnchorElement).click());
  await expect(blogListing(page)).toHaveAttribute('data-blog-runtime-ready', '');

  let releaseAboutResponse = () => {};
  const aboutResponse = new Promise<void>((resolve) => {
    releaseAboutResponse = resolve;
  });
  let resolveAboutRequest = () => {};
  const aboutRequested = new Promise<void>((resolve) => {
    resolveAboutRequest = resolve;
  });
  await page.route('**/en/about/', async (route) => {
    if (route.request().resourceType() === 'fetch') {
      resolveAboutRequest();
      await aboutResponse;
    }
    await route.continue();
  });

  const goingBack = page.goBack().catch(() => null);
  await aboutRequested;
  await expect(page).toHaveURL(/\/en\/about\/$/);
  await expect(blogListing(page)).toBeVisible();

  try {
    await blogTag(page, 'git').click();
    await expect(page).toHaveURL(/\/en\/blog\/\?tag=git$/);
    await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["git"]');
  } finally {
    releaseAboutResponse();
  }
  await goingBack;

  await page.goBack();
  await expect(page).toHaveURL(/\/en\/about\/$/);
  await expect(page.locator('.about-page')).toBeVisible();
  await expect.poll(() => page.evaluate(() => history.state?.sshawn9)).toEqual(aboutSnapshot);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(aboutSnapshot.page.y);
});

test('a same-frame skip link supersedes queued blog tags after their view transactions settle', async ({
  page,
}) => {
  await installViewTransactionProbe(page);
  await page.goto(blogPath);
  await page.evaluate(() => {
    const astro = document.querySelector<HTMLElement>(
      '[data-blog-tag-definition][data-tag-slug="astro"]',
    );
    const git = document.querySelector<HTMLElement>(
      '[data-blog-tag-definition][data-tag-slug="git"]',
    );
    const skipLink = document.querySelector<HTMLAnchorElement>('a.skip-link[href="#main-content"]');
    if (!astro || !git || !skipLink) throw new Error('Expected blog tag and skip-link fixtures');
    astro.click();
    git.click();
    skipLink.click();
  });

  await waitForViewTransactions(page);
  await expect(page).toHaveURL(/\/en\/blog\/#main-content$/);
  expect(new URL(page.url()).search).toBe('');
  await expect(page.locator('#main-content')).toBeFocused();
});

test('a queued local tag intent cannot pull an article navigation back to the blog', async ({
  page,
}) => {
  await page.goto(blogPath);
  await page.evaluate(() => {
    const astro = document.querySelector<HTMLElement>(
      '[data-blog-tag-definition][data-tag-slug="astro"]',
    );
    const git = document.querySelector<HTMLElement>(
      '[data-blog-tag-definition][data-tag-slug="git"]',
    );
    const article = document.querySelector<HTMLAnchorElement>('[data-blog-article] h2 a');
    if (!astro || !git || !article) throw new Error('Expected blog tag and article fixtures');
    astro.click();
    git.click();
    article.click();
  });

  await expect(page).toHaveURL(/\/en\/blog\/[^?]+\/$/);
  await expect(page.locator('[data-blog-listing]')).toHaveCount(0);

  // Both view requests were superseded before Astro committed either one.
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '[]');
});

test('leaving a local blog view and returning restores its selected tags', async ({ page }) => {
  await page.goto(blogPath);
  await blogTag(page, 'astro').click();
  await expect(page).toHaveURL(/\?tag=astro$/);

  const article = page.locator('[data-blog-article]:not([hidden]) h2 a').first();
  await expect(article).toBeVisible();
  await article.click();
  await expect(page).toHaveURL(/\/en\/blog\/[^?]+\/$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/en\/blog\/\?tag=astro$/);
  await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["astro"]');
});

test('an undeclared blog query follows the document-update path instead of a local view', async ({
  page,
}) => {
  await installViewNavigationProbe(page);
  await page.goto(blogPath);
  const main = page.locator('main');
  await main.evaluate((element) => (element.dataset.viewNavigationIdentity = 'blog'));
  const nextPage = page.locator('[data-blog-page="next"]');
  await expect(nextPage).toBeVisible();
  await nextPage.evaluate((element) => {
    (element as HTMLAnchorElement).href = '/en/blog/?page=2&unknown-view-parameter=one';
  });

  await nextPage.click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('unknown-view-parameter'))
    .toBe('one');
  await expect(blogListing(page)).toHaveAttribute('data-current-page', '2');
  await expect(main).not.toHaveAttribute('data-view-navigation-identity', 'blog');
  expect((await viewProbe(page))?.astroEvents).toContain('astro:before-swap');
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

test('local views suppress the route announcer scope while document navigation restores announcements', async ({
  page,
}) => {
  await page.goto(blogPath);
  const announcer = page.locator('.astro-route-announcer');

  await blogTag(page, 'astro').click();
  await expect(page.locator('html')).toHaveAttribute('data-navigation-scope', 'view');
  await expect(announcer).toHaveCount(1);
  await expect(announcer).toHaveCSS('display', 'none');

  await page.locator('[data-blog-article]:not([hidden]) h2 a').first().click();
  await expect(page).toHaveURL(/\/en\/blog\/[^?]+\/$/);
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation-scope', 'view');
  await expect(announcer).not.toHaveCSS('display', 'none');
  await expect(announcer).toContainText(await page.title());
});

test('eight local blog navigations keep route announcers bounded before a document navigation announces', async ({
  page,
}) => {
  await installViewNavigationProbe(page);
  await page.goto(blogPath);
  const announcer = page.locator('.astro-route-announcer');

  for (const slug of ['astro', 'git', 'astro', 'git', 'astro', 'git', 'astro', 'git']) {
    const pageLoadsBeforeClick = await pageLoadCount(page);
    await blogTag(page, slug).click();
    await waitForPageLoadAnnouncerBoundary(page, pageLoadsBeforeClick);
    await expect(announcer).toHaveCount(1);
    await expect(announcer).toHaveCSS('display', 'none');
  }

  await page.locator('[data-blog-article]:not([hidden]) h2 a').first().click();
  await expect(page).toHaveURL(/\/en\/blog\/[^?]+\/$/);
  await expect(announcer).toHaveCount(1);
  await expect(announcer).not.toHaveCSS('display', 'none');
  await expect(announcer).toContainText(await page.title());
});

for (const mode of ['reduced-motion', 'without-view-transitions'] as const) {
  test(`local tag history remains in place ${mode}`, async ({ page }) => {
    if (mode === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' });
    else
      await page.addInitScript(() => {
        Object.defineProperty(Document.prototype, 'startViewTransition', {
          configurable: true,
          value: undefined,
        });
      });
    await page.goto(blogPath);
    await page.locator('main').evaluate((element) => {
      element.dataset.viewNavigationIdentity = 'blog';
    });
    await blogTag(page, 'astro').click();
    await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["astro"]');
    await blogTag(page, 'git').click();
    await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["astro","git"]');
    await page.goBack();
    await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["astro"]');
    await expect(page.locator('main')).toHaveAttribute('data-view-navigation-identity', 'blog');
    await expect(page.locator('.page-outlet')).toHaveCSS('opacity', '1');
  });
}

test('mobile pagination and traversal retain the live tag disclosure state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(blogPath);
  const disclosure = page.locator('[data-blog-mobile-toggle]');
  await disclosure.click();
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await page.locator('[data-blog-page="next"]').click();
  await expect(blogListing(page)).toHaveAttribute('data-current-page', '2');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await page.goBack();
  await expect(blogListing(page)).toHaveAttribute('data-current-page', '1');
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
});

test('a static tag page canonicalizes ignored filters without losing its controller', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/en/tags/astro/?tag=unused&page=99');
  await expect(page).toHaveURL(/\/en\/tags\/astro\/$/);
  await expect(blogListing(page)).toHaveAttribute('data-blog-runtime-ready', '');
  await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '[]');
  expect(errors).toEqual([]);
});

test('an outgoing search cannot rewrite the destination of a slow history traversal', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(blogPath);
  await page.locator('a.site-header__search').click();
  await waitForSearch(page);
  await searchInput(page).fill('git');
  await expect(page.locator('[data-search-results]')).toHaveAttribute('data-query', 'git');

  let release = () => {};
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = () => {};
  const pending = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route('**/en/blog/', async (route) => {
    if (route.request().resourceType() === 'fetch') {
      requested();
      await response;
    }
    await route.continue();
  });
  await page.evaluate(() => history.back());
  await pending;
  try {
    await searchInput(page).fill('website');
    await expect(page).toHaveURL(/\/en\/blog\/$/);
    expect(errors).toEqual([]);
  } finally {
    release();
  }
  await expect(blogListing(page)).toHaveAttribute('data-blog-runtime-ready', '');
  await page.goForward();
  await expect(searchInput(page)).toHaveValue('git');
  await expect(page.locator('[data-search-results]')).toHaveAttribute('data-query', 'git');
  expect(errors).toEqual([]);
});
