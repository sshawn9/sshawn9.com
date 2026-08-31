import { expect, test } from '@playwright/test';
import {
  installVisualFrameProbe,
  recordVisualJourney,
  type VisualDomFrame,
} from '../support/visual-frame-recorder';

test('a slow deployment boundary presents only complete A or complete B frames', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    localStorage.setItem('poc:theme', 'light');
    localStorage.setItem('poc:wallpaper', 'off');
  });
  await installVisualFrameProbe(page);

  let delayedStylesheets = 0;
  let delayedFonts = 0;
  await page.route(/\/_astro-generation-b\/.*\.css(?:\?.*)?$/, async (route) => {
    delayedStylesheets += 1;
    await new Promise((resolve) => setTimeout(resolve, 460));
    await route.continue();
  });
  await page.route(/\/_astro-generation-b\/.*\.woff2(?:\?.*)?$/, async (route) => {
    delayedFonts += 1;
    await new Promise((resolve) => setTimeout(resolve, 680));
    await route.continue();
  });

  await page.goto('/zh/blog/');
  await expect(page.locator('[data-blog-page]')).toBeVisible();
  await expect(page.locator('meta[name="poc-build-id"]')).toHaveAttribute(
    'content',
    'generation-a',
  );

  const evidence = await recordVisualJourney(
    page,
    testInfo,
    'cross-generation-slow-assets',
    async () => {
      await page.locator('[data-article-link="primary"]').click();
      await expect(page).toHaveURL(/\/zh\/blog\/frenet-poc\//);
      await expect(page.locator('[data-article-page]')).toBeVisible();
      await expect(page.locator('meta[name="poc-build-id"]')).toHaveAttribute(
        'content',
        'generation-b',
      );
      await page.waitForFunction(
        () =>
          document.readyState === 'complete' &&
          document.fonts.status === 'loaded' &&
          document.querySelectorAll('#initial-frame-ready').length === 1,
      );
    },
  );

  expect(delayedStylesheets).toBeGreaterThan(0);
  expect(delayedFonts).toBeGreaterThan(0);
  expect(evidence.presentedFrameCount).toBeGreaterThan(3);

  const renderedFrames = evidence.domFrames.filter(isRenderEligibleFrame);
  expect(renderedFrames.length).toBeGreaterThan(8);
  expect(new Set(renderedFrames.map((frame) => frame.documentId))).toEqual(new Set([0, 1]));
  expect(new Set(renderedFrames.map((frame) => frame.buildId))).toEqual(
    new Set(['generation-a', 'generation-b']),
  );
  expect(renderedFrames.some((frame) => frame.navigationProgressActive)).toBe(true);

  const violations = renderedFrames.filter(isInvalidRenderedFrame);
  expect(violations, describeFrames(violations)).toEqual([]);

  const generationA = renderedFrames.filter((frame) => frame.buildId === 'generation-a');
  const generationB = renderedFrames.filter((frame) => frame.buildId === 'generation-b');
  expect(generationA.every((frame) => frame.blogCount === 1 && frame.articleCount === 0)).toBe(
    true,
  );
  expect(generationB.every((frame) => frame.blogCount === 0 && frame.articleCount === 1)).toBe(
    true,
  );
  expect(generationB.every((frame) => frame.fontStatus === 'loaded')).toBe(true);
  expect(
    generationA.every((frame) =>
      frame.stylesheetHrefs
        .filter((href) => href !== 'inline')
        .every((href) => href.includes('/_astro-generation-a/')),
    ),
  ).toBe(true);
  expect(
    generationB.every((frame) =>
      frame.stylesheetHrefs
        .filter((href) => href !== 'inline')
        .every((href) => href.includes('/_astro-generation-b/')),
    ),
  ).toBe(true);

  const shellRects = renderedFrames.flatMap((frame) => (frame.shellRect ? [frame.shellRect] : []));
  expect(maxSpread(shellRects.map((rect) => rect.x))).toBeLessThanOrEqual(0.5);
  expect(maxSpread(shellRects.map((rect) => rect.y))).toBeLessThanOrEqual(0.5);
  expect(maxSpread(shellRects.map((rect) => rect.width))).toBeLessThanOrEqual(0.5);
  expect(maxSpread(shellRects.map((rect) => rect.height))).toBeLessThanOrEqual(0.5);
});

function isInvalidRenderedFrame(frame: VisualDomFrame) {
  const containsOneCompletePage =
    frame.mainCount === 1 &&
    frame.blogCount + frame.articleCount === 1 &&
    ((frame.blogCount === 1 && frame.blogDisplay === 'grid' && frame.pageKind === 'blog') ||
      (frame.articleCount === 1 &&
        frame.articleDisplay === 'grid' &&
        frame.pageKind === 'article'));
  const hasCompleteShell =
    frame.shellCount === 1 &&
    frame.siteBackgroundCount === 1 &&
    frame.siteBackgroundDisplay === 'block';
  const hasExpectedPreferences =
    frame.rootTheme === 'light' &&
    frame.rootWallpaper === 'off' &&
    frame.siteBackgroundOpacity === 0;
  const hasSiteStyles =
    frame.bodyVisible &&
    frame.bodyOpacity === 1 &&
    frame.bodyBackground === 'rgb(232, 239, 241)' &&
    frame.bodyColor === 'rgb(26, 36, 40)' &&
    frame.bodyFontFamily?.includes('Manrope Variable');

  return !(containsOneCompletePage && hasCompleteShell && hasExpectedPreferences && hasSiteStyles);
}

function isRenderEligibleFrame(frame: VisualDomFrame) {
  return frame.bodyExists && frame.initialFrameReadyCount === 1;
}

function maxSpread(values: number[]) {
  return values.length === 0 ? Number.POSITIVE_INFINITY : Math.max(...values) - Math.min(...values);
}

function describeFrames(frames: VisualDomFrame[]) {
  return JSON.stringify(
    frames.map((frame) => ({
      articleCount: frame.articleCount,
      articleDisplay: frame.articleDisplay,
      blogCount: frame.blogCount,
      blogDisplay: frame.blogDisplay,
      bodyBackground: frame.bodyBackground,
      bodyColor: frame.bodyColor,
      bodyFontFamily: frame.bodyFontFamily,
      bodyVisible: frame.bodyVisible,
      buildId: frame.buildId,
      documentFrame: frame.documentFrame,
      documentId: frame.documentId,
      mainCount: frame.mainCount,
      pageKind: frame.pageKind,
      pathname: frame.pathname,
      rootTheme: frame.rootTheme,
      rootWallpaper: frame.rootWallpaper,
      sequence: frame.sequence,
      shellCount: frame.shellCount,
      siteBackgroundCount: frame.siteBackgroundCount,
      siteBackgroundDisplay: frame.siteBackgroundDisplay,
      siteBackgroundOpacity: frame.siteBackgroundOpacity,
      stylesheetHrefs: frame.stylesheetHrefs,
    })),
    null,
    2,
  );
}
