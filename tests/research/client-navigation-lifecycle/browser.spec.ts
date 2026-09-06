import { expect, test } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

test('research figures leave cleanly and initialize one instance on the next client entry', async ({
  page,
}) => {
  let plotlyRuntimeRequests = 0;
  page.on('request', (request) => {
    if (/\/plotly-gl3d\.min\.[^/]+\.js(?:\?|$)/.test(request.url())) {
      plotlyRuntimeRequests += 1;
    }
  });

  await page.goto('/en/tags/frenet/');
  await page.locator('a[href="/en/blog/planar-frenet-frame/"]').first().click();
  await expect(page.locator('[data-plotly-figure] .plot-container')).toHaveCount(2, {
    timeout: 30_000,
  });

  const firstFigure = page.locator('[data-figure-focus]').first();
  await firstFigure.evaluate((element) => {
    element.dataset.lifecycleProbe = 'first-entry';
  });
  await firstFigure.locator('[data-figure-focus-toggle]').click();
  await expect(page.locator('html')).toHaveAttribute('data-figure-focus-open', '');

  await page.evaluate(() => {
    const blogLink = document.querySelector<HTMLAnchorElement>('a[href="/en/blog/"]');
    if (!blogLink) throw new Error('Missing Blog navigation link.');
    blogLink.click();
  });
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect(page.locator('html')).not.toHaveAttribute('data-figure-focus-open', '');
  await expect(page.locator('[data-lifecycle-probe="first-entry"]')).toHaveCount(0);

  await page.locator('a[href="/en/tags/frenet/"]').first().click();
  await expect(page).toHaveURL(/\/en\/blog\/\?tag=frenet$/);
  await page.locator('a[href="/en/blog/planar-frenet-frame/"]').first().click();
  await expect(page.locator('[data-plotly-figure]')).toHaveCount(2);
  await expect(page.locator('[data-plotly-figure] .plot-container')).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect(page.locator('[data-plotly-figure] .plot-container .plot-container')).toHaveCount(0);
  await expect(page.locator('style#plotly\\.js-style-global')).toHaveCount(1);
  expect(plotlyRuntimeRequests).toBe(1);
});
