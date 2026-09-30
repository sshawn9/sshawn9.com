import { expect, test, type Page } from '@playwright/test';
import { Miniflare } from 'miniflare';
import { createStaticAssetsServer } from '../../support/static-assets';
import { installFontFrameProbe, readFontFrames, type FontFrame } from '../font-probe';

type CachedFontEntry = {
  url: string;
  transferSize: number;
  decodedBodySize: number;
};

let server: Miniflare;

test.beforeAll(async () => {
  server = createStaticAssetsServer('cached-font-first-frame');
  await server.ready;
});

test.afterAll(async () => {
  await server?.dispose();
});

function expectValidSequence(frames: FontFrame[], expectedFamily: RegExp): void {
  const documentFrames = frames.filter((frame) => frame.surfacePresent);
  expect(documentFrames.length).toBeGreaterThanOrEqual(8);

  for (const frame of documentFrames) {
    expect(frame.state, JSON.stringify(frame)).toBe('ready');
    expect(frame.visible, JSON.stringify(frame)).toBe(true);
    expect(frame.sampleTop, JSON.stringify(frame)).not.toBeNull();
    expect(frame.sampleHeight, JSON.stringify(frame)).not.toBeNull();
    expect(frame.sampleFontFamily, JSON.stringify(frame)).toMatch(expectedFamily);
    expect(frame.sampleFontReady, JSON.stringify(frame)).toBe(true);
    for (const surface of frame.fontSurfaces) {
      expect(surface.visibility, JSON.stringify(surface)).toBe('visible');
    }
  }

  const first = documentFrames[0]!;
  expect(
    documentFrames.every(
      (frame) =>
        frame.sampleFontFamily === first.sampleFontFamily &&
        Math.abs(frame.sampleTop! - first.sampleTop!) < 0.25 &&
        Math.abs(frame.sampleHeight! - first.sampleHeight!) < 0.25 &&
        (frame.secondTop === null ||
          first.secondTop === null ||
          Math.abs(frame.secondTop - first.secondTop) < 0.25),
    ),
    JSON.stringify(documentFrames),
  ).toBe(true);
}

async function cachedFontEntries(page: Page): Promise<CachedFontEntry[]> {
  return page.evaluate(() =>
    (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter((entry) => /\.woff2$/.test(new URL(entry.name).pathname))
      .map((entry) => ({
        url: entry.name,
        transferSize: entry.transferSize,
        decodedBodySize: entry.decodedBodySize,
      })),
  );
}

test('cached reload uses browser-cached fonts without exposing fallback typography', async ({
  page,
}) => {
  await installFontFrameProbe(page);
  const origin = await server.ready;
  const url = new URL('/zh/blog/', origin).href;

  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  expect(
    (await cachedFontEntries(page)).some(
      (entry) => entry.transferSize > 0 && entry.decodedBodySize > 0,
    ),
  ).toBe(true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  await expect
    .poll(async () => (await readFontFrames(page)).filter((frame) => frame.surfacePresent).length)
    .toBeGreaterThanOrEqual(8);

  const cached = await cachedFontEntries(page);
  expect(cached.length).toBeGreaterThan(0);
  expect(
    cached.every((entry) => entry.transferSize === 0 && entry.decodedBodySize > 0),
    JSON.stringify(cached),
  ).toBe(true);
  expectValidSequence(await readFontFrames(page), /Source Sans 3/);
});

test('a reload that revalidates font files stays visible in ready fonts in every sampled frame', async ({
  page,
}) => {
  await installFontFrameProbe(page);
  // The ordinary Astro preview returns no-cache, as in the original CI failure.
  await page.goto('/zh/blog/', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  await expect
    .poll(async () => (await readFontFrames(page)).filter((frame) => frame.surfacePresent).length)
    .toBeGreaterThanOrEqual(8);
  expectValidSequence(await readFontFrames(page), /Source Sans 3/);
});

test('cached Latin, CJK, code and math pages are visible with stable fonts from their first sampled frame', async ({
  page,
}) => {
  await installFontFrameProbe(page);
  const origin = await server.ready;
  const cases = [
    { path: '/en/', family: /Manrope/ },
    { path: '/zh/blog/', family: /Source Sans 3/ },
    { path: '/en/blog/git-operations-reference/', family: /JetBrains Mono/ },
    { path: '/zh/blog/planar-frenet-frame/', family: /KaTeX_/ },
  ];

  for (const { path, family } of cases) {
    await page.goto(new URL(path, origin).href, { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await expect
      .poll(async () => (await readFontFrames(page)).filter((frame) => frame.surfacePresent).length)
      .toBeGreaterThanOrEqual(8);

    expectValidSequence(await readFontFrames(page), family);
  }
});
