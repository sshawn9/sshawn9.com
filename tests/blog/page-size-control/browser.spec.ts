import { expect, test, type Page } from '@playwright/test';

const trigger = (page: Page) => page.getByRole('combobox', { name: /Articles per page|每页篇数/ });
const menu = (page: Page) => page.getByRole('listbox', { name: /Articles per page|每页篇数/ });
const option = (page: Page, value: string) =>
  page.getByRole('option', { name: value, exact: true });

test('browsing, Escape, Tab and outside focus preserve the committed page size and history', async ({
  page,
}) => {
  await page.goto('/en/blog/?page=3');
  const input = trigger(page);
  await expect(input).toHaveText('5 per page');
  const history = await page.evaluate(() => window.history.length);
  await input.focus();
  await input.press('Enter');
  await expect(menu(page)).toBeVisible();
  await input.press('ArrowDown');
  await expect(option(page, '10')).toHaveAttribute('data-active', '');
  await expect(option(page, '5')).toHaveAttribute('aria-selected', 'true');
  await expect(input).toHaveAttribute('value', '5');
  await input.press('Escape');
  await expect(menu(page)).toBeHidden();
  await expect(input).toBeFocused();

  await input.press('End');
  await expect(option(page, '50')).toHaveAttribute('data-active', '');
  await input.press('Tab');
  await expect(menu(page)).toBeHidden();
  await expect(page.locator('[data-blog-article]:not([hidden]) h2 a').first()).toBeFocused();

  await input.click();
  await option(page, '20').hover();
  await expect(option(page, '20')).toHaveAttribute('data-active', '');
  const article = page.locator('[data-blog-article]:not([hidden]) h2 a').first();
  await article.focus();
  await expect(menu(page)).toBeHidden();
  await expect(article).toBeFocused();

  await input.click();
  await option(page, '50').hover();
  await input.click();
  await expect(menu(page)).toBeHidden();
  await expect(page).toHaveURL(/\?page=3$/);
  expect(await page.evaluate(() => window.history.length)).toBe(history);
  await expect(input).toHaveAttribute('value', '5');
});

test('explicit keyboard confirmation changes size once, while the current value is a no-op', async ({
  page,
}) => {
  await page.goto('/en/blog/?page=3');
  const input = trigger(page);
  await expect(input).toHaveText('5 per page');
  const history = await page.evaluate(() => window.history.length);
  await input.focus();
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(input).toHaveAttribute('value', '10');
  await expect(page).toHaveURL(/\?page=2$/);
  await expect(input).toBeFocused();
  await expect(menu(page)).toBeHidden();
  expect(await page.evaluate(() => window.history.length)).toBe(history);

  await input.press('Space');
  await input.press('Space');
  await expect(menu(page)).toBeHidden();
  expect(await page.evaluate(() => window.history.length)).toBe(history);
  await input.press('5');
  await input.press('0');
  await expect(option(page, '50')).toHaveAttribute('data-active', '');
  await input.press('Escape');
  await expect(input).toHaveAttribute('value', '10');
});

test('opened options remain opaque and readable in both themes, with distinct selection and focus', async ({
  page,
}) => {
  await page.goto('/zh/blog/');
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*\bdark\b)/);
    await trigger(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(option(page, '5')).toHaveAttribute('aria-selected', 'true');
    await option(page, '20').hover();
    await expect(option(page, '20')).toHaveAttribute('aria-selected', 'false');
    const styles = await menu(page).evaluate((element) => {
      const background = getComputedStyle(element).backgroundColor;
      return {
        background,
        rows: [...element.querySelectorAll('[role="option"]')].map((row) => ({
          color: getComputedStyle(row).color,
          opacity: getComputedStyle(row).opacity,
          background: getComputedStyle(row).backgroundColor,
        })),
      };
    });
    const luminance = (color: string) => {
      const [r, g, b] = color
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((channel) => {
          const srgb = channel / 255;
          return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
        });
      return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
    };
    expect(styles.background).toMatch(/^rgb\(/);
    const bg = luminance(styles.background);
    for (const row of styles.rows) {
      const fg = luminance(row.color);
      const rowBackground = row.background === 'rgba(0, 0, 0, 0)' ? bg : luminance(row.background);
      expect(
        (Math.max(rowBackground, fg) + 0.05) / (Math.min(rowBackground, fg) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
      expect(row.opacity).toBe('1');
    }
    await expect(option(page, '5').locator('.blog-page-size-check')).toBeVisible();
    await trigger(page).press('Escape');
    await page.locator('[data-blog-article]:not([hidden]) h2 a').first().focus();
    await page.keyboard.press('Shift+Tab');
    await expect(trigger(page)).toBeFocused();
    await trigger(page).press('Enter');
    expect(await trigger(page).evaluate((element) => element.matches(':focus-visible'))).toBe(true);
    await expect(trigger(page)).toHaveCSS('outline-style', 'solid');
    await trigger(page).press('Escape');
  }
});

test('the control and menu keep a stable width across page sizes and modes', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const locale of ['zh', 'en']) {
      await page.goto(`/${locale}/blog/`);
      await expect(trigger(page)).toBeEnabled();
      const initial = (await trigger(page).boundingBox())!;
      for (const [mode, values] of [
        ['detailed', ['5', '10', '20', '50']],
        ['compact', ['15', '50', '100']],
      ] as const) {
        const toggle = page.locator('[data-blog-compact-toggle]');
        const checked = String(mode === 'compact');
        if ((await toggle.getAttribute('aria-checked')) !== checked) await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', checked);
        for (const value of values) {
          await trigger(page).click();
          await option(page, value).click();
          await expect(trigger(page)).toHaveAttribute('value', value);
          await trigger(page).click();
          await expect(menu(page)).toBeVisible();
          const button = (await trigger(page).boundingBox())!;
          const popup = (await menu(page).boundingBox())!;
          const gap = await trigger(page).evaluate((element) => {
            const text = element
              .querySelector('[data-blog-page-size-value]')!
              .getBoundingClientRect();
            const arrow = element.querySelector('svg')!.getBoundingClientRect();
            return arrow.left - text.right;
          });
          expect(Math.abs(button.width - initial.width)).toBeLessThan(0.5);
          expect(Math.abs(button.x - initial.x)).toBeLessThan(0.5);
          expect(gap).toBeCloseTo(6, 1);
          expect(Math.abs(popup.width - button.width)).toBeLessThan(0.5);
          expect(Math.abs(popup.x - button.x)).toBeLessThan(0.5);
          expect(
            await menu(page).evaluate((element) => element.scrollWidth > element.clientWidth),
          ).toBe(false);
          await trigger(page).press('Escape');
        }
      }
    }
  }
});

test('the menu flips, constrains its height, and cancels on resize or layout zoom', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await page.goto('/en/blog/');
  await page.locator('[data-blog-mobile-toggle]').click();
  await trigger(page).evaluate((element) => {
    const dock = document.querySelector('[data-blog-pagination]')!.getBoundingClientRect();
    window.scrollTo({
      top: element.getBoundingClientRect().bottom + scrollY - dock.top + 12,
      behavior: 'instant',
    });
  });
  await trigger(page).click();
  await expect(menu(page)).toBeVisible();
  const box = (await menu(page).boundingBox())!;
  const anchor = (await trigger(page).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(7);
  expect(box.y + box.height).toBeLessThanOrEqual(anchor.y - 5);
  expect(box.x + box.width).toBeLessThanOrEqual(390 - 7);
  await page.setViewportSize({ width: 320, height: 480 });
  await expect(menu(page)).toBeHidden();
  await trigger(page).click();
  await expect(menu(page)).toBeVisible();
  const resized = (await menu(page).boundingBox())!;
  expect(resized.x).toBeGreaterThanOrEqual(7);
  expect(resized.x + resized.width).toBeLessThanOrEqual(320 - 7);
  // CSS zoom only exercises the dimension-change cancellation. Browser zoom
  // changes the CSS viewport; it is not equivalent to injecting CSS zoom.
  await page.evaluate(() => {
    document.documentElement.style.zoom = '1.5';
  });
  await expect(menu(page)).toBeHidden();
  await expect(trigger(page)).toHaveAttribute('value', '5');
});

test('selection and dismissal still work without the native Popover API', async ({ page }) => {
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
  await trigger(page).click();
  await expect(menu(page)).toBeVisible();
  await option(page, '10').click();
  await expect(trigger(page)).toHaveAttribute('value', '10');
  await trigger(page).click();
  await expect(menu(page)).toBeVisible();
  expect(
    Math.abs((await menu(page).boundingBox())!.width - (await trigger(page).boundingBox())!.width),
  ).toBeLessThan(0.5);
  await page.locator('[data-blog-result-count]').click();
  await expect(menu(page)).toBeHidden();
  await expect(trigger(page)).toHaveAttribute('value', '10');
});

test('a short viewport scrolls the active option inside the menu without moving the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 180 });
  await page.goto('/en/blog/');
  const before = await page.evaluate(() => scrollY);
  // Isolate menu-internal scrolling from the browser revealing a focused
  // trigger above the fixed pagination in this deliberately short viewport.
  await trigger(page).evaluate((element: HTMLElement) => element.focus({ preventScroll: true }));
  await trigger(page).press('Enter');
  await expect(menu(page)).toBeVisible();
  const box = (await menu(page).boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(7);
  expect(box.y + box.height).toBeLessThanOrEqual(173);
  expect(await menu(page).evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  await trigger(page).press('End');
  await expect(option(page, '50')).toHaveAttribute('data-active', '');
  await expect.poll(() => menu(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(before);
  await trigger(page).press('Enter');
  await expect(trigger(page)).toHaveAttribute('value', '50');
});

test('opening and closing repeatedly leaves no stale popup and navigation removes the old menu', async ({
  page,
}) => {
  await page.goto('/en/blog/');
  await expect(trigger(page)).toBeEnabled();
  await trigger(page).evaluate((element) => {
    const button = element as HTMLButtonElement;
    for (let i = 0; i < 4; i += 1) button.click();
  });
  await expect(menu(page)).toBeHidden();
  await trigger(page).click();
  await expect(menu(page)).toBeVisible();
  await page.locator('[data-blog-article]:not([hidden]) h2 a').first().click();
  await expect(page.locator('[data-article-runtime-ready]')).toBeAttached();
  await expect(page.locator('[data-blog-page-size-menu]')).toHaveCount(0);
  await page.goBack();
  await trigger(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(page.locator('[data-blog-page-size-menu]')).toHaveCount(1);
});

test('a cancelled native opening stays closed and can be retried', async ({ page }) => {
  await page.goto('/en/blog/');
  await expect(trigger(page)).toBeEnabled();
  await page.locator('[data-blog-page-size-menu]').evaluate((element) => {
    element.addEventListener('beforetoggle', (event) => event.preventDefault(), { once: true });
  });
  await trigger(page).click();
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(menu(page)).toBeHidden();
  await trigger(page).click();
  await expect(menu(page)).toBeVisible();
  await option(page, '10').click();
  await expect(trigger(page)).toHaveAttribute('value', '10');
});

test.describe('touch selection', () => {
  test.use({ viewport: { width: 390, height: 700 }, hasTouch: true });
  test('whole control and all four rows have touch targets without shifting the article list', async ({
    page,
  }) => {
    await page.goto('/zh/blog/');
    const article = page.locator('[data-blog-article]:not([hidden])').first();
    const before = (await article.boundingBox())!;
    await trigger(page).tap();
    await expect(menu(page)).toBeVisible();
    expect((await article.boundingBox())!.y).toBe(before.y);
    expect((await trigger(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (const value of ['5', '10', '20', '50']) {
      expect((await option(page, value).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await option(page, '20').tap();
    await expect(trigger(page)).toHaveAttribute('value', '20');
    await expect(menu(page)).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
  });
});

for (const width of [1440, 390]) {
  test(`reloading preserves the saved page size and its appearance before the control enables at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/zh/blog/');
    await trigger(page).click();
    await option(page, '10').click();
    await expect(trigger(page)).toHaveAttribute('value', '10');
    await page.mouse.move(0, 0);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = false;
    const documents: string[] = [];
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame())
        documents.push(request.url());
    });
    await page.route(
      /\/_astro\/SiteRuntime\.astro_astro_type_script_.*\.js(?:\?|$)/,
      async (route) => {
        requested = true;
        await gate;
        await route.continue();
      },
    );
    try {
      await page.reload({ waitUntil: 'commit' });
      await expect.poll(() => requested).toBe(true);
      const input = trigger(page);
      await expect(input).toBeVisible();
      await expect(input).toBeDisabled();
      await expect(input).toHaveAttribute('value', '10');
      await expect(input).toHaveText('每页 10 篇');
      // Mobile tag collapse moves the transparent control across the page's
      // backdrop. Isolate that background when comparing the control itself.
      const screenshotOptions = { style: 'html { background-image: none !important; }' };
      const before = await input.screenshot(screenshotOptions);
      release();
      await expect(input).toBeEnabled();
      await expect(input).toHaveAttribute('value', '10');
      await expect(input).toHaveText('每页 10 篇');
      expect((await input.screenshot(screenshotOptions)).equals(before)).toBe(true);
      expect(documents).toHaveLength(1);
      await input.click();
      await expect(option(page, '10')).toHaveAttribute('aria-selected', 'true');
      await option(page, '20').click();
      await expect(input).toHaveAttribute('value', '20');
      await expect(input).toHaveText('每页 20 篇');
    } finally {
      release();
    }
  });
}
