import { expect, test, type Page } from '@playwright/test';

type FontFrame = {
  state: string;
  visible: boolean;
  firstHeight: number;
  secondTop: number;
};

type SurfaceFrame = {
  state: string;
  visible: boolean;
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

async function holdFontRequests(page: Page): Promise<{ release(): void; urls: string[] }> {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const urls: string[] = [];
  await page.route(fontRoute, async (route) => {
    urls.push(route.request().url());
    await gate;
    // A superseding document navigation may already have cancelled the request.
    // Releasing the test gate must not turn that expected cancellation into a
    // test-harness failure.
    await route.continue().catch(() => undefined);
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

test('cached reload starts with final typography and stable geometry', async ({ page }) => {
  await installFontFrameProbe(page);
  await page.goto(blogPath, { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  await expect.poll(async () => (await readFontFrames(page)).length).toBeGreaterThanOrEqual(8);

  const frames = await readFontFrames(page);
  expect(frames.every((frame) => frame.state === 'ready' && frame.visible)).toBe(true);
  expectStableGeometry(frames);
});

test('cached reload stays stable across Latin, CJK, code and math pages', async ({ page }) => {
  await installSurfaceFrameProbe(page);
  const paths = ['/en/', '/zh/blog/', '/zh/blog/planar-frenet-frame/'];

  for (const path of paths) {
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await expect.poll(async () => (await readSurfaceFrames(page)).length).toBeGreaterThanOrEqual(8);

    const frames = await readSurfaceFrames(page);
    const first = frames[0];
    const observedFrames = [
      ...new Map(
        frames.map((frame) => [
          `${frame.state}|${frame.visible}|${frame.fontFamily}|${frame.sampleTop}|${frame.sampleHeight}`,
          frame,
        ]),
      ).values(),
    ];
    expect(
      frames.every(
        (frame) =>
          frame.state === 'ready' &&
          frame.visible &&
          frame.fontFamily === first.fontFamily &&
          Math.abs(frame.sampleTop - first.sampleTop) < 0.25 &&
          Math.abs(frame.sampleHeight - first.sampleHeight) < 0.25,
      ),
      `${path} changed typography after its first visible frame: ${JSON.stringify(observedFrames)}`,
    ).toBe(true);
  }
});

test('client navigation keeps the outgoing page visible until target fonts are ready', async ({
  page,
}) => {
  await page.goto('/en/tags/frenet/', { waitUntil: 'networkidle' });
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
  } finally {
    heldFonts.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('font failure stays in the loading state without exposing fallback text', async ({ page }) => {
  await page.route(fontRoute, (route) => route.abort('failed'));

  await page.goto('/zh/blog/planar-frenet-frame/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
  await expect(page.locator('.page-outlet')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('.navigation-progress')).toHaveCSS('opacity', '1');
  await page.waitForTimeout(2_200);
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
  await expect(page.locator('.page-outlet')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('[data-font-fallback]')).toHaveCount(0);
});

test('superseding navigation aborts an indefinitely waiting font transaction', async ({ page }) => {
  await page.goto('/en/blog/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/en/tags/frenet/';
    document.body.append(link);
    link.click();
  });
  await expect(page).toHaveURL(/\/en\/tags\/frenet\/$/);
  const heldFonts = await holdFontRequests(page);

  try {
    await page.evaluate(() => {
      const link = document.querySelector<HTMLAnchorElement>(
        'a[href="/en/blog/planar-frenet-frame/"]',
      )!;
      link.dataset.astroPrefetch = 'false';
      link.click();
    });
    await expect.poll(() => heldFonts.urls.length, { timeout: 1_000 }).toBeGreaterThan(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/en\/blog\/$/);
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  } finally {
    heldFonts.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
