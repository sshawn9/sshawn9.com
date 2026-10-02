import { expect, test, type Page } from '@playwright/test';
import { parseHTML } from 'linkedom';

const listing = (page: Page) => page.locator('[data-blog-listing]');
const toggle = (page: Page) => page.getByRole('switch', { name: /Compact|紧凑模式/ });
async function setMode(page: Page, value: 'detailed' | 'compact') {
  const checked = String(value === 'compact');
  await expect(toggle(page)).toBeEnabled();
  if ((await toggle(page).getAttribute('aria-checked')) !== checked) await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', checked);
}
const size = (page: Page) => page.locator('[data-blog-page-size]');
const articles = (page: Page) => page.locator('[data-blog-article]:not([hidden])');
async function choose(page: Page, value: number) {
  await size(page).click();
  await page.getByRole('option', { name: String(value), exact: true }).click();
  await expect(size(page)).toHaveAttribute('value', String(value));
}

async function mockArticleCount(page: Page, count: number) {
  await page.route(/\/en\/blog\/(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const { document } = parseHTML(await response.text());
    const list = document.querySelector('.blog-article-list')!;
    const sample = list.firstElementChild!;
    const rows = Array.from({ length: count }, (_, index) => {
      const row = sample.cloneNode(true) as HTMLElement;
      row.dataset.fixtureIndex = String(index + 1);
      return row;
    });
    list.replaceChildren(...rows);
    await route.fulfill({ response, body: document.toString() });
  });
}

test('each mode remembers its own size through navigation, reload, locale changes and later visits', async ({
  page,
  browser,
}) => {
  await page.goto('/en/blog/');
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await choose(page, 10);
  await setMode(page, 'compact');
  await expect(size(page)).toHaveAttribute('value', '15');
  await choose(page, 50);
  await setMode(page, 'detailed');
  await expect(size(page)).toHaveAttribute('value', '10');
  await setMode(page, 'compact');
  await expect(size(page)).toHaveAttribute('value', '50');
  await expect(
    listing(page).locator('.blog-article-meta:visible, .blog-article-copy p:visible'),
  ).toHaveCount(0);
  await page.reload();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await expect(size(page)).toHaveAttribute('value', '50');
  await articles(page).locator('h2 a').first().click();
  await expect(listing(page)).toHaveCount(0);
  await page
    .locator('.site-header__primary-navigation')
    .getByRole('link', { name: 'Blog', exact: true })
    .click();
  await expect(size(page)).toHaveAttribute('value', '50');
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-locale-switch="zh"]:visible').click();
  await expect(toggle(page)).toHaveText('紧凑模式');
  await expect(size(page)).toHaveText('每页 50 篇');
  expect(new URL(page.url()).search).toBe('');
  const later = await browser.newContext({ storageState: await page.context().storageState() });
  try {
    const fresh = await later.newPage();
    await fresh.goto(new URL('/en/blog/', page.url()).href);
    await expect(toggle(fresh)).toHaveAttribute('aria-checked', 'true');
    await expect(size(fresh)).toHaveAttribute('value', '50');
    await setMode(fresh, 'detailed');
    await expect(size(fresh)).toHaveAttribute('value', '10');
  } finally {
    await later.close();
  }
});

test('rapid toggles retain both choices while a page correction is pending', async ({ page }) => {
  await mockArticleCount(page, 16);
  await page.goto('/en/blog/?page=3');
  await expect(toggle(page)).toBeEnabled();
  const history = await page.evaluate(() => window.history.length);
  const originalWidth = (await toggle(page).boundingBox())!.width;
  await toggle(page).evaluate((element) => {
    const button = element as HTMLButtonElement;
    button.click();
    button.click();
  });
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await expect(listing(page)).toHaveAttribute('data-blog-display-mode', 'detailed');
  await expect(size(page)).toHaveAttribute('value', '5');
  await expect(page).toHaveURL(/\/en\/blog\/\?page=2$/);
  expect(await page.evaluate(() => window.history.length)).toBe(history);
  await toggle(page).press('Enter');
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await expect(toggle(page)).toHaveText('Compact');
  await expect(toggle(page)).toBeFocused();
  expect((await toggle(page).boundingBox())!.width).toBeCloseTo(originalWidth, 1);
  await toggle(page).press('Space');
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await expect(toggle(page)).toHaveText('Compact');
  expect((await toggle(page).boundingBox())!.width).toBeCloseTo(originalWidth, 1);
});

test('compact shares the existing pagination, clamping and history rules with a larger catalog', async ({
  page,
}) => {
  await mockArticleCount(page, 123);
  await page.goto('/en/blog/?page=3');
  await expect(articles(page)).toHaveCount(5);
  const history = await page.evaluate(() => window.history.length);
  await setMode(page, 'compact');
  await expect(articles(page)).toHaveCount(15);
  await expect(articles(page).first()).toHaveAttribute('data-fixture-index', '31');
  await expect(page).toHaveURL(/\?page=3$/);
  expect(await page.evaluate(() => window.history.length)).toBe(history);
  await page.locator('[data-blog-page="next"]').click();
  await expect(articles(page).first()).toHaveAttribute('data-fixture-index', '46');
  await choose(page, 50);
  await expect(page).toHaveURL(/\?page=3$/);
  await expect(articles(page)).toHaveCount(23);
  await choose(page, 100);
  await expect(page).toHaveURL(/\?page=2$/);
  await expect(articles(page).first()).toHaveAttribute('data-fixture-index', '101');
  expect(await page.evaluate(() => window.history.length)).toBe(history + 1);
  await page.locator('[data-blog-page="previous"]').click();
  await expect(articles(page)).toHaveCount(100);
  await expect(articles(page).first()).toHaveAttribute('data-fixture-index', '1');
  await setMode(page, 'detailed');
  await expect(size(page)).toHaveAttribute('value', '5');
  await expect(articles(page)).toHaveCount(5);
});

for (const nativePopover of [true, false]) {
  test(`mode-specific options support keyboard selection with native Popover ${nativePopover}`, async ({
    page,
  }) => {
    if (!nativePopover)
      await page.addInitScript(() => {
        Object.defineProperty(HTMLElement.prototype, 'showPopover', {
          configurable: true,
          value: undefined,
        });
        Object.defineProperty(HTMLElement.prototype, 'hidePopover', {
          configurable: true,
          value: undefined,
        });
      });
    await page.goto('/en/blog/');
    await size(page).focus();
    await size(page).press('End');
    await expect(page.getByRole('option', { name: '50', exact: true })).toHaveAttribute(
      'data-active',
      '',
    );
    await expect(page.getByRole('option')).toHaveCount(4);
    await size(page).press('Escape');
    await toggle(page).focus();
    await toggle(page).press('Space');
    await expect(toggle(page)).toBeFocused();
    await size(page).focus();
    await size(page).press('1');
    await size(page).press('0');
    await size(page).press('0');
    await expect(page.getByRole('option')).toHaveCount(3);
    await expect(page.getByRole('option', { name: '100', exact: true })).toHaveAttribute(
      'data-active',
      '',
    );
    await size(page).press('Enter');
    await expect(size(page)).toHaveAttribute('value', '100');
    await size(page).press('Home');
    await size(page).press('Enter');
    await expect(size(page)).toHaveAttribute('value', '15');
    await setMode(page, 'detailed');
    await size(page).press('End');
    await size(page).press('Enter');
    await expect(size(page)).toHaveAttribute('value', '50');
  });
}

test('tabs retain independent modes and both page sizes while future tabs inherit each saved field', async ({
  page,
  context,
}) => {
  await page.goto('/en/blog/');
  await choose(page, 10);
  const other = await context.newPage();
  const fresh = await context.newPage();
  try {
    await other.goto('/en/blog/');
    await expect(size(other)).toHaveAttribute('value', '10');
    await size(page).click();
    await setMode(other, 'compact');
    await choose(other, 100);
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
    await expect(size(page)).toHaveAttribute('value', '10');
    await expect(page.getByRole('listbox', { name: 'Articles per page' })).toBeVisible();
    await size(page).press('Escape');
    await setMode(page, 'compact');
    await expect(size(page)).toHaveAttribute('value', '15');
    await choose(page, 50);
    await expect(size(other)).toHaveAttribute('value', '100');
    await setMode(other, 'detailed');
    await expect(size(other)).toHaveAttribute('value', '10');
    await choose(other, 20);
    await page.reload();
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
    await expect(size(page)).toHaveAttribute('value', '50');
    expect(await page.evaluate(() => localStorage.getItem('blog-display-mode'))).toBe('detailed');
    await fresh.goto(new URL('/en/blog/', page.url()).href);
    await expect(toggle(fresh)).toHaveAttribute('aria-checked', 'false');
    await expect(size(fresh)).toHaveAttribute('value', '20');
    await setMode(fresh, 'compact');
    await expect(size(fresh)).toHaveAttribute('value', '50');
    await other.reload();
    await expect(toggle(other)).toHaveAttribute('aria-checked', 'false');
    await expect(size(other)).toHaveAttribute('value', '20');
    await setMode(page, 'detailed');
    await expect(size(page)).toHaveAttribute('value', '10');
    expect(await page.evaluate(() => localStorage.getItem('blog-page-size'))).toBe('20');
    expect(await page.evaluate(() => localStorage.getItem('blog-compact-page-size'))).toBe('50');
  } finally {
    await other.close();
    await fresh.close();
  }
});

test('local mode changes repair article focus only when its target is hidden', async ({ page }) => {
  await mockArticleCount(page, 16);
  await page.goto('/en/blog/');
  await expect(toggle(page)).toBeEnabled();
  const activateWithoutMovingFocus = () =>
    toggle(page).evaluate((element) => (element as HTMLButtonElement).click());
  const firstTitle = articles(page).first().locator('h2 a');
  await articles(page).first().locator('.blog-article-meta a').first().focus();
  await activateWithoutMovingFocus();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await expect(firstTitle).toBeFocused();
  await activateWithoutMovingFocus();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await expect(firstTitle).toBeFocused();
  await setMode(page, 'compact');
  await articles(page).nth(10).locator('h2 a').focus();
  await activateWithoutMovingFocus();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('[data-blog-result-count]')).toBeFocused();
  await page.goto('/en/blog/?page=2');
  await expect(toggle(page)).toBeEnabled();
  await articles(page).first().locator('h2 a').focus();
  await activateWithoutMovingFocus();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-blog-result-count]')).toBeFocused();
});

test('saved compact mode is already applied at the first visible frames', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('blog-display-mode', 'compact');
    localStorage.setItem('blog-compact-page-size', '100');
    const frames: Array<{
      mode?: string;
      size?: string;
      metadata: string;
      checked: string | null;
    }> = [];
    Object.defineProperty(window, '__compactFrames', { value: frames });
    const observer = new PerformanceObserver((entries) => {
      if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      observer.disconnect();
      const sample = () => {
        const listing = document.querySelector<HTMLElement>('[data-blog-listing]');
        if (listing)
          frames.push({
            mode: listing.dataset.blogDisplayMode,
            size: listing.dataset.pageSize,
            metadata: getComputedStyle(listing.querySelector('.blog-article-meta')!).display,
            checked: listing
              .querySelector('[data-blog-compact-toggle]')!
              .getAttribute('aria-checked'),
          });
        if (frames.length < 8) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    observer.observe({ type: 'paint', buffered: true });
  });
  await page.goto('/zh/blog/');
  const readFrames = () =>
    page.evaluate(
      () =>
        (
          window as unknown as Window & {
            __compactFrames: Array<{
              mode?: string;
              size?: string;
              metadata: string;
              checked: string | null;
            }>;
          }
        ).__compactFrames,
    );
  await expect.poll(async () => (await readFrames()).length).toBe(8);
  expect(
    (await readFrames()).every(
      (frame) =>
        frame.mode === 'compact' &&
        frame.size === '100' &&
        frame.metadata === 'none' &&
        frame.checked === 'true',
    ),
  ).toBe(true);
});
