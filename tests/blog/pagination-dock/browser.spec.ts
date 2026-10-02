import { expect, test, type Page } from '@playwright/test';

const browserEnv = { ...process.env };
delete browserEnv.WAYLAND_DISPLAY;
// Headless Chromium otherwise hides the scrollbar that caused this regression.
test.use({ launchOptions: { env: browserEnv, ignoreDefaultArgs: ['--hide-scrollbars'] } });

const dock = (page: Page) => page.locator('[data-blog-pagination]');
const next = (page: Page) => page.locator('[data-blog-page="next"]');
const previous = (page: Page) => page.locator('[data-blog-page="previous"]');
const listing = (page: Page) => page.locator('[data-blog-listing]');
const size = (page: Page) => page.getByRole('combobox', { name: '每页篇数' });

async function ready(page: Page, query = '', locale = 'zh') {
  await page.goto(`/${locale}/blog/${query}`);
  await expect(listing(page)).toHaveAttribute('data-blog-runtime-ready', '');
  await page.evaluate(() => document.fonts.ready);
  await expect(dock(page)).toHaveAttribute('data-positioned', '');
}

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

test('pagination hints are localized, follow the destination and dismiss without moving focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await ready(page, '?page=1', 'zh');
  await expect(next(page)).toHaveAccessibleName('下一页');
  await expect(next(page).getByRole('tooltip', { includeHidden: true })).toHaveText(
    '下一页 · 第 2 页',
  );

  await ready(page, '?page=1', 'en');
  const hint = next(page).getByRole('tooltip');
  await expect(next(page)).toHaveAccessibleName('Next');
  await next(page).hover();
  await expect(hint).toBeVisible();
  await expect(hint).toHaveText('Next · Page 2');
  await next(page).click();
  await expect(listing(page)).toHaveAttribute('data-current-page', '2');
  await expect(hint).toHaveText('Next · Page 3');

  await page.mouse.move(0, 0);
  await previous(page).focus();
  await page.keyboard.press('Tab');
  await expect(next(page)).toBeFocused();
  await expect(hint).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(hint).toBeHidden();
  await expect(next(page)).toBeFocused();
});

test('hiding the focused dock repairs focus, and leaving the page clears layout ownership', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('blog-compact-page-size', '100'));
  await page.goto('/zh/blog/');
  await expect(size(page)).toBeEnabled();
  await size(page).click();
  await page.getByRole('option', { name: '5', exact: true }).click();
  await expect(dock(page)).toBeVisible();
  await next(page).focus();
  // Programmatic activation preserves the dock's focus while the local mode changes.
  await page.locator('[data-blog-compact-toggle]').evaluate((element) => {
    (element as HTMLButtonElement).click();
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
