import { expect, test } from '@playwright/test';

for (const resource of ['pagefind.js', 'pagefind-component-ui.js', 'pagefind-entry.json']) {
  test(`${resource} failure restores a usable static route out of search`, async ({ page }) => {
    await page.route(`**/pagefind/${resource}*`, (route) => route.abort());
    await page.goto('/en/search/?q=website');
    await expect(page.locator('[data-site-search]')).toHaveAttribute('data-search-failed', '', {
      timeout: 12_000,
    });
    await expect(page.getByText('Search is temporarily unavailable')).toBeVisible();
    await expect(page.locator('[data-search-interactive]')).toBeHidden();
    await expect(page.locator('[data-search-loading]')).toBeHidden();
    const blog = page
      .locator('[data-search-fallback]')
      .getByRole('link', { name: 'Blog', exact: true });
    await blog.click();
    await expect(page).toHaveURL(/\/en\/blog\/$/);
    await expect(page.locator('[data-blog-article]').first()).toBeVisible();
  });
}

for (const entry of ['cold', 'client'] as const) {
  test(`a stalled component cannot trap ${entry} search entry or revive its failed view`, async ({
    page,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/pagefind/pagefind-component-ui.js', async (route) => {
      await gate;
      await route.continue();
    });
    try {
      if (entry === 'cold') {
        await page.goto('/en/search/?q=website', { waitUntil: 'commit' });
      } else {
        await page.goto('/en/blog/');
        await page.locator('.site-header a[href="/en/search/"]').first().click();
        await expect(page).toHaveURL(/\/en\/search\/$/);
        await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending');
      }
      await expect(page.locator('[data-site-search]')).toHaveAttribute('data-search-failed', '', {
        timeout: 12_000,
      });
      await expect(page.locator('[data-search-fallback]')).toBeVisible();
      await expect(page.locator('[data-search-loading]')).toBeHidden();
      release();
      await page.evaluate(() => customElements.whenDefined('pagefind-input').then(() => undefined));
      // Late custom-element registration must not revive a destroyed search view.
      await expect(page.locator('[data-search-fallback]')).toBeVisible();
      await expect(page.locator('[data-search-interactive]')).toBeHidden();
      await page.goto('/en/search/?q=website');
      await expect(page.locator('[data-search-results]')).toHaveAttribute('data-query', 'website');
    } finally {
      release();
    }
  });
}
