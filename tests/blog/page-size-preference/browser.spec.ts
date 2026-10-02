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
  await page.locator('[data-blog-page="previous"]').click();
  await expect(listing(page)).toHaveAttribute('data-current-page', '1');
  await choose(page, 5);
  await page.locator('[data-blog-page="next"]').click();
  await expect(listing(page)).toHaveAttribute('data-current-page', '2');
  expect(errors).toEqual([]);
});
