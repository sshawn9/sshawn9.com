import { expect, test, type Page } from '@playwright/test';

type ScriptProbe = Window & {
  __initialScriptOrder?: { contentReady: boolean; runtimeLoaded: boolean };
  __templateScriptCounts?: { once?: number; rerun?: number; about?: number };
};

async function searchFor(page: Page, query: string): Promise<void> {
  await expect(page.locator('[data-site-search]')).toHaveAttribute('data-search-ready', '');
  await page.locator('[data-search-input]').fill(query);
  await expect(page.locator('[data-search-results]')).toHaveAttribute('data-query', query);
  await expect(page.locator('.site-search-result').first()).toBeVisible();
}

for (const first of ['runtime', 'content'] as const) {
  test(`initial template scripts stay registered when ${first} is ready first and search is revisited`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const probe = { contentReady: false, runtimeLoaded: false };
      (window as ScriptProbe).__initialScriptOrder = probe;
      document.addEventListener('site:initial-document-ready', () => {
        probe.contentReady = true;
      });
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/SiteRuntime\.[^/]+\.js(?:\?|$)/, async (route) => {
      const response = await route.fetch();
      if (first === 'content') await gate;
      await route.fulfill({
        response,
        body: (await response.text()) + '\nwindow.__initialScriptOrder.runtimeLoaded = true;',
      });
    });
    if (first === 'runtime') {
      await page.route(/\.(?:woff2?|ttf)(?:\?|$)/, async (route) => {
        await gate;
        await route.continue();
      });
    }
    try {
      await page.goto('/en/search/', { waitUntil: 'commit' });
      await expect
        .poll(() => page.evaluate(() => (window as ScriptProbe).__initialScriptOrder))
        .toEqual({ contentReady: first === 'content', runtimeLoaded: first === 'runtime' });
    } finally {
      release();
    }
    await searchFor(page, 'website');
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await page.locator('.site-header__desktop a[href="/en/about/"]').click();
    await expect(page.locator('.about-page')).toBeVisible();
    await page.locator('.site-header__desktop a[href="/en/search/"]').click();
    await searchFor(page, 'git');
    await page.goBack();
    await expect(page.locator('.about-page')).toBeVisible();
    await page.goForward();
    await searchFor(page, 'website');
    await page.locator('.site-header__desktop a[href="/en/about/"]').click();
    await expect(page.locator('.about-page')).toBeVisible();
    await page.goBack();
    await searchFor(page, 'git');
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    expect(errors).toEqual([]);
  });
}

test('template registration preserves once-only, rerun and newly encountered scripts', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    (window as ScriptProbe).__templateScriptCounts = {};
  });
  await page.route(/\/en\/(?:search|about)\/$/, async (route) => {
    const response = await route.fetch();
    const scripts = [
      '<script>window.__templateScriptCounts.once = (window.__templateScriptCounts.once || 0) + 1;</script>',
      '<script data-astro-rerun>window.__templateScriptCounts.rerun = (window.__templateScriptCounts.rerun || 0) + 1;</script>',
    ];
    if (new URL(route.request().url()).pathname === '/en/about/') {
      scripts.push(
        '<script>window.__templateScriptCounts.about = (window.__templateScriptCounts.about || 0) + 1;</script>',
      );
    }
    await route.fulfill({
      response,
      body: (await response.text()).replace('</main>', scripts.join('') + '</main>'),
    });
  });
  const counts = () => page.evaluate(() => (window as ScriptProbe).__templateScriptCounts);
  await page.goto('/en/search/');
  await expect(page.locator('[data-search-input]')).toBeVisible();
  await expect.poll(counts).toEqual({ once: 1, rerun: 1 });
  await page.locator('.site-header__desktop a[href="/en/about/"]').click();
  await expect(page.locator('.about-page')).toBeVisible();
  await expect.poll(counts).toEqual({ once: 1, rerun: 2, about: 1 });
  await page.locator('.site-header__desktop a[href="/en/search/"]').click();
  await expect(page.locator('[data-search-input]')).toBeVisible();
  await expect.poll(counts).toEqual({ once: 1, rerun: 3, about: 1 });
  await page.goBack();
  await expect(page.locator('.about-page')).toBeVisible();
  await expect.poll(counts).toEqual({ once: 1, rerun: 4, about: 1 });
  expect(errors).toEqual([]);
});

test('an interactive research page mounts again after leaving its initial document', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/en/blog/closed-loop-control-timing/');
  const plot = page.locator('.closed-loop-control-timing-plot svg');
  await expect(plot).toBeVisible({ timeout: 30_000 });
  const original = await plot.elementHandle();
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  await page.locator('.site-header__desktop a[href="/en/about/"]').click();
  await expect(page.locator('.about-page')).toBeVisible();
  expect(await original!.evaluate((node) => node.isConnected)).toBe(false);
  await page.goBack();
  await expect(plot).toBeVisible({ timeout: 30_000 });
  await expect(plot).toHaveCount(1);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  expect(errors).toEqual([]);
});
