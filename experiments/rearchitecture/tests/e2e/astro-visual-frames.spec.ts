import { expect, test } from '@playwright/test';
import {
  installVisualFrameProbe,
  recordVisualJourney,
  type VisualDomFrame,
} from '../support/visual-frame-recorder';
import { installFontPreparationGate } from '../support/font-preparation-gate';

test('a cold document with slow fonts exposes only a complete first render', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'astro', 'The candidate comparison only records Astro.');

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    localStorage.setItem('poc:theme', 'light');
    localStorage.setItem('poc:wallpaper', 'off');
  });
  await installVisualFrameProbe(page);

  let releaseFonts = () => {};
  let interceptedFonts = 0;
  const fontGate = new Promise<void>((resolve) => {
    releaseFonts = resolve;
  });
  await page.route(/\.woff2(?:\?.*)?$/, async (route) => {
    interceptedFonts += 1;
    await fontGate;
    await route.continue().catch(() => {});
  });

  await page.goto('/zh/blog/', { waitUntil: 'commit' });
  const evidence = await recordVisualJourney(
    page,
    testInfo,
    'cold-document-slow-font',
    async () => {
      await expect.poll(() => interceptedFonts).toBeGreaterThan(0);
      await page.waitForTimeout(420);
      releaseFonts();
      await page.waitForFunction(
        () =>
          document.readyState === 'complete' &&
          document.fonts.status === 'loaded' &&
          document.querySelectorAll('#initial-frame-ready').length === 1,
      );
    },
  );

  const observedFrames = evidence.domFrames.filter((frame) => frame.bodyExists);
  const renderedFrames = observedFrames.filter(isRenderEligibleFrame);
  expect(observedFrames.map((frame) => frame.fontStatus)).toContain('loading');
  expect(observedFrames.some((frame) => frame.initialFrameReadyCount === 0)).toBe(true);
  expect(renderedFrames.length).toBeGreaterThan(3);
  expect(renderedFrames.every((frame) => frame.fontStatus === 'loaded')).toBe(true);
  expect(renderedFrames.filter(isInvalidRenderedFrame)).toEqual([]);
});

test('delayed font preparation keeps one complete old page until the target commit', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'astro', 'The candidate comparison only records Astro.');

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    localStorage.setItem('poc:theme', 'light');
    localStorage.setItem('poc:wallpaper', 'off');
  });
  await installVisualFrameProbe(page);

  await page.goto('/zh/blog/');
  await expect(page.locator('[data-blog-page]')).toBeVisible();
  const fontGate = await installFontPreparationGate(page);

  const evidence = await recordVisualJourney(
    page,
    testInfo,
    'same-generation-slow-font-navigation',
    async () => {
      const navigation = page.locator('[data-article-link="primary"]').click();
      try {
        await expect(page.locator('[data-navigation-progress]')).toHaveAttribute(
          'data-active',
          'true',
        );
        await expect.poll(fontGate.callCount).toBeGreaterThan(0);
        await expect(page.locator('[data-blog-page]')).toBeVisible();
        await expect(page.locator('[data-article-page]')).toHaveCount(0);
        await page.waitForTimeout(420);
      } finally {
        await fontGate.release();
      }

      await navigation;
      await expect(page.locator('[data-article-page]')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
    },
  );

  const renderedFrames = evidence.domFrames.filter(isRenderEligibleFrame);
  expect(renderedFrames.length).toBeGreaterThan(8);
  expect(evidence.presentedFrameCount).toBeGreaterThan(3);
  expect(new Set(renderedFrames.map((frame) => frame.documentId))).toEqual(new Set([0]));
  expect(new Set(renderedFrames.map((frame) => frame.buildId))).toEqual(
    new Set(['astro-generation-1']),
  );
  expect(new Set(renderedFrames.map((frame) => frame.pathname))).toEqual(
    new Set(['/zh/blog/', '/zh/blog/frenet-poc/']),
  );
  expect(renderedFrames.some((frame) => frame.navigationProgressActive)).toBe(true);
  expect(renderedFrames.every((frame) => frame.fontStatus === 'loaded')).toBe(true);

  const violations = renderedFrames.filter(isInvalidRenderedFrame);
  expect(violations, describeFrames(violations)).toEqual([]);

  const shellRects = renderedFrames.flatMap((frame) => (frame.shellRect ? [frame.shellRect] : []));
  expect(maxSpread(shellRects.map((rect) => rect.x))).toBeLessThanOrEqual(0.5);
  expect(maxSpread(shellRects.map((rect) => rect.y))).toBeLessThanOrEqual(0.5);
  expect(maxSpread(shellRects.map((rect) => rect.width))).toBeLessThanOrEqual(0.5);
  expect(maxSpread(shellRects.map((rect) => rect.height))).toBeLessThanOrEqual(0.5);
});

test('a native article refresh presents the saved page and table-of-contents positions immediately', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'astro', 'The candidate comparison only records Astro.');

  await installVisualFrameProbe(page);
  await page.goto('/zh/blog/frenet-poc/?source=refresh-frame');
  await expect(page.locator('[data-article-page]')).toBeVisible();

  const expected = await page.evaluate(() => {
    window.scrollTo(0, 1_120);
    const toc = document.querySelector<HTMLElement>('[data-scroll-region="article-toc"]');
    toc?.scrollTo(0, 420);
    return {
      pageY: Math.round(window.scrollY),
      tocY: Math.round(toc?.scrollTop ?? 0),
    };
  });
  await expect
    .poll(() => page.evaluate(() => history.state?.rearchitecturePoc?.regions?.['article-toc']?.y))
    .toBe(expected.tocY);

  const evidence = await recordVisualJourney(
    page,
    testInfo,
    'native-refresh-restored-scroll',
    async () => {
      await page.reload();
      await expect(page.locator('[data-article-page]')).toBeVisible();
    },
  );

  const refreshedFrames = evidence.domFrames.filter(
    (frame) => frame.documentId === 1 && frame.bodyExists,
  );
  const renderEligibleFrames = refreshedFrames.filter(isRenderEligibleFrame);
  expect(refreshedFrames.length).toBeGreaterThan(3);
  expect(renderEligibleFrames.length).toBeGreaterThan(3);
  expect(
    renderEligibleFrames.every(
      (frame) =>
        Math.round(frame.pageScrollY) === expected.pageY &&
        Math.abs(Math.round(frame.articleTocScrollY ?? -1) - expected.tocY) <= 1 &&
        frame.fontStatus === 'loaded',
    ),
    JSON.stringify(
      refreshedFrames.map((frame) => ({
        documentFrame: frame.documentFrame,
        documentReadyState: frame.documentReadyState,
        fontStatus: frame.fontStatus,
        initialFrameReadyCount: frame.initialFrameReadyCount,
        pageScrollY: frame.pageScrollY,
        tocScrollY: frame.articleTocScrollY,
      })),
      null,
      2,
    ),
  ).toBe(true);
});

function isRenderEligibleFrame(frame: VisualDomFrame) {
  return frame.bodyExists && frame.initialFrameReadyCount === 1;
}

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
    frame.bodyFontFamily?.includes('Manrope Variable') &&
    frame.stylesheetHrefs.some((href) => href.includes('/_astro/'));

  return !(containsOneCompletePage && hasCompleteShell && hasExpectedPreferences && hasSiteStyles);
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
