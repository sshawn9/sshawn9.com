import { expect, test, type Page } from '@playwright/test';

const size = (page: Page) => page.getByRole('combobox', { name: /Articles per page|每页篇数/ });
async function choose(page: Page, value: number) {
  await size(page).click();
  await page.getByRole('option', { name: String(value), exact: true }).click();
  await expect(size(page)).toHaveAttribute('value', String(value));
}

const browserEnv = { ...process.env };
delete browserEnv.WAYLAND_DISPLAY;
// Playwright normally disables BFCache. Enable it only for this regression case.
test.use({
  launchOptions: { env: browserEnv, ignoreDefaultArgs: ['--disable-back-forward-cache'] },
});

test('cached documents restore this tab’s current settings while another tab stays independent', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    addEventListener('pageshow', (event) => {
      document.documentElement.dataset.testCacheRestore = String(event.persisted);
    });
  });
  const toggle = (target: Page) => target.getByRole('switch', { name: /Compact|紧凑模式/ });
  await page.goto('/zh/blog/');
  await choose(page, 10);
  await page.evaluate(() => {
    document.documentElement.dataset.testCachedDocument = 'older';
  });
  // Full document navigation preserves the older Document as a BFCache candidate.
  await page.goto('/en/blog/');
  await choose(page, 20);
  await toggle(page).click();
  await choose(page, 50);
  const other = await context.newPage();
  try {
    await other.goto('/en/blog/');
    await expect(toggle(other)).toHaveAttribute('aria-checked', 'true');
    await choose(other, 100);
    await toggle(other).click();
    await choose(other, 5);
    await page.goBack({ waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/zh\/blog\/$/);
    await expect(page.locator('html')).toHaveAttribute('data-test-cached-document', 'older');
    await expect(page.locator('html')).toHaveAttribute('data-test-cache-restore', 'true');
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
    await expect(size(page)).toHaveAttribute('value', '50');
    await expect(toggle(other)).toHaveAttribute('aria-checked', 'false');
    await expect(size(other)).toHaveAttribute('value', '5');
    expect(await page.evaluate(() => localStorage.getItem('blog-display-mode'))).toBe('detailed');
    expect(await page.evaluate(() => localStorage.getItem('blog-page-size'))).toBe('5');
    expect(await page.evaluate(() => localStorage.getItem('blog-compact-page-size'))).toBe('100');
    await toggle(page).click();
    await expect(size(page)).toHaveAttribute('value', '20');
    await choose(page, 10);
    await page.goForward({ waitUntil: 'commit' });
    await expect(page).toHaveURL(/\/en\/blog\/$/);
    // The browser may evict the forward document; either path must keep this tab’s settings.
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
    await expect(size(page)).toHaveAttribute('value', '10');
    await expect(size(other)).toHaveAttribute('value', '5');
  } finally {
    await other.close();
  }
});
