import { expect, test } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

test('Frenet and closed-loop islands reach their existing interactive states', async ({ page }) => {
  await page.goto('/en/blog/frenet-arc-length-conversion/');
  await expect(page.locator('[data-frenet-explorer]')).toHaveCount(10);

  const firstExplorer = page.locator('[data-frenet-explorer="phi"]').first();
  await firstExplorer.scrollIntoViewIfNeeded();
  await expect(firstExplorer.locator('.frenet-main-plot .plot-container')).toBeVisible({
    timeout: 30_000,
  });

  await page.goto('/en/blog/closed-loop-control-timing/');
  await expect(page.locator('.closed-loop-control-timing-plot svg')).toBeVisible({
    timeout: 30_000,
  });
});

test('research controls remain live through unrelated appearance changes', async ({ page }) => {
  await page.goto('/en/blog/frenet-arc-length-conversion/');
  const explorer = page.locator('[data-frenet-explorer="phi"]').first();
  await explorer.scrollIntoViewIfNeeded();
  await expect(explorer.locator('.frenet-main-plot .plot-container')).toBeVisible({
    timeout: 30_000,
  });

  const offsetThumb = explorer.locator(
    '[data-frenet-control="d"] .frenet-slider-thumb[role="slider"]',
  );
  await offsetThumb.focus();
  await offsetThumb.press('ArrowRight');
  await expect(explorer.locator('[data-frenet-status]')).toContainText('d=0.0010');

  const root = page.locator('html');
  const previousTheme = await root.getAttribute('data-theme');
  await page.locator('[data-theme-toggle]').first().click();
  if (previousTheme) await expect(root).not.toHaveAttribute('data-theme', previousTheme);
  await expect(explorer.locator('[data-frenet-status]')).toContainText('d=0.0010');
  await expect(explorer.locator('.plot-container')).toHaveCount(2);

  await page.goto('/en/blog/closed-loop-control-timing/');
  const timingFigure = page.locator('.closed-loop-control-timing');
  await expect(timingFigure.locator('.closed-loop-control-timing-plot svg')).toBeVisible({
    timeout: 30_000,
  });
  const decisionPoint = timingFigure.locator('.decisionPoints path').nth(5);
  await decisionPoint.scrollIntoViewIfNeeded();
  const point = await decisionPoint.boundingBox();
  expect(point).not.toBeNull();
  if (point) {
    const x = point.x + point.width / 2;
    const y = point.y + point.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 45, y, { steps: 4 });
    await page.mouse.up();
  }
  await expect(timingFigure).not.toHaveAttribute('data-decision-time', '50');
});

test('focus mode moves and restores the same live figure instance', async ({ page }) => {
  await page.goto('/en/blog/frenet-arc-length-conversion/');
  const explorer = page.locator('[data-frenet-explorer="phi"]').first();
  await explorer.scrollIntoViewIfNeeded();
  await expect(explorer.locator('.frenet-main-plot .plot-container')).toBeVisible({
    timeout: 30_000,
  });

  const figure = page.locator('[data-figure-focus]').filter({ has: explorer });
  await explorer.evaluate((element) => {
    element.dataset.identityProbe = 'original';
  });
  await figure.locator('[data-figure-focus-toggle]').click();

  const dialog = page.locator('[data-figure-focus-dialog]');
  await expect(dialog).toHaveAttribute('open', '');
  await expect(dialog.locator('[data-identity-probe="original"]')).toHaveCount(1);

  await dialog.locator('[data-figure-focus-toggle]').click();
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(figure.locator('[data-identity-probe="original"]')).toHaveCount(1);
  await expect(figure.locator('[data-figure-focus-toggle]')).toBeFocused();
});

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
