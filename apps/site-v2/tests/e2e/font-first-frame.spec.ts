import { expect, test, type Page } from '@playwright/test';
import { FONT_TIMEOUT_MS } from '../../src/runtime/font-coordinator';

type FontFrame = {
  state: string;
  visible: boolean;
  fallback: boolean;
  firstHeight: number;
  secondTop: number;
};

type SurfaceFrame = {
  state: string;
  visible: boolean;
  fallback: boolean;
  fontFamily: string;
  sampleTop: number;
  sampleHeight: number;
};

const blogPath = '/zh/blog/';
const fontRoute = '**/*.woff2';

async function installFontFrameProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const frames: FontFrame[] = [];
    Object.defineProperty(window, '__fontFrameProbe', {
      configurable: true,
      value: { frames },
    });

    const sample = () => {
      const outlet = document.querySelector<HTMLElement>('[data-font-surface].page-outlet');
      const articles = document.querySelectorAll<HTMLElement>('[data-blog-article]');
      if (outlet && articles.length >= 2) {
        const outletStyle = getComputedStyle(outlet);
        const first = articles[0].getBoundingClientRect();
        const second = articles[1].getBoundingClientRect();
        const round = (value: number) => Math.round(value * 1000) / 1000;
        frames.push({
          state: document.documentElement.dataset.fontState ?? '',
          visible: outletStyle.visibility !== 'hidden' && outletStyle.opacity !== '0',
          fallback: outlet.hasAttribute('data-font-fallback'),
          firstHeight: round(first.height),
          secondTop: round(second.top),
        });
      }
      if (frames.length < 180) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function readFontFrames(page: Page): Promise<FontFrame[]> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __fontFrameProbe?: { frames: FontFrame[] };
        }
      ).__fontFrameProbe?.frames ?? [],
  );
}

async function installSurfaceFrameProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const frames: SurfaceFrame[] = [];
    Object.defineProperty(window, '__surfaceFrameProbe', {
      configurable: true,
      value: { frames },
    });
    const sample = () => {
      const outlet = document.querySelector<HTMLElement>('[data-font-surface].page-outlet');
      const target = document.querySelector<HTMLElement>(
        '[data-article-page] .article-prose p, [data-blog-article], h1, #main-content',
      );
      if (outlet && target) {
        const style = getComputedStyle(outlet);
        const targetStyle = getComputedStyle(target);
        const box = target.getBoundingClientRect();
        frames.push({
          state: document.documentElement.dataset.fontState ?? '',
          visible: style.visibility !== 'hidden' && style.opacity !== '0',
          fallback: outlet.hasAttribute('data-font-fallback'),
          fontFamily: targetStyle.fontFamily,
          sampleTop: Math.round(box.top * 1000) / 1000,
          sampleHeight: Math.round(box.height * 1000) / 1000,
        });
      }
      if (frames.length < 120) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function readSurfaceFrames(page: Page): Promise<SurfaceFrame[]> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __surfaceFrameProbe?: { frames: SurfaceFrame[] };
        }
      ).__surfaceFrameProbe?.frames ?? [],
  );
}

async function waitForVisibleFrames(page: Page, minimum: number): Promise<FontFrame[]> {
  await expect
    .poll(async () => (await readFontFrames(page)).filter((frame) => frame.visible).length)
    .toBeGreaterThanOrEqual(minimum);
  return (await readFontFrames(page)).filter((frame) => frame.visible);
}

async function holdFontRequests(page: Page): Promise<{
  release: () => void;
  urls: string[];
}> {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const urls: string[] = [];
  await page.route(fontRoute, async (route) => {
    urls.push(route.request().url());
    await gate;
    await route.continue();
  });
  return { release, urls };
}

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

test('cold and warm documents never withdraw blog surfaces', async ({ page }) => {
  await installFontFrameProbe(page);
  const heldFonts = await holdFontRequests(page);

  try {
    await page.goto(blogPath, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
    await expect(page.locator('.page-outlet')).toHaveCSS('visibility', 'visible');
    await expect.poll(() => heldFonts.urls.length, { timeout: 1_000 }).toBeGreaterThan(0);
    await expect.poll(async () => (await readFontFrames(page)).length).toBeGreaterThanOrEqual(3);
    expect((await readFontFrames(page)).every((frame) => frame.visible)).toBe(true);

    heldFonts.release();
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    const coldFrames = await waitForVisibleFrames(page, 8);
    expect(coldFrames.every((frame) => !frame.fallback)).toBe(true);
    expectStableGeometry(coldFrames);
    await expect
      .poll(() =>
        page.evaluate(() => document.fonts.check('400 1em "Noto Sans SC Variable"', '文章标签')),
      )
      .toBe(true);

    await page.unrouteAll({ behavior: 'wait' });
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    const warmDocumentFrames = await readFontFrames(page);
    expect(
      warmDocumentFrames.every((frame) => frame.visible && !frame.fallback),
      'a warm refresh must never expose a hidden or fallback typography frame',
    ).toBe(true);
    expectStableGeometry(warmDocumentFrames);
    const warmFrames = await waitForVisibleFrames(page, 8);
    expect(warmFrames.every((frame) => !frame.fallback)).toBe(true);
    expectStableGeometry(warmFrames);
  } finally {
    heldFonts.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('warm refresh never hides typography across representative page families', async ({
  page,
}) => {
  await installSurfaceFrameProbe(page);
  const paths = [
    '/en/',
    '/en/about/',
    '/en/blog/',
    '/en/projects/',
    '/en/search/',
    '/zh/blog/git-identity-management/',
    '/zh/blog/planar-frenet-frame/',
  ];

  for (const path of paths) {
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await expect.poll(async () => (await readSurfaceFrames(page)).length).toBeGreaterThanOrEqual(8);

    const frames = await readSurfaceFrames(page);
    expect(
      frames.every((frame) => frame.visible && !frame.fallback),
      `${path} exposed a hidden or fallback warm-refresh frame:\n${JSON.stringify(frames, null, 2)}`,
    ).toBe(true);
    const first = frames[0];
    expect(
      frames.every(
        (frame) =>
          frame.fontFamily === first.fontFamily &&
          Math.abs(frame.sampleTop - first.sampleTop) < 0.25 &&
          Math.abs(frame.sampleHeight - first.sampleHeight) < 0.25,
      ),
      `${path} changed typography geometry during warm refresh`,
    ).toBe(true);
  }
});

test('client navigation keeps the outgoing document visible while target math fonts prepare', async ({
  page,
}) => {
  await page.goto('/en/tags/frenet/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  const heldFonts = await holdFontRequests(page);

  try {
    await page.evaluate(() => {
      document.querySelector<HTMLAnchorElement>(
        'a[href="/en/blog/planar-frenet-frame/"]',
      )!.dataset.astroPrefetch = 'false';
    });
    const navigation = page.locator('a[href="/en/blog/planar-frenet-frame/"]').first().click();
    await expect.poll(() => heldFonts.urls.length, { timeout: 1_000 }).toBeGreaterThan(0);

    await expect(page.locator('[data-blog-listing]')).toBeVisible();
    await expect(page.locator('.page-outlet')).toHaveCSS('opacity', '1');
    await expect(page.locator('[data-article-page]')).toHaveCount(0);
    expect(heldFonts.urls.some((url) => url.includes('KaTeX_'))).toBe(true);

    heldFonts.release();
    await navigation;
    await expect(page).toHaveURL(/\/en\/blog\/planar-frenet-frame\/$/);
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await expect(page.locator('.katex').first()).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.fonts.check('normal 400 1em "KaTeX_Main"', 'Aa09+=()')),
      )
      .toBe(true);
  } finally {
    heldFonts.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('font timeout commits one fallback geometry and ignores late webfonts', async ({ page }) => {
  await installFontFrameProbe(page);
  const heldFonts = await holdFontRequests(page);

  try {
    await page.goto('/zh/blog/planar-frenet-frame/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
    await expect(page.locator('.page-outlet')).toHaveCSS('visibility', 'visible');
    await expect.poll(() => heldFonts.urls.length, { timeout: 1_000 }).toBeGreaterThan(0);

    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'degraded', {
      timeout: FONT_TIMEOUT_MS + 1_000,
    });
    await expect(page.locator('.page-outlet')).toHaveAttribute('data-font-fallback', '');
    await expect(page.locator('.katex').first()).toHaveCSS('font-family', /Times New Roman/);
    const fallbackGeometry = await page.evaluate(() => {
      const heading = document.querySelector<HTMLElement>('.article-header h1')!;
      const formula = document.querySelector<HTMLElement>('.katex')!;
      const headingBox = heading.getBoundingClientRect();
      const formulaBox = formula.getBoundingClientRect();
      return [headingBox.height, formulaBox.width, formulaBox.height, formulaBox.top];
    });

    heldFonts.release();
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.fonts.check('400 1em "Noto Sans SC Variable"', '文章标签') &&
            document.fonts.check('normal 400 1em "KaTeX_Main"', 'Aa09+=()'),
        ),
      )
      .toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'degraded');
    await expect(page.locator('.page-outlet')).toHaveAttribute('data-font-fallback', '');
    await expect(page.locator('.katex').first()).toHaveCSS('font-family', /Times New Roman/);
    const afterLateFonts = await page.evaluate(() => {
      const heading = document.querySelector<HTMLElement>('.article-header h1')!;
      const formula = document.querySelector<HTMLElement>('.katex')!;
      const headingBox = heading.getBoundingClientRect();
      const formulaBox = formula.getBoundingClientRect();
      return [headingBox.height, formulaBox.width, formulaBox.height, formulaBox.top];
    });
    for (const [index, value] of afterLateFonts.entries()) {
      expect(value, `fallback geometry field ${index}`).toBeCloseTo(fallbackGeometry[index], 1);
    }
  } finally {
    heldFonts.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
