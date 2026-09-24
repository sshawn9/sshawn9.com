import { expect, test, type Page } from '@playwright/test';

const size = (page: Page) => page.getByRole('combobox', { name: /Articles per page|每页篇数/ });
const listing = (page: Page) => page.locator('[data-blog-listing]');
async function choose(page: Page, value: number) {
  await size(page).click();
  await page.getByRole('option', { name: String(value), exact: true }).click();
  await expect(size(page)).toHaveAttribute('value', String(value));
}
async function nav(page: Page, label: string) {
  if (await page.locator('[data-mobile-menu-trigger]').isVisible()) {
    await page.locator('[data-mobile-menu-trigger]').click();
    await page
      .locator('.site-header__mobile-navigation')
      .getByRole('link', { name: label, exact: true })
      .click();
    await expect(page.locator('[data-shell-mobile-menu]')).toBeHidden();
  } else {
    await page
      .locator('.site-header__primary-navigation')
      .getByRole('link', { name: label, exact: true })
      .click();
  }
}

for (const width of [1440, 390]) {
  test(`navigation and later visits preserve the preference at ${width}px`, async ({
    page,
    browser,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/zh/blog/');
    await choose(page, 10);
    await page.locator('[data-blog-page="next"]').click();
    await expect(listing(page)).toHaveAttribute('data-current-page', '2');
    await nav(page, '博客');
    await expect(page).toHaveURL(/\/zh\/blog\/$/);
    await expect(listing(page)).toHaveAttribute('data-current-page', '1');
    await expect(size(page)).toHaveAttribute('value', '10');
    await nav(page, '项目');
    await expect(page).toHaveURL(/\/zh\/projects\/$/);
    await nav(page, '博客');
    await expect(size(page)).toHaveAttribute('value', '10');
    await page.reload();
    await expect(size(page)).toHaveAttribute('value', '10');
    const storageState = await page.context().storageState();
    const later = await browser.newContext({ storageState });
    try {
      const fresh = await later.newPage();
      await fresh.goto(new URL('/en/blog/', page.url()).href);
      await expect(size(fresh)).toHaveAttribute('value', '10');
      await expect(listing(fresh)).toHaveAttribute('data-current-page', '1');
      expect(new URL(fresh.url()).search).toBe('');
    } finally {
      await later.close();
    }
  });
}

test('tabs keep their page sizes through navigation and reload while new tabs inherit the latest choice', async ({
  page,
  context,
}) => {
  await page.goto('/en/blog/');
  await expect(size(page)).toBeEnabled();
  const other = await context.newPage();
  const fresh = await context.newPage();
  try {
    await other.goto('/en/blog/?page=3');
    await expect(size(other)).toHaveAttribute('value', '5');
    const historyLength = await other.evaluate(() => history.length);
    await choose(page, 20);
    await expect(size(other)).toHaveAttribute('value', '5');
    await expect(other).toHaveURL(/\?page=3$/);
    expect(await other.evaluate(() => history.length)).toBe(historyLength);
    expect(await other.evaluate(() => scrollY)).toBe(0);
    await other.reload();
    await expect(size(other)).toHaveAttribute('value', '5');
    expect(await other.evaluate(() => localStorage.getItem('blog-page-size'))).toBe('20');
    await nav(page, 'Projects');
    await expect(page).toHaveURL(/\/en\/projects\/$/);
    await choose(other, 10);
    await nav(page, 'Blog');
    await expect(size(page)).toHaveAttribute('value', '20');
    await page.reload();
    await expect(size(page)).toHaveAttribute('value', '20');
    expect(await page.evaluate(() => localStorage.getItem('blog-page-size'))).toBe('10');
    await fresh.goto(new URL('/en/blog/', page.url()).href);
    await expect(size(fresh)).toHaveAttribute('value', '10');
  } finally {
    await other.close();
    await fresh.close();
  }
});

test('denied storage retains the setting in memory across document navigation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'blog-page-size') throw new DOMException('Storage denied', 'SecurityError');
      return setItem.call(this, key, value);
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/en/blog/');
  await choose(page, 10);
  await nav(page, 'Projects');
  await expect(page).toHaveURL(/\/en\/projects\/$/);
  await nav(page, 'Blog');
  await expect(size(page)).toHaveAttribute('value', '10');
  await page.reload();
  await expect(size(page)).toHaveAttribute('value', '5');
  expect(errors).toEqual([]);
});

test('history restores route state with the current preference and silently clamps obsolete pages', async ({
  page,
}) => {
  await page.goto('/en/blog/?page=2');
  await expect(size(page)).toBeEnabled();
  await page.locator('[data-blog-page="next"]').click();
  await expect(page).toHaveURL(/\?page=3$/);
  const historyLength = await page.evaluate(() => history.length);
  await choose(page, 10);
  await expect(page).toHaveURL(/\?page=2$/);
  await page.goBack();
  await expect(page).toHaveURL(/\?page=2$/);
  await expect(size(page)).toHaveAttribute('value', '10');
  await expect(listing(page)).toHaveAttribute('data-current-page', '2');
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await page.goForward();
  await expect(size(page)).toHaveAttribute('value', '10');
  await expect(page).toHaveURL(/\?page=2$/);
});

test('the initial preference is visible immediately and pageshow preserves this tab’s choice', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('blog-page-size')) localStorage.setItem('blog-page-size', '10');
    const sizes: string[] = [];
    Object.assign(window, { __blogSizes: sizes });
    const sample = () => {
      const list = document.querySelector<HTMLElement>('[data-blog-listing]');
      if (list && document.documentElement.dataset.fontState === 'ready')
        sizes.push(list.dataset.pageSize ?? '');
      if (sizes.length < 8) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.goto('/en/blog/');
  await expect(size(page)).toHaveAttribute('value', '10');
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { __blogSizes?: string[] }).__blogSizes?.length),
    )
    .toBe(8);
  expect(
    await page.evaluate(() => (window as Window & { __blogSizes?: string[] }).__blogSizes),
  ).toEqual(Array(8).fill('10'));
  await page.evaluate(() => {
    localStorage.setItem('blog-page-size', '20');
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(size(page)).toHaveAttribute('value', '10');
  await page.reload();
  await expect(size(page)).toHaveAttribute('value', '10');
  expect(await page.evaluate(() => localStorage.getItem('blog-page-size'))).toBe('20');
});

test('another tab cannot replace this tab’s settings during a prepared document navigation', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/blog/');
  await expect(size(page)).toBeEnabled();
  const other = await context.newPage();
  await other.goto('/en/blog/');
  await expect(size(other)).toBeEnabled();
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<typeof animate>) {
      const animation = animate.apply(this, args);
      if (this.matches('.page-outlet[data-page-outlet-leaving]')) {
        animation.pause();
        Object.assign(window, { __blogOutgoing: animation });
      }
      return animation;
    };
    document.addEventListener('astro:after-swap', () => {
      Object.assign(window, {
        __blogSwapSize:
          document.querySelector<HTMLElement>('[data-blog-listing]')?.dataset.pageSize,
      });
    });
  });
  try {
    await page.locator('[data-locale-switch="zh"]:visible').click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as Window & { __blogOutgoing?: Animation }).__blogOutgoing?.playState,
        ),
      )
      .toBe('paused');
    await choose(other, 20);
    // Another tab changes the defaults for future tabs, not this prepared document.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('blog-page-size'))).toBe('20');
    await page.evaluate(() =>
      (window as Window & { __blogOutgoing?: Animation }).__blogOutgoing?.finish(),
    );
    await expect(page).toHaveURL(/\/zh\/blog\/$/);
    await expect(size(page)).toHaveAttribute('value', '5');
    expect(
      await page.evaluate(() => (window as Window & { __blogSwapSize?: string }).__blogSwapSize),
    ).toBe('5');
  } finally {
    await page.evaluate(() => {
      const animation = (window as Window & { __blogOutgoing?: Animation }).__blogOutgoing;
      if (animation?.playState === 'paused') animation.finish();
    });
    await other.close();
  }
});

for (const target of ['page', 'document'] as const) {
  test(`a same-frame anchor cancels pending ${target} navigation without losing the confirmed preference`, async ({
    page,
  }) => {
    await page.goto('/en/blog/');
    await expect(size(page)).toBeEnabled();
    await page.evaluate((target) => {
      const selector = target === 'page' ? '[data-blog-page="next"]' : '[data-blog-article] h2 a';
      document.querySelector<HTMLElement>(selector)!.click();
      document.querySelector<HTMLElement>('[data-blog-page-size]')!.click();
      document.querySelector<HTMLElement>('[data-blog-page-size-option][data-value="10"]')!.click();
      document.querySelector<HTMLAnchorElement>('a.skip-link')!.click();
    }, target);
    await expect(page).toHaveURL(/\/en\/blog\/#main-content$/);
    await expect(size(page)).toHaveAttribute('value', '10');
    expect(await page.evaluate(() => localStorage.getItem('blog-page-size'))).toBe('10');
  });
}

test('an anchor cancelling navbar navigation reconciles a queued preference and releases later commands', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/blog/?page=2');
  await expect(size(page)).toBeEnabled();
  await page.evaluate(() => {
    document
      .querySelector<HTMLAnchorElement>('.site-header__primary-navigation a[href="/en/blog/"]')!
      .click();
    document.querySelector<HTMLElement>('[data-blog-page-size]')!.click();
    document.querySelector<HTMLElement>('[data-blog-page-size-option][data-value="10"]')!.click();
    document.querySelector<HTMLAnchorElement>('a.skip-link')!.click();
  });
  await expect(page).toHaveURL(/\?page=2#main-content$/);
  await expect(size(page)).toHaveAttribute('value', '10');
  expect(await page.evaluate(() => localStorage.getItem('blog-page-size'))).toBe('10');
  await page.locator('[data-blog-page="previous"]').click();
  await expect(listing(page)).toHaveAttribute('data-current-page', '1');
  await choose(page, 5);
  await page.locator('[data-blog-page="next"]').click();
  await expect(listing(page)).toHaveAttribute('data-current-page', '2');
  expect(errors).toEqual([]);
});
