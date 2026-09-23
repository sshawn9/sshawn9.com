import { expect, test, type Page } from '@playwright/test';
import { routeWallpaperResources, seedTwoSlots } from '../../wallpaper/browser-fixtures';

const browserEnv = { ...process.env };
delete browserEnv.WAYLAND_DISPLAY;
// Headless Chromium otherwise hides the scrollbar that caused this regression.
test.use({ launchOptions: { env: browserEnv, ignoreDefaultArgs: ['--hide-scrollbars'] } });

const dock = (page: Page) => page.locator('[data-blog-pagination]');
const next = (page: Page) => page.locator('[data-blog-page="next"]');
const previous = (page: Page) => page.locator('[data-blog-page="previous"]');
const listing = (page: Page) => page.locator('[data-blog-listing]');
const firstHeading = (page: Page) => page.locator('[data-blog-article]:not([hidden]) h2').first();
const size = (page: Page) => page.getByRole('combobox', { name: '每页篇数' });

async function ready(page: Page, query = '', locale = 'zh') {
  await page.goto(`/${locale}/blog/${query}`);
  await expect(listing(page)).toHaveAttribute('data-blog-runtime-ready', '');
  await page.evaluate(() => document.fonts.ready);
  await expect(dock(page)).toHaveAttribute('data-positioned', '');
}

test('the right dock stays in place through clicks, boundaries, and scrolling to the footer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await ready(page);
  await expect(dock(page)).toHaveAttribute('data-placement', 'side');
  const total = await page.locator('[data-blog-article]').count();
  await expect(page.locator('[data-blog-page-indicator]')).toHaveText(
    `1 / ${Math.ceil(total / 5)}`,
  );
  const box = (await dock(page).boundingBox())!;
  const content = (await listing(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(content.x + content.width + 15);
  await dock(page).evaluate((element) => {
    element.dataset.identity = 'original';
  });
  await next(page).click();
  await expect(listing(page)).toHaveAttribute('data-current-page', '2');
  await next(page).click();
  await expect(listing(page)).toHaveAttribute('data-current-page', '3');
  await previous(page).click();
  await expect(listing(page)).toHaveAttribute('data-current-page', '2');
  expect(await dock(page).boundingBox()).toEqual(box);
  await expect(dock(page)).toHaveAttribute('data-identity', 'original');
  expect(await page.evaluate(() => scrollY)).toBe(0);

  await page.evaluate(() =>
    scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
  );
  expect(await dock(page).boundingBox()).toEqual(box);
  expect(
    await next(page).evaluate((element) => {
      const r = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }),
  ).toBe(true);
});

test.describe('reserved gutter with native scrollbars', () => {
  for (const width of [1920, 1280, 390, 320]) {
    test(`scrollbar visibility and paging preserve the dock position at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => localStorage.setItem('wallpaper-enabled', 'false'));
      await ready(page);
      await expect(dock(page)).toHaveAttribute(
        'data-placement',
        width === 1920 ? 'side' : 'bottom',
      );
      expect(
        await page.evaluate(() => innerWidth - document.documentElement.clientWidth),
      ).toBeGreaterThan(0);
      const original = (await dock(page).boundingBox())!;
      const expectStableFrames = async () => {
        const frames = await dock(page).evaluate(async (element) => {
          const samples = [];
          for (let n = 0; n < 6; n++) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            const { x, y, width, height } = element.getBoundingClientRect();
            samples.push({ x, y, width, height });
          }
          return samples;
        });
        for (const frame of frames) expect(frame).toEqual(original);
      };
      for (const overflow of ['hidden', 'scroll', 'hidden', '']) {
        await page.evaluate((value) => {
          document.documentElement.style.overflowY = value;
        }, overflow);
        if (overflow === 'hidden') {
          expect(await page.evaluate(() => innerWidth - document.documentElement.clientWidth)).toBe(
            0,
          );
        }
        await expectStableFrames();
      }
      const last = Number(await page.locator('[data-blog-page-total]').textContent());
      for (let target = 2; target <= last; target++) {
        await next(page).click();
        await expect(listing(page)).toHaveAttribute('data-current-page', String(target));
        await expectStableFrames();
      }
      await previous(page).click();
      await expect(listing(page)).toHaveAttribute('data-current-page', String(last - 1));
      await expectStableFrames();
    });
  }
});

test('responsive placement preserves the same control, focus, URL and articles', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await ready(page, '?page=2');
  await next(page).focus();
  const hrefs = () =>
    page
      .locator('[data-blog-article]:not([hidden]) h2 a')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')));
  const initial = await hrefs();
  for (const width of [1280, 390, 320, 1920]) {
    await page.setViewportSize({ width, height: 700 });
    await expect(dock(page)).toHaveAttribute('data-placement', width === 1920 ? 'side' : 'bottom');
    await expect(next(page)).toBeFocused();
    await expect(page).toHaveURL(/\?page=2$/);
    expect(await hrefs()).toEqual(initial);
    const box = (await dock(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(700);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

for (const width of [1920, 390]) {
  test(`paging reveals a hidden heading but preserves the top and browser history at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await ready(page);
    await next(page).click();
    await expect(listing(page)).toHaveAttribute('data-current-page', '2');
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await previous(page).click();
    await expect(listing(page)).toHaveAttribute('data-current-page', '1');
    await page.evaluate(() =>
      scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
    );
    const originalY = await page.evaluate(() => scrollY);
    expect(originalY).toBeGreaterThan(0);
    await next(page).click();
    await expect(listing(page)).toHaveAttribute('data-current-page', '2');
    const header = (await page.locator('.site-header').boundingBox())!;
    const heading = (await firstHeading(page).boundingBox())!;
    expect(heading.y).toBeGreaterThanOrEqual(header.y + header.height + 15);
    expect(heading.y).toBeLessThan(header.y + header.height + 18);
    const settledY = await page.evaluate(() => scrollY);
    await page.evaluate(async () => {
      for (let i = 0; i < 12; i++)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(await page.evaluate(() => scrollY)).toBe(settledY);
    await page.goBack();
    await expect(listing(page)).toHaveAttribute('data-current-page', '1');
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(originalY);
  });
}

test('the last-page link retains focus, ignores further activation, and leaves no duplicate history', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await ready(page);
  const total = await page.locator('[data-blog-article]').count();
  const last = Math.ceil(total / 5);
  await ready(page, `?page=${last - 1}`);
  await next(page).focus();
  await next(page).press('Enter');
  await expect(listing(page)).toHaveAttribute('data-current-page', String(last));
  await expect(next(page)).toBeFocused();
  await expect(next(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(next(page).getByRole('tooltip')).toBeHidden();
  const history = await page.evaluate(() => window.history.length);
  await next(page).press('Enter');
  expect(await page.evaluate(() => window.history.length)).toBe(history);
  await next(page).press('Shift+Tab');
  await expect(previous(page)).toBeFocused();
});

for (const locale of ['zh', 'en']) {
  test(`pagination hints follow the destination and support hover, keyboard and Escape in ${locale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await ready(page, '?page=2', locale);
    const hint = next(page).getByRole('tooltip');
    const target = (value: number) =>
      locale === 'zh' ? `下一页 · 第 ${value} 页` : `Next · Page ${value}`;
    await expect(next(page)).toHaveAccessibleName(locale === 'zh' ? '下一页' : 'Next');
    await expect(next(page).locator('.blog-page-label')).toBeHidden();
    await next(page).hover();
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(target(3));
    await hint.hover();
    await expect(hint).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(hint).toBeHidden();
    await next(page).hover();
    await expect(hint).toBeHidden();
    await page.mouse.move(0, 0);
    await next(page).hover();
    await expect(hint).toBeVisible();
    await next(page).click();
    await expect(listing(page)).toHaveAttribute('data-current-page', '3');
    await expect(hint).toHaveText(target(4));

    await page.mouse.move(0, 0);
    await previous(page).focus();
    await page.keyboard.press('Tab');
    await expect(next(page)).toBeFocused();
    await expect(hint).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(hint).toBeHidden();
    await expect(next(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(hint).toBeVisible();
  });
}

test('hiding the focused dock repairs focus, and leaving the page clears layout ownership', async ({
  page,
}) => {
  await page.goto('/zh/blog/');
  await expect(size(page)).toBeEnabled();
  await size(page).click();
  await page.getByRole('option', { name: '5', exact: true }).click();
  await expect(dock(page)).toBeVisible();
  await next(page).focus();
  await page.evaluate(() => {
    localStorage.setItem('blog-page-size', '50');
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'blog-page-size',
        newValue: '50',
        storageArea: localStorage,
      }),
    );
  });
  await expect(dock(page)).toBeHidden();
  await expect(page.locator('[data-blog-result-count]')).toBeFocused();
  expect(
    await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--blog-pagination-reserve'),
    ),
  ).toBe('');
  await page.locator('[data-blog-article]:not([hidden]) h2 a').first().click();
  await expect(page.locator('[data-article-runtime-ready]')).toBeAttached();
  await expect(dock(page)).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      document.documentElement.style.getPropertyValue('--blog-pagination-reserve'),
    ),
  ).toBe('');
});

test('paging dismisses an unconfirmed page-size choice without applying it', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await ready(page);
  await size(page).click();
  await page.getByRole('option', { name: '50', exact: true }).hover();
  await next(page).click();
  await expect(listing(page)).toHaveAttribute('data-current-page', '2');
  await expect(size(page)).toHaveAttribute('value', '5');
  await expect(page.getByRole('listbox', { name: '每页篇数' })).toBeHidden();
});

test.describe('touch viewport', () => {
  test.use({ viewport: { width: 390, height: 700 }, hasTouch: true });
  test('touch targets stay reachable during visual viewport zoom', async ({
    page,
    browserName,
  }) => {
    await ready(page);
    await expect(next(page).locator('.blog-page-label')).toBeVisible();
    await expect(next(page).getByRole('tooltip')).toBeHidden();
    expect((await next(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await next(page).tap();
    await expect(listing(page)).toHaveAttribute('data-current-page', '2');
    await previous(page).tap();
    await expect(listing(page)).toHaveAttribute('data-current-page', '1');
    if (browserName !== 'chromium') return;
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await expect
      .poll(async () =>
        dock(page).evaluate((element) => {
          const r = element.getBoundingClientRect();
          const v = window.visualViewport!;
          return (
            r.left >= v.offsetLeft &&
            r.right <= v.offsetLeft + v.width + 1 &&
            r.top >= v.offsetTop &&
            r.bottom <= v.offsetTop + v.height
          );
        }),
      )
      .toBe(true);
    await expect(listing(page)).toHaveAttribute('data-current-page', '1');
    await session.detach();
  });
});

test('the bottom circles clear the wallpaper credit even when its text wraps', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 800);
  await ready(page);
  const credit = page.locator('[data-wallpaper-credit]');
  await expect(credit).toBeVisible();
  const expectClearance = async () => {
    await expect
      .poll(async () => {
        const controlBox = (await dock(page).boundingBox())!;
        const creditBox = (await credit.boundingBox())!;
        return creditBox.y - controlBox.y - controlBox.height;
      })
      .toBeGreaterThanOrEqual(15);
  };
  await expectClearance();
  const initialHeight = (await credit.boundingBox())!.height;
  await page.locator('[data-wallpaper-credit-photographer]').evaluate((element) => {
    element.textContent = '摄影师名字'.repeat(20);
  });
  await expect
    .poll(async () => (await credit.boundingBox())!.height)
    .toBeGreaterThan(initialHeight);
  await expectClearance();
  await next(page).click();
  await expect(listing(page)).toHaveAttribute('data-current-page', '2');
  await expectClearance();
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('zooming a desktop viewport keeps the footer link clear of the bottom dock', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Chromium exposes visual viewport zoom through CDP.');
  await page.setViewportSize({ width: 1920, height: 900 });
  await ready(page);
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
  await expect(dock(page)).toHaveAttribute('data-placement', 'bottom');
  await page
    .locator('.site-footer a')
    .evaluate((element) => element.scrollIntoView({ block: 'end', behavior: 'instant' }));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const footer = document.querySelector('.site-footer a')!.getBoundingClientRect();
        const dock = document.querySelector('[data-blog-pagination]')!.getBoundingClientRect();
        return footer.bottom <= dock.top || footer.right <= dock.left || footer.left >= dock.right;
      }),
    )
    .toBe(true);
  await session.detach();
});
