import { expect, test, type Page } from '@playwright/test';
import { FONT_ROUTE, installFontFrameProbe, readFontFrames } from '../font-probe';

const cases = [
  { path: '/en/', family: /Manrope/, status: 200 },
  { path: '/zh/blog/', family: /Source Sans 3/, status: 200 },
  { path: '/en/blog/git-operations-reference/', family: /JetBrains Mono/, status: 200 },
  { path: '/zh/blog/planar-frenet-frame/', family: /KaTeX_/, status: 200 },
  { path: '/missing-font-continuity/', family: /Manrope/, status: 404 },
];

async function expectReadableFirstFrames(page: Page, family: RegExp): Promise<void> {
  await expect
    .poll(async () => (await readFontFrames(page)).filter((frame) => frame.surfacePresent).length)
    .toBeGreaterThanOrEqual(8);
  const frames = await readFontFrames(page);
  for (const frame of frames) {
    // Include header text that may exist before the main surface is parsed.
    for (const surface of frame.fontSurfaces) {
      expect(surface.visibility, JSON.stringify(surface)).toBe('visible');
    }
    if (!frame.surfacePresent) continue;
    expect(frame.visible, JSON.stringify(frame)).toBe(true);
    expect(frame.state, JSON.stringify(frame)).toBe('ready');
    expect(frame.sampleFontFamily, JSON.stringify(frame)).toMatch(family);
    expect(frame.sampleFontReady, JSON.stringify(frame)).toBe(true);
  }
}

for (const { path, family, status } of cases) {
  test(`a cold document paints ${path} visibly with its correct fonts from the first sampled frame`, async ({
    page,
  }) => {
    await installFontFrameProbe(page);
    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(status);
    await expectReadableFirstFrames(page, family);
    if (status === 404) await expect(page.locator('[data-fallback-locale="en"] h1')).toBeVisible();
  });
}

test('delayed independent fonts keep a cold deep link uncommitted beyond the browser font-display period', async ({
  page,
}) => {
  await installFontFrameProbe(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route(FONT_ROUTE, async (route) => {
    requests++;
    await gate;
    await route.continue().catch(() => undefined);
  });
  try {
    const response = await page.goto('/zh/blog/planar-frenet-frame/', {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status()).toBe(200);
    await expect.poll(() => requests).toBeGreaterThan(0);
    await page.waitForTimeout(6_500);
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
    await expect(page.locator('#initial-frame-ready')).toHaveCount(0);
    await expect(page.locator('main')).toHaveCount(0);
    expect((await readFontFrames(page)).some((frame) => frame.surfacePresent)).toBe(false);
  } finally {
    release();
  }
  await expectReadableFirstFrames(page, /KaTeX_/);
});
