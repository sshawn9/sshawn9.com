import { expect, test } from '@playwright/test';
import {
  FONT_ROUTE,
  holdFontRequests,
  installFontFrameProbe,
  readFontFrames,
  type FontFrame,
} from '../font-probe';

const blogPath = '/zh/blog/';

function expectStableGeometry(frames: FontFrame[]): void {
  expect(frames.length).toBeGreaterThan(0);
  const first = frames[0];
  expect(
    frames.every(
      (frame) =>
        Math.abs(frame.firstHeight - first.firstHeight) < 0.25 &&
        Math.abs(frame.secondTop - first.secondTop) < 0.25,
    ),
  ).toBe(true);
}

test('cold documents expose only progress until required fonts are ready', async ({ page }) => {
  await installFontFrameProbe(page);
  const heldFonts = await holdFontRequests(page);

  try {
    await page.goto(blogPath, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
    await expect(page.locator('.page-outlet')).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('.navigation-progress')).toHaveCSS('opacity', '1');
    await expect.poll(() => heldFonts.urls.length, { timeout: 1_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await readFontFrames(page)).length).toBeGreaterThanOrEqual(3);
    expect((await readFontFrames(page)).every((frame) => !frame.visible)).toBe(true);

    heldFonts.release();
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await expect(page.locator('.page-outlet')).toHaveCSS('visibility', 'visible');
    await expect
      .poll(() =>
        page.evaluate(() => document.fonts.check('400 1em "Noto Sans SC Variable"', '文章标签')),
      )
      .toBe(true);
    await expect
      .poll(async () => (await readFontFrames(page)).filter((frame) => frame.visible).length)
      .toBeGreaterThanOrEqual(8);
    expectStableGeometry((await readFontFrames(page)).filter((frame) => frame.visible));
  } finally {
    heldFonts.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('font failure keeps content hidden during the observed timeout', async ({ page }) => {
  await page.route(FONT_ROUTE, (route) => route.abort('failed'));

  await page.goto('/zh/blog/planar-frenet-frame/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
  await expect(page.locator('.page-outlet')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.navigation-progress')).toHaveCSS('opacity', '1');
  await page.waitForTimeout(2_200);
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
  await expect(page.locator('.page-outlet')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('[data-font-fallback]')).toHaveCount(0);
});
