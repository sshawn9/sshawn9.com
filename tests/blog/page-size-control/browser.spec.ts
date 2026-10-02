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

test('the menu opens above its trigger and accepts a choice in a constrained viewport', async ({
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
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(anchor.y);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await option(page, '10').click();
  await expect(trigger(page)).toHaveAttribute('value', '10');
  await expect(menu(page)).toBeHidden();
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

test('navigation removes the old menu and returning creates one usable menu', async ({ page }) => {
  await page.goto('/en/blog/');
  await expect(trigger(page)).toBeEnabled();
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
