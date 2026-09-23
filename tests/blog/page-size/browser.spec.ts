import { expect, test, type Page } from '@playwright/test';

const listing = (page: Page) => page.locator('[data-blog-listing]');
const select = (page: Page) => page.getByRole('combobox', { name: /Articles per page|每页篇数/ });
async function chooseSize(page: Page, value: string) {
  await select(page).click();
  await page.getByRole('option', { name: value, exact: true }).click();
}
const articles = (page: Page) => page.locator('[data-blog-article]:not([hidden]) h2 a');
const hrefs = (page: Page) =>
  articles(page).evaluateAll((links) => links.map((link) => link.getAttribute('href')));

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 700 },
]) {
  test(`changing page size preserves scroll position at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/zh/blog/');
    await expect(select(page)).toBeEnabled();
    await page.evaluate(() => document.fonts.ready);

    for (const top of [0, 8]) {
      await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), top);
      for (const value of ['10', '20', '50', '5']) {
        await chooseSize(page, value);
        await expect(select(page)).toHaveAttribute('value', value);
        // Observe animation frames so an unwanted smooth scroll cannot pass
        // merely because its first frame has not run yet.
        const maxDistance = await page.evaluate(async (top) => {
          let distance = Math.abs(scrollY - top);
          for (let frame = 0; frame < 20; frame += 1) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            distance = Math.max(distance, Math.abs(scrollY - top));
          }
          return distance;
        }, top);
        expect(maxDistance).toBe(0);
      }
    }
  });
}

test('size changes update the view, replace out-of-range pages, and never create history', async ({
  page,
}) => {
  await page.goto('/en/projects/');
  await page.goto('/en/blog/?page=3');
  await expect(select(page)).toBeEnabled();
  const historyLength = await page.evaluate(() => history.length);
  const all = await page
    .locator('[data-blog-article] h2 a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(await hrefs(page)).toEqual(all.slice(10, 15));
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/en/blog/') requests.push(request.url());
  });
  await listing(page).evaluate((element) => {
    element.dataset.testIdentity = 'retained';
  });
  await chooseSize(page, '10');
  await expect(select(page)).toBeFocused();
  await expect(page).toHaveURL(/\?page=2$/);
  expect(await hrefs(page)).toEqual(all.slice(10, 20));
  await chooseSize(page, '5');
  await expect(page).toHaveURL(/\?page=2$/);
  expect(await hrefs(page)).toEqual(all.slice(5, 10));
  await expect(listing(page)).toHaveAttribute('data-test-identity', 'retained');
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  expect(requests).toEqual([]);
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/projects\/$/);
  await page.goForward();
  await expect(page).toHaveURL(/\?page=2$/);
  await expect(select(page)).toHaveAttribute('value', '5');
});

test('interleaved page and size actions commit in order while history uses the current preference', async ({
  page,
}) => {
  await page.goto('/en/blog/');
  await expect(select(page)).toBeEnabled();
  const historyLength = await page.evaluate(() => history.length);
  await page.evaluate(() => {
    const next = document.querySelector<HTMLAnchorElement>('[data-blog-page="next"]')!;
    const trigger = document.querySelector<HTMLButtonElement>('[data-blog-page-size]')!;
    const choose = (value: string) => {
      trigger.click();
      document
        .querySelector<HTMLElement>(`[data-blog-page-size-option][data-value="${value}"]`)!
        .click();
    };
    next.click();
    choose('50');
    choose('5');
    next.click();
    next.click();
  });
  await expect(listing(page)).toHaveAttribute('data-current-page', '3');
  await expect(select(page)).toHaveAttribute('value', '5');
  await expect.poll(() => page.evaluate(() => history.length)).toBe(historyLength + 3);
  await chooseSize(page, '10');
  await expect(page).toHaveURL(/\?page=2$/);
  await page.goBack();
  await expect(select(page)).toHaveAttribute('value', '10');
  await expect(listing(page)).toHaveAttribute('data-current-page', '2');
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect(select(page)).toHaveAttribute('value', '10');
  await page.reload();
  await expect(select(page)).toHaveAttribute('value', '10');
});

test('filtering and language navigation share the preference while retired query values never override it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/blog/');
  await chooseSize(page, '10');
  await page.locator('[data-blog-tag-definition][data-tag-slug="astro"]').click();
  await expect(page).toHaveURL(/\?tag=astro$/);
  for (const value of ['20', '50']) {
    await chooseSize(page, value);
    await expect(select(page)).toHaveText(`${value} per page`);
    await expect(page).toHaveURL(/\?tag=astro$/);
    await expect(page.locator('[data-blog-pagination]')).toBeHidden();
    await expect(page.locator('[data-blog-page-size-option-label]')).toHaveText([
      '5',
      '10',
      '20',
      '50',
    ]);
  }
  await page.locator('[data-locale-switch="zh"]:visible').click();
  await expect(page).toHaveURL(/\/zh\/blog\/\?tag=astro$/);
  await expect(select(page)).toHaveAttribute('value', '50');
  await expect(select(page)).toHaveText('每页 50 篇');
  await expect(page.locator('[data-blog-page-size-option-label]')).toHaveText([
    '5',
    '10',
    '20',
    '50',
  ]);
  await page.goto('/en/blog/?pageSize=5');
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect(select(page)).toHaveAttribute('value', '50');
});

test('resizing, mobile disclosure and zoom keep article membership unchanged and controls fit narrow screens', async ({
  page,
}) => {
  await page.goto('/zh/blog/?page=2');
  await expect(select(page)).toBeEnabled();
  const initial = await hrefs(page);
  for (const width of [1440, 390, 320, 720]) {
    await page.setViewportSize({ width, height: 480 });
    expect(await hrefs(page)).toEqual(initial);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 390, height: 600 });
  const toggle = page.locator('[data-blog-mobile-toggle]');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(await hrefs(page)).toEqual(initial);
  await page.evaluate(() => {
    document.documentElement.style.zoom = '1.5';
  });
  expect(await hrefs(page)).toEqual(initial);
  await expect(select(page)).toHaveAttribute('value', '5');
});

test('pagination links open a new tab with the current size while the original tab stays put', async ({
  page,
  context,
}) => {
  await page.goto('/en/blog/');
  await chooseSize(page, '10');
  const next = page.locator('[data-blog-page="next"]');
  await expect(next).toHaveAttribute('href', /\?page=2$/);
  const popupPromise = context.waitForEvent('page');
  await next.click({ modifiers: ['ControlOrMeta'] });
  const popup = await popupPromise;
  await expect(select(popup)).toHaveAttribute('value', '10');
  await expect(listing(popup)).toHaveAttribute('data-current-page', '2');
  await expect(listing(page)).toHaveAttribute('data-current-page', '1');
  await popup.close();
});

test('leaving during queued updates preserves the confirmed setting and cancels old-page work', async ({
  page,
}) => {
  await page.goto('/en/blog/');
  await expect(select(page)).toBeEnabled();
  const article = await articles(page).first().getAttribute('href');
  await page.evaluate(() => {
    const article = document.querySelector<HTMLAnchorElement>(
      '[data-blog-article]:not([hidden]) h2 a',
    )!;
    document.querySelector<HTMLAnchorElement>('[data-blog-page="next"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-blog-page-size]')!.click();
    document.querySelector<HTMLElement>('[data-blog-page-size-option][data-value="10"]')!.click();
    article.click();
  });
  await expect.poll(() => new URL(page.url()).pathname).toBe(article);
  await expect(page.locator('[data-article-runtime-ready]')).toBeAttached();
  expect(await page.evaluate(() => localStorage.getItem('blog-page-size'))).toBe('10');
  await page
    .locator('.site-header__primary-navigation')
    .getByRole('link', { name: 'Blog' })
    .click();
  await expect(select(page)).toHaveAttribute('value', '10');
  await expect(page).toHaveURL(/\/en\/blog\/$/);
});

test('a failed page render reloads the committed route without changing the reading preference', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/en/blog/');
  await chooseSize(page, '10');
  const historyLength = await page.evaluate(() => history.length);
  await listing(page).evaluate((element) => {
    element.dataset.testIdentity = 'before-failure';
  });
  await page.locator('[data-blog-result-count]').evaluate((element) => {
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!;
    Object.defineProperty(element, 'textContent', {
      get() {
        return descriptor.get!.call(this);
      },
      set() {
        throw new Error('Injected blog view render failure');
      },
    });
  });
  await page.locator('[data-blog-page="next"]').click();
  await expect(listing(page)).not.toHaveAttribute('data-test-identity', 'before-failure');
  await expect(listing(page)).toHaveAttribute('data-blog-runtime-ready', '');
  await expect(select(page)).toHaveAttribute('value', '10');
  await expect(page).toHaveURL(/\?page=2$/);
  expect(await page.evaluate(() => history.length)).toBe(historyLength + 1);
  expect(errors).toEqual(['Injected blog view render failure']);
  await page.goBack();
  await expect(select(page)).toHaveAttribute('value', '10');
  await expect(listing(page)).toHaveAttribute('data-current-page', '1');
});

test('clamping a page with a hash keeps subsequent pagination synchronized', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/en/blog/?page=2#main-content');
  await expect(select(page)).toBeEnabled();
  const historyLength = await page.evaluate(() => history.length);
  await chooseSize(page, '20');
  await expect(page).toHaveURL(/\/en\/blog\/#main-content$/);
  await expect(listing(page)).toHaveAttribute('data-current-page', '1');
  await chooseSize(page, '5');
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await page.locator('[data-blog-page="next"]').click();
  await expect(page).toHaveURL(/\?page=2#main-content$/);
  await expect(listing(page)).toHaveAttribute('data-current-page', '2');
  const all = await page
    .locator('[data-blog-article] h2 a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(await hrefs(page)).toEqual(all.slice(5, 10));
  await page.goBack();
  await expect(listing(page)).toHaveAttribute('data-current-page', '1');
  expect(errors).toEqual([]);
});

test('a pagination scroll measurement failure keeps the rendered page and later controls usable', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/en/blog/');
  await expect(select(page)).toBeEnabled();
  const documents: string[] = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documents.push(request.url());
  });
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-blog-listing]')!.dataset.testIdentity = 'retained';
    const heading = document.querySelectorAll<HTMLElement>('[data-blog-article] h2')[5]!;
    heading.getBoundingClientRect = () => {
      throw new Error('injected heading measurement failure');
    };
  });
  await page.locator('[data-blog-page="next"]').click();
  await expect(listing(page)).toHaveAttribute('data-current-page', '2');
  await expect.poll(() => errors.length).toBe(1);
  await page.locator('[data-blog-page="previous"]').click();
  await expect(listing(page)).toHaveAttribute('data-current-page', '1');
  await expect(listing(page)).toHaveAttribute('data-test-identity', 'retained');
  expect(documents).toEqual([]);
  expect(errors).toEqual(['injected heading measurement failure']);
});

test('initial clamping and history clamping with hashes keep the router and content aligned', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('blog-page-size', '10'));
  await page.goto('/en/blog/?page=4&pageSize=50#main-content');
  await expect(page).toHaveURL(/\?page=2#main-content$/);
  await expect(select(page)).toHaveAttribute('value', '10');
  await chooseSize(page, '5');
  await page.locator('[data-blog-page="next"]').click();
  await expect(listing(page)).toHaveAttribute('data-current-page', '3');
  await page.locator('[data-blog-page="next"]').click();
  await expect(listing(page)).toHaveAttribute('data-current-page', '4');
  await chooseSize(page, '10');
  await expect(listing(page)).toHaveAttribute('data-current-page', '2');
  await page.goBack();
  await expect(page).toHaveURL(/\?page=2#main-content$/);
  await expect(listing(page)).toHaveAttribute('data-current-page', '2');
  await chooseSize(page, '5');
  await page.locator('[data-blog-page="next"]').click();
  await expect(page).toHaveURL(/\?page=3#main-content$/);
  await expect(listing(page)).toHaveAttribute('data-current-page', '3');
  expect(errors).toEqual([]);
});

test('replacing a clamped page with a hash preserves its scroll position across frames', async ({
  page,
}) => {
  await page.goto('/en/blog/?page=3#main-content');
  await expect(select(page)).toBeEnabled();
  await page.evaluate(() => scrollTo({ top: 8, behavior: 'instant' }));
  await chooseSize(page, '10');
  await expect(page).toHaveURL(/\?page=2#main-content$/);
  const positions = await page.evaluate(async () => {
    const positions = [scrollY];
    for (let i = 0; i < 20; i++) {
      await new Promise(requestAnimationFrame);
      positions.push(scrollY);
    }
    return positions;
  });
  expect(positions).toEqual(Array(21).fill(8));
});
