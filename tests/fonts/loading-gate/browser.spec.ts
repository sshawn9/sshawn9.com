import { expect, test, type Page } from '@playwright/test';
import {
  FONT_ROUTE,
  holdFontRequests,
  installFontFrameProbe,
  readFontFrames,
  type FontFrame,
} from '../font-probe';

const blogPath = '/zh/blog/';
const progressCycleMs = 1_100;
const ordinaryFontSurfaces = ['.skip-link', '.site-header__inner', '.page-outlet'];

function expectWaitingFrame(frame: FontFrame): void {
  expect(frame.state, JSON.stringify(frame)).toBe('loading');
  expect(frame.surfacePresent, JSON.stringify(frame)).toBe(true);
  expect(frame.visible, JSON.stringify(frame)).toBe(false);
  expect(frame.progressPresent, JSON.stringify(frame)).toBe(true);
  expect(frame.progressOpacity, JSON.stringify(frame)).toBeGreaterThan(0.99);
  expect(frame.progressAnimationEnabled, JSON.stringify(frame)).toBe(true);
}

async function expectAllObservedLoadingFramesProtected(page: Page): Promise<FontFrame[]> {
  await expect
    .poll(
      async () => (await readFontFrames(page)).filter((frame) => frame.state === 'loading').length,
    )
    .toBeGreaterThanOrEqual(3);
  const frames = await readFontFrames(page);
  const loadingFrames = frames.filter((frame) => frame.state === 'loading');
  expect(loadingFrames.some((frame) => frame.surfacePresent)).toBe(true);
  for (const frame of loadingFrames) {
    // Header and skip-link may already exist before the main surface is parsed.
    for (const surface of frame.fontSurfaces) {
      expect(surface.guarded, JSON.stringify(surface)).toBe(true);
      expect(surface.visibility, JSON.stringify(surface)).toBe('hidden');
    }
    if (frame.surfacePresent) expectWaitingFrame(frame);
  }
  return frames;
}

function expectStableReadyGeometry(frames: FontFrame[]): void {
  const readyFrames = frames.filter((frame) => frame.state === 'ready');
  expect(readyFrames.length).toBeGreaterThanOrEqual(8);
  const first = readyFrames[0]!;
  expect(first.sampleHeight).not.toBeNull();
  expect(first.secondTop).not.toBeNull();
  expect(
    readyFrames.every(
      (frame) =>
        frame.visible &&
        frame.sampleHeight !== null &&
        frame.secondTop !== null &&
        Math.abs(frame.sampleHeight - first.sampleHeight!) < 0.25 &&
        Math.abs(frame.secondTop - first.secondTop!) < 0.25,
    ),
    JSON.stringify(readyFrames),
  ).toBe(true);
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`a slow cold document keeps protected content and waiting feedback for multiple cycles (${reducedMotion})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await installFontFrameProbe(page);
    const heldFonts = await holdFontRequests(page);

    try {
      await page.goto(blogPath, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => heldFonts.urls.length, { timeout: 1_000 }).toBeGreaterThan(0);
      await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
      await page.waitForTimeout(progressCycleMs * 2 + 150);
      for (const selector of ordinaryFontSurfaces) {
        await expect(page.locator(selector)).toHaveAttribute('data-font-surface', '');
        await expect(page.locator(selector)).toHaveCSS('visibility', 'hidden');
      }
      await expectAllObservedLoadingFramesProtected(page);

      heldFonts.release();
      await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
      for (const selector of ordinaryFontSurfaces) {
        await expect(page.locator(selector)).toHaveCSS('visibility', 'visible');
      }
      await expect
        .poll(() =>
          page.evaluate(() => document.fonts.check('400 1em "Noto Sans SC Variable"', '文章标签')),
        )
        .toBe(true);
      await expect
        .poll(
          async () =>
            (await readFontFrames(page)).filter((frame) => frame.state === 'ready').length,
        )
        .toBeGreaterThanOrEqual(8);
      expectStableReadyGeometry(await readFontFrames(page));
    } finally {
      heldFonts.release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}

test('a first 404 response hides every text surface until its required fonts are ready', async ({
  page,
}) => {
  await installFontFrameProbe(page);
  const heldFonts = await holdFontRequests(page);

  try {
    const response = await page.goto('/zh/missing-font-gate/', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(404);
    await expect.poll(() => heldFonts.urls.length, { timeout: 1_000 }).toBeGreaterThan(0);
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
    await expect(page.locator('main.not-found-page')).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('.site-header [data-font-surface]')).toHaveCSS(
      'visibility',
      'hidden',
    );
    await expect(page.locator('footer[data-font-surface]')).toHaveCSS('visibility', 'hidden');
    await expectAllObservedLoadingFramesProtected(page);

    heldFonts.release();
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await expect(page.locator('main.not-found-page')).toHaveCSS('visibility', 'visible');
    await expect(page.locator('[data-fallback-locale="zh"] h1')).toBeVisible();
  } finally {
    heldFonts.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('font failure never publishes fallback content or false readiness after two progress cycles', async ({
  page,
}) => {
  await installFontFrameProbe(page);
  await page.route(FONT_ROUTE, (route) => route.abort('failed'));

  await page.goto('/zh/blog/planar-frenet-frame/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
  await page.waitForTimeout(progressCycleMs * 2 + 150);
  await expect(page.locator('[data-font-surface].page-outlet')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
  await expect(page.locator('[data-font-fallback]')).toHaveCount(0);
  await expectAllObservedLoadingFramesProtected(page);
});
