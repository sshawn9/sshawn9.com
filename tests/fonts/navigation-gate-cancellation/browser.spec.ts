import { expect, test, type Page } from '@playwright/test';
import { holdFontRequests, installFontFrameProbe, readFontFrames } from '../font-probe';

const progressCycleMs = 1_100;

async function expectPendingFramesKeepOutgoingPage(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        (await readFontFrames(page)).filter(
          (frame) => frame.navigationPending && frame.progressPhase === 'active',
        ).length,
    )
    .toBeGreaterThanOrEqual(3);
  const frames = await readFontFrames(page);
  const firstActive = frames.findIndex(
    (frame) => frame.navigationPending && frame.progressPhase === 'active',
  );
  expect(firstActive).toBeGreaterThanOrEqual(0);
  const shownPendingFrames = frames.slice(firstActive);
  for (const frame of shownPendingFrames) {
    expect(frame.navigationPending, JSON.stringify(frame)).toBe(true);
    expect(frame.progressPhase, JSON.stringify(frame)).toBe('active');
    expect(frame.surfacePresent, JSON.stringify(frame)).toBe(true);
    expect(frame.visible, JSON.stringify(frame)).toBe(true);
    expect(frame.progressPresent, JSON.stringify(frame)).toBe(true);
    expect(frame.progressOpacity, JSON.stringify(frame)).toBeGreaterThan(0.99);
    expect(frame.progressAnimationEnabled, JSON.stringify(frame)).toBe(true);
  }
}

test('client navigation keeps the outgoing page and waiting feedback until target fonts are ready', async ({
  page,
}) => {
  await installFontFrameProbe(page);
  await page.goto('/en/tags/frenet/', { waitUntil: 'networkidle' });
  const heldFonts = await holdFontRequests(page, (url) => url.includes('KaTeX_'));

  try {
    await page.evaluate(() => {
      document.querySelector<HTMLAnchorElement>(
        'a[href="/en/blog/planar-frenet-frame/"]',
      )!.dataset.astroPrefetch = 'false';
    });
    const navigation = page.locator('a[href="/en/blog/planar-frenet-frame/"]').first().click();
    await expect.poll(() => heldFonts.urls.length, { timeout: 1_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(progressCycleMs * 2 + 150);

    await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
    await expect(page.locator('[data-blog-listing]')).toBeVisible();
    await expect(page.locator('[data-font-surface].page-outlet')).toHaveCSS('opacity', '1');
    await expect(page.locator('[data-article-page]')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    expect(heldFonts.urls.some((url) => url.includes('KaTeX_'))).toBe(true);
    await expectPendingFramesKeepOutgoingPage(page);

    heldFonts.release();
    await navigation;
    await expect(page).toHaveURL(/\/en\/blog\/planar-frenet-frame\/$/);
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending', '');
    await expect(page.locator('.katex').first()).toBeVisible();
  } finally {
    heldFonts.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('Back cancels a pending font task and restores the ready history entry', async ({ page }) => {
  await page.goto('/en/blog/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/en/tags/frenet/';
    document.body.append(link);
    link.click();
  });
  await expect(page).toHaveURL(/\/en\/tags\/frenet\/$/);
  const heldFonts = await holdFontRequests(page, (url) => url.includes('KaTeX_'));

  try {
    await page.evaluate(() => {
      const link = document.querySelector<HTMLAnchorElement>(
        'a[href="/en/blog/planar-frenet-frame/"]',
      )!;
      link.dataset.astroPrefetch = 'false';
      link.click();
    });
    await expect.poll(() => heldFonts.urls.length).toBeGreaterThan(0);
    await expect(page.locator('.navigation-progress')).toHaveCSS('opacity', '1');

    await page.goBack();
    await expect(page).toHaveURL(/\/en\/blog\/$/);
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending', '');
    await expect(page.locator('[data-blog-listing]')).toBeVisible();
    await expect(page.locator('.navigation-progress')).toHaveCSS('opacity', '0');
  } finally {
    heldFonts.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('a second waiting navigation owns the UI when the first font task completes late', async ({
  page,
}) => {
  await installFontFrameProbe(page);
  await page.goto('/en/about/', { waitUntil: 'networkidle' });
  const firstFonts = await holdFontRequests(page, (url) => url.includes('KaTeX_'));
  const secondFonts = await holdFontRequests(page, (url) => url.includes('noto-sans-sc-'));

  try {
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = '/en/blog/planar-frenet-frame/';
      link.dataset.astroPrefetch = 'false';
      link.dataset.firstWaitingTarget = '';
      link.textContent = 'First waiting target';
      document.body.append(link);
      link.click();
    });
    await expect.poll(() => firstFonts.urls.length, { timeout: 1_000 }).toBeGreaterThan(0);
    await expect(page.locator('html')).toHaveAttribute('data-navigation-progress', 'active');
    await expect(page.locator('.navigation-progress')).toHaveCSS('opacity', '1');
    const takeoverFrame = (await readFontFrames(page)).length;

    await page.evaluate(() => {
      const link = document.querySelector<HTMLAnchorElement>(
        'a[data-locale-switch="zh"][href="/zh/about/"]',
      );
      if (!link) throw new Error('Chinese About locale link was not found');
      link.dataset.astroPrefetch = 'false';
      link.click();
    });
    await expect.poll(() => secondFonts.urls.length, { timeout: 1_000 }).toBeGreaterThan(0);
    await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
    await expect(page).toHaveURL(/\/en\/about\/$/);
    await expect(page.locator('.about-page')).toBeVisible();
    await expect
      .poll(async () => (await readFontFrames(page)).length - takeoverFrame)
      .toBeGreaterThanOrEqual(3);
    const takeoverFrames = (await readFontFrames(page)).slice(takeoverFrame);
    expect(takeoverFrames.length).toBeGreaterThan(0);
    for (const frame of takeoverFrames) {
      expect(frame.navigationPending, JSON.stringify(frame)).toBe(true);
      expect(frame.progressPhase, JSON.stringify(frame)).toBe('active');
      expect(frame.progressOpacity, JSON.stringify(frame)).toBeGreaterThan(0.99);
      expect(frame.progressAnimationEnabled, JSON.stringify(frame)).toBe(true);
    }

    firstFonts.release();
    await expect
      .poll(() => page.evaluate(() => document.fonts.check('italic 400 1em "KaTeX_Math"', 'xyφκ')))
      .toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
    await expect(page.locator('html')).toHaveAttribute('data-navigation-progress', 'active');
    await expect(page.locator('.navigation-progress')).toHaveCSS('opacity', '1');
    await expect(page).toHaveURL(/\/en\/about\/$/);
    await expect(page.locator('.about-page')).toBeVisible();

    secondFonts.release();
    await expect(page).toHaveURL(/\/zh\/about\/$/);
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending', '');
    await expect(page.locator('.about-page')).toBeVisible();
  } finally {
    firstFonts.release();
    secondFonts.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('a late initial-font callback cannot publish state or restore scroll into a newer document', async ({
  page,
}) => {
  await page.addInitScript(() => {
    document.addEventListener(
      'site:runtime-ready',
      () => document.documentElement.setAttribute('data-runtime-ready-probe', ''),
      { once: true },
    );
    history.replaceState(
      {
        ...(typeof history.state === 'object' && history.state !== null ? history.state : {}),
        sshawn9: {
          version: 1,
          routeKey: '/zh/blog/',
          page: { x: 0, y: 700 },
          regions: {},
        },
      },
      '',
    );
  });
  const initialFonts = await holdFontRequests(page, (url) => url.includes('noto-sans-sc-'));

  try {
    await page.goto('/zh/blog/', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => initialFonts.urls.length, { timeout: 1_000 }).toBeGreaterThan(0);
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
    await expect(page.locator('html')).toHaveAttribute('data-runtime-ready-probe', '');

    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = '/en/blog/git-operations-reference/';
      link.dataset.astroPrefetch = 'false';
      link.dataset.initialFontTarget = '';
      link.textContent = 'English target after initial font wait';
      document.body.append(link);
      link.click();
    });
    await expect(page).toHaveURL(/\/en\/blog\/git-operations-reference\/$/);
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await expect(page.locator('[data-article-id="git-operations-reference"]')).toBeVisible();
    const targetScroll = await page.evaluate(() => {
      scrollTo({
        top: Math.min(1_200, document.documentElement.scrollHeight - innerHeight),
        behavior: 'instant',
      });
      return scrollY;
    });
    expect(targetScroll).toBeGreaterThan(0);

    initialFonts.release();
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page).toHaveURL(/\/en\/blog\/git-operations-reference\/$/);
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await expect(page.locator('[data-article-id="git-operations-reference"]')).toBeVisible();
    expect(Math.abs((await page.evaluate(() => scrollY)) - targetScroll)).toBeLessThan(2);
  } finally {
    initialFonts.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
