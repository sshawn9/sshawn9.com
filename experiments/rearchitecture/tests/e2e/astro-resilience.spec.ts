import { expect, test } from '@playwright/test';
import { installFontPreparationGate } from '../support/font-preparation-gate';

function skipNonAstro(projectName: string) {
  test.skip(projectName !== 'astro', 'This suite exercises Astro ClientRouter.');
}

async function setScrollState(
  page: import('@playwright/test').Page,
  pageY: number,
  region: 'tag-rail' | 'article-toc',
  regionY: number,
) {
  const position = await page.evaluate(
    ({ pageY, region, regionY }) => {
      const previousScrollBehavior = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = 'auto';
      window.scrollTo(0, pageY);
      document.documentElement.style.scrollBehavior = previousScrollBehavior;

      const element = document.querySelector<HTMLElement>(`[data-scroll-region="${region}"]`);
      element?.scrollTo(0, regionY);

      return {
        pageY: Math.round(window.scrollY),
        regionY: Math.round(element?.scrollTop ?? 0),
      };
    },
    { pageY, region, regionY },
  );

  await expect
    .poll(() =>
      page.evaluate((region) => history.state?.rearchitecturePoc?.regions?.[region]?.y, region),
    )
    .toBe(position.regionY);

  return position;
}

async function expectScrollState(
  page: import('@playwright/test').Page,
  region: 'tag-rail' | 'article-toc',
  expected: { pageY: number; regionY: number },
) {
  await expect
    .poll(() =>
      page.evaluate((region) => {
        const state = history.state?.rearchitecturePoc;
        return {
          routeKey: state?.routeKey,
          pageY: state?.page?.y,
          regionY: state?.regions?.[region]?.y,
        };
      }, region),
    )
    .toEqual({
      routeKey: new URL(page.url()).pathname + new URL(page.url()).search,
      pageY: expected.pageY,
      regionY: expected.regionY,
    });
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(expected.pageY);
  await expect
    .poll(() =>
      page
        .locator(`[data-scroll-region="${region}"]`)
        .evaluate((element) => Math.round(element.scrollTop)),
    )
    .toBe(expected.regionY);
}

async function clickVisibleBrand(page: import('@playwright/test').Page) {
  await expect(page.locator('a.brand')).toBeVisible();
  await page.locator('a.brand').dispatchEvent('click');
}

test('font preparation keeps the old page interactive until the shared font is ready', async ({
  page,
}, testInfo) => {
  skipNonAstro(testInfo.project.name);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/zh/blog/');
  await expect(page.locator('[data-blog-page]')).toBeVisible();
  const fontGate = await installFontPreparationGate(page);

  const navigation = page.locator('[data-article-link="primary"]').click();
  await expect(page.locator('[data-navigation-progress]')).toHaveAttribute('data-active', 'true');
  await expect.poll(fontGate.callCount).toBeGreaterThan(0);
  await expect(page.locator('[data-blog-page]')).toBeVisible();
  await expect(page.locator('[data-article-page]')).toHaveCount(0);

  await page.getByRole('button', { name: '切换主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await fontGate.release();
  await navigation;
  await expect(page.locator('[data-article-page]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('font failure degrades explicitly without blocking complete article navigation', async ({
  page,
}, testInfo) => {
  skipNonAstro(testInfo.project.name);

  await page.route(/\.woff2(?:\?.*)?$/, (route) => route.abort('failed'));
  await page.goto('/zh/blog/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-blog-page]')).toBeVisible();

  await page.locator('[data-article-link="primary"]').click();
  await expect(page.locator('[data-article-page]')).toBeVisible();
  await expect(page.locator('.article-layout')).toHaveCSS('display', 'grid');
});

test('a superseding navigation is the only transaction allowed to commit', async ({
  page,
}, testInfo) => {
  skipNonAstro(testInfo.project.name);

  await page.goto('/zh/blog/');
  await page.evaluate(() => {
    const swaps: string[] = [];
    Object.assign(window, { __pocSwapPaths: swaps });
    document.addEventListener('astro:after-swap', () => {
      swaps.push(window.location.pathname);
    });
  });

  let releaseArticle = () => {};
  let articleRequestStarted = () => {};
  const articleGate = new Promise<void>((resolve) => {
    releaseArticle = resolve;
  });
  const requestStarted = new Promise<void>((resolve) => {
    articleRequestStarted = resolve;
  });
  let intercepted = false;

  await page.route(/\/zh\/blog\/frenet-poc\//, async (route) => {
    if (!intercepted && ['document', 'fetch'].includes(route.request().resourceType())) {
      intercepted = true;
      articleRequestStarted();
      await articleGate;
      await route.continue().catch(() => {});
      return;
    }
    await route.continue();
  });

  const firstNavigation = page
    .locator('[data-article-link="primary"]')
    .click()
    .catch(() => {});
  await requestStarted;
  await expect(page.locator('[data-navigation-progress]')).toHaveAttribute('data-active', 'true');

  await page.locator('a[href="/zh/blog/tag/frenet/"]').first().click();
  await expect(page).toHaveURL(/\/zh\/blog\/tag\/frenet\/$/);
  await expect(page.getByRole('heading', { name: '#Frenet' })).toBeVisible();

  releaseArticle();
  await firstNavigation;
  await page.waitForTimeout(100);

  await expect(page.locator('[data-article-page]')).toHaveCount(0);
  await expect(page.locator('[data-navigation-progress]')).toHaveAttribute('data-active', 'false');
  expect(
    await page.evaluate(
      () => (window as Window & { __pocSwapPaths?: string[] }).__pocSwapPaths ?? [],
    ),
  ).toEqual(['/zh/blog/tag/frenet/']);
});

test('same-path article history entries restore their own scroll state', async ({
  page,
}, testInfo) => {
  skipNonAstro(testInfo.project.name);

  await page.goto('/zh/blog/');
  await page.locator('[data-article-link="primary"]').click();
  await expect(page.locator('[data-article-page]')).toBeVisible();
  const firstUrl = page.url();
  const firstPosition = await setScrollState(page, 480, 'article-toc', 160);

  await clickVisibleBrand(page);
  await expect(page.locator('[data-blog-page]')).toBeVisible();
  await page.locator('[data-article-link="history"]').click();
  await expect(page.locator('[data-article-page]')).toBeVisible();
  const secondUrl = page.url();
  expect(new URL(secondUrl).pathname).toBe(new URL(firstUrl).pathname);
  expect(secondUrl).not.toBe(firstUrl);
  const secondPosition = await setScrollState(page, 1_120, 'article-toc', 420);

  await clickVisibleBrand(page);
  await expect(page.locator('[data-blog-page]')).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(secondUrl);
  await expect(page.locator('[data-article-page]')).toBeVisible();
  await expectScrollState(page, 'article-toc', secondPosition);

  await page.goBack();
  await expect(page.locator('[data-blog-page]')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(firstUrl);
  await expect(page.locator('[data-article-page]')).toBeVisible();
  await expectScrollState(page, 'article-toc', firstPosition);

  await page.goForward();
  await expect(page.locator('[data-blog-page]')).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(secondUrl);
  await expectScrollState(page, 'article-toc', secondPosition);
});

test('corrupt scroll state falls back safely on traversal', async ({ page }, testInfo) => {
  skipNonAstro(testInfo.project.name);

  await page.goto('/zh/blog/frenet-poc/?source=corrupt-state');
  await expect(page.locator('[data-article-page]')).toBeVisible();
  await page.evaluate(() => {
    history.replaceState(
      {
        ...history.state,
        rearchitecturePoc: {
          version: 99,
          routeKey: window.location.pathname + window.location.search,
          page: { x: 0, y: 999_999 },
          regions: { 'article-toc': { x: 0, y: Number.NaN } },
        },
      },
      '',
    );
    history.pushState({}, '', '/zh/blog/');
    window.location.reload();
  });

  await expect(page.locator('[data-blog-page]')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/source=corrupt-state$/);
  await expect(page.locator('[data-article-page]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0);
});

test('history state write failure never aborts navigation', async ({ page }, testInfo) => {
  skipNonAstro(testInfo.project.name);

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/zh/blog/');
  await page.evaluate(() => {
    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = (data, unused, url) => {
      if (data?.rearchitecturePoc) {
        history.replaceState = originalReplaceState;
        throw new DOMException('history state quota exceeded', 'QuotaExceededError');
      }
      originalReplaceState(data, unused, url);
    };
    window.scrollTo(0, 120);
  });

  await page.locator('[data-article-link="primary"]').click();
  await expect(page.locator('[data-article-page]')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('theme follows live system changes until the user makes an explicit choice', async ({
  page,
}, testInfo) => {
  skipNonAstro(testInfo.project.name);

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/zh/blog/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.theme-icon-light')).toBeVisible();

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.theme-icon-dark')).toBeVisible();

  await page.getByRole('button', { name: '切换主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme-transition', 'active');
  await expect
    .poll(() =>
      page.locator('html').evaluate((element) => getComputedStyle(element).transitionDuration),
    )
    .toContain('0.6s');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: '切换主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('invalid or unavailable theme storage degrades to a usable system theme', async ({
  page,
}, testInfo) => {
  skipNonAstro(testInfo.project.name);

  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    localStorage.setItem('poc:theme', 'sepia');
  });
  await page.goto('/zh/blog/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.addInitScript(() => {
    Object.defineProperties(Storage.prototype, {
      getItem: {
        configurable: true,
        value: () => {
          throw new DOMException('storage blocked', 'SecurityError');
        },
      },
      setItem: {
        configurable: true,
        value: () => {
          throw new DOMException('storage blocked', 'SecurityError');
        },
      },
    });
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: '切换主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('[data-article-link="primary"]').click();
  await expect(page.locator('[data-article-page]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
