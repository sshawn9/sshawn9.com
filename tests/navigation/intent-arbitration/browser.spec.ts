import { expect, test, type Page } from '@playwright/test';

const blogPath = '/en/blog/';
const articlePath = '/en/blog/git-operations-reference/';

function blogListing(page: Page) {
  return page.locator('[data-blog-listing]');
}

function blogTag(page: Page, slug: string) {
  return page.locator(`[data-blog-tag-definition][data-tag-slug="${slug}"]`);
}

function searchInput(page: Page) {
  return page.locator('[data-search-input]');
}

async function waitForSearch(page: Page) {
  await expect(page.locator('[data-site-search]')).toHaveAttribute('data-search-ready', '');
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

test('a navigation superseded during its outgoing fade cannot swap or leave visual state behind', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/en/blog/');
  await page.evaluate(() => {
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a')) {
      link.dataset.astroPrefetch = 'false';
    }
  });

  const staleClick = page.getByRole('link', { name: 'Projects' }).click();
  await expect(page.locator('.page-outlet')).toHaveAttribute('data-page-outlet-leaving', '');
  await page.getByRole('link', { name: 'About' }).click();
  await staleClick;

  await expect(page).toHaveURL(/\/en\/about\/$/);
  await expect(page.locator('.about-page')).toBeVisible();
  await expect(page.getByRole('link', { name: 'About', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('.page-outlet')).toHaveCSS('opacity', '1');
  await expect(page.locator('.page-outlet')).not.toHaveAttribute('data-page-outlet-leaving', '');
  await expect(page.locator('.page-outlet')).not.toHaveAttribute('data-page-outlet-entering', '');
  expect(pageErrors).toEqual([]);
});

test('a newer navigation cancels stale preparation without a late error or swap', async ({
  page,
}) => {
  let releaseFirstResponse = () => {};
  const firstResponseGate = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve;
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route(`**${articlePath}`, async (route) => {
    if (route.request().resourceType() !== 'fetch') {
      await route.continue();
      return;
    }
    await firstResponseGate;
    await route.continue();
  });

  await page.goto('/en/blog/');
  await page.evaluate(() => {
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a')) {
      link.dataset.astroPrefetch = 'false';
    }
    document.querySelector<HTMLElement>('[data-wallpaper-visual]')!.dataset.identityProbe =
      'original';
  });

  const staleClick = page.getByRole('link', { name: 'Git Operations Reference' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
  await page.getByRole('link', { name: '中文' }).click();
  await expect(page).toHaveURL(/\/zh\/blog\/$/);
  releaseFirstResponse();
  await staleClick;

  await expect(page.locator('[data-wallpaper-visual]')).toHaveAttribute(
    'data-identity-probe',
    'original',
  );
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.waitForTimeout(50);
  expect(pageErrors).toEqual([]);
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
