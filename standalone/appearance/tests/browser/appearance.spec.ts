import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { captureSequence, snapshot } from './capture';

const pairs = '.appearance-wallpaper-pair';
function namespace(testInfo: TestInfo) {
  return (testInfo.project.name + '-' + testInfo.testId + '-' + Date.now()).replace(
    /[^a-zA-Z0-9_-]/g,
    '',
  );
}
async function state(page: Page) {
  return page.evaluate(() => (window as any).__appearanceDemo.getState());
}
async function waitForScene(page: Page) {
  await expect
    .poll(async () => {
      const result = await state(page);
      return (
        !!result.wallpaper?.currentId &&
        !result.wallpaper.busy &&
        result.font.faceStatus === 'loaded' &&
        result.font.registered
      );
    })
    .toBe(true);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  const frame = await snapshot(page);
  expect(frame.fontLoaded).toBe(true);
  expect(
    frame.pairs.some(
      (pair) =>
        pair.visible &&
        pair.complete &&
        pair.width === 1920 &&
        pair.height === 1080 &&
        pair.id === pair.creditId &&
        pair.credit.includes('CC0'),
    ),
  ).toBe(true);
  return (await state(page)).wallpaper.currentId as string;
}
async function openDemo(page: Page, testInfo: TestInfo, options = '') {
  const name = namespace(testInfo);
  await page.goto('/?namespace=' + name + options);
  await waitForScene(page);
  return name;
}
async function configure(
  page: Page,
  values: { scenario?: string; imageDelay?: number; fontDelay?: number },
) {
  await page.evaluate((patch) => (window as any).__appearanceDemo.actions.configure(patch), values);
}
async function waitForFullCache(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const value = await (window as any).__appearanceDemo.actions.readCache();
        return !!value?.current?.blob?.size && !!value?.next?.blob?.size;
      }),
    )
    .toBe(true);
}
async function waitForEvent(page: Page, type: string) {
  await expect
    .poll(() =>
      page.evaluate(
        (name) => (window as any).__appearanceDemo.events.some((event: any) => event.type === name),
        type,
      ),
    )
    .toBe(true);
}

test('desktop and mobile are real consumers with local decoded images, real fonts, theme controls and download attribution', async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await openDemo(page, testInfo);
  expect(
    requests.some(
      (url) => url.includes('source-sans-3-latin-wght-normal') && url.includes('.woff2'),
    ),
  ).toBe(true);
  expect(requests.some((url) => url.includes('/wallpapers/blue-hour.svg'))).toBe(true);
  expect(
    requests.every(
      (url) => new URL(url).hostname === '127.0.0.1' || url.startsWith('blob:http://127.0.0.1:'),
    ),
  ).toBe(true);
  await page.getByTestId('theme-light').click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance-theme', 'light');
  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByTestId('theme-system').click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance-theme', 'dark');
  await expect(page.getByTestId('theme-system')).toHaveAttribute('aria-pressed', 'true');
  const original = (await state(page)).wallpaper.currentId;
  await page.getByTestId('next-wallpaper').click();
  await expect.poll(async () => (await state(page)).wallpaper.currentId).not.toBe(original);
  await waitForScene(page);
  const active = await state(page);
  const item = await page.evaluate(
    (id) =>
      (window as any).__appearanceDemo.catalogue.find((candidate: any) => candidate.id === id),
    active.wallpaper.currentId,
  );
  const downloaded = page.waitForEvent('download');
  await page.getByTestId('download-wallpaper').click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe(item.filename);
  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  expect(bytes.toString('utf8')).toContain('CC0');
  expect(bytes.toString('utf8')).toContain('Appearance');
  expect((await state(page)).downloadCalls).toBe(1);
  await expect(
    page.locator(pairs + '[data-wallpaper-id="' + item.id + '"] .appearance-wallpaper-credit'),
  ).toContainText('Original Appearance Lab artwork');
  await page.screenshot({ path: testInfo.outputPath('desktop-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('next-wallpaper').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('next-wallpaper')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByTestId('theme-light').click();
  await page.screenshot({ path: testInfo.outputPath('mobile-light.png'), fullPage: true });
  await page.getByTestId('wallpaper-enabled').uncheck();
  await expect.poll(async () => (await state(page)).wallpaper.enabled).toBe(false);
  await page.getByTestId('wallpaper-enabled').check();
  await waitForScene(page);
});

test('duplicate next operations coalesce and retain the old raster/credit until both preparation gates succeed', async ({
  page,
}, testInfo) => {
  await openDemo(page, testInfo);
  await waitForFullCache(page);
  const before = await state(page);
  await configure(page, { imageDelay: 500, fontDelay: 850 });
  const samples = await captureSequence(
    page,
    testInfo,
    'delayed-pair-handover',
    async () => {
      await page.evaluate(async () => {
        const actions = (window as any).__appearanceDemo.actions;
        await Promise.all(Array.from({ length: 6 }, () => actions.next()));
      });
    },
    2200,
  );
  const after = await state(page);
  expect(after.wallpaper.currentId).not.toBe(before.wallpaper.currentId);
  expect(after.commitCount - before.commitCount).toBe(1);
  expect(samples.every((sample) => sample.document?.pairs.some((pair) => pair.visible))).toBe(true);
  expect(samples.every((sample) => sample.pixels && sample.pixels.quantizedColors > 8)).toBe(true);
  const events = await page.evaluate(() => (window as any).__appearanceDemo.events);
  const commit = events.findLast((event: any) => event.type === 'pair-commit');
  const font = events.findLast(
    (event: any) =>
      event.type === 'font-gate-complete' && event.id === commit.id && event.at <= commit.at,
  );
  const image = events.findLast(
    (event: any) =>
      event.type === 'image-decoded' && event.id === commit.id && event.at <= commit.at,
  );
  expect(font).toBeTruthy();
  expect(image).toBeTruthy();
  expect(commit.at).toBeGreaterThanOrEqual(font.at);
  expect(commit.at).toBeGreaterThanOrEqual(image.at);
});

test('download during preparation still belongs to the already committed scene', async ({
  page,
}, testInfo) => {
  await openDemo(page, testInfo);
  await waitForFullCache(page);
  const original = (await state(page)).wallpaper.currentId;
  const item = await page.evaluate(
    (id) =>
      (window as any).__appearanceDemo.catalogue.find((candidate: any) => candidate.id === id),
    original,
  );
  await configure(page, { fontDelay: 1700 });
  await page.evaluate(() => {
    void (window as any).__appearanceDemo.actions.next();
  });
  await expect.poll(async () => (await state(page)).wallpaper.busy).toBe(true);
  const downloading = page.waitForEvent('download');
  await page.getByTestId('download-wallpaper').click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(item.filename);
  const lastDownload = await page.evaluate(() =>
    (window as any).__appearanceDemo.events.findLast((event: any) => event.type === 'download'),
  );
  expect(lastDownload.id).toBe(original);
  expect(lastDownload.detail.credit).toBe(item.credit);
  await waitForScene(page);
});

for (const scenario of ['image-failure', 'decode-failure', 'font-failure'] as const) {
  test(
    scenario + ' preserves the previously displayed image and attribution and then recovers',
    async ({ page }, testInfo) => {
      await openDemo(page, testInfo);
      await waitForFullCache(page);
      const before = await state(page);
      await configure(page, { scenario });
      const samples = await captureSequence(
        page,
        testInfo,
        scenario,
        async () => {
          await page.getByTestId('next-wallpaper').click();
          await expect.poll(async () => (await state(page)).wallpaper.busy).toBe(false);
        },
        1400,
      );
      const after = await state(page);
      expect(after.wallpaper.currentId).toBe(before.wallpaper.currentId);
      expect(after.commitCount).toBe(before.commitCount);
      expect(
        samples.every((sample) =>
          sample.document?.pairs.some(
            (pair) =>
              pair.visible &&
              pair.id === before.wallpaper.currentId &&
              pair.creditId === before.wallpaper.currentId,
          ),
        ),
      ).toBe(true);
      await expect(page.getByTestId('error-state')).not.toBeEmpty();
      await configure(page, { scenario: 'normal' });
      await page.getByTestId('next-wallpaper').click();
      await expect
        .poll(async () => (await state(page)).wallpaper.currentId)
        .not.toBe(before.wallpaper.currentId);
      await waitForScene(page);
    },
  );
}

test('cold font failure never reveals a wallpaper credit or fallback body text', async ({
  page,
}, testInfo) => {
  const name = namespace(testInfo);
  const samples = await captureSequence(
    page,
    testInfo,
    'cold-font-failure',
    () => page.goto('/?namespace=' + name + '&scenario=font-failure'),
    2200,
  );
  const after = await state(page);
  expect(after.font.faceStatus).not.toBe('loaded');
  expect(after.commitCount).toBe(0);
  await expect(page.locator(pairs)).toHaveCount(0);
  await expect(page.getByTestId('app-shell')).not.toBeVisible();
  expect(
    samples.every(
      (sample) =>
        !sample.document?.bodyVisible && !sample.document?.pairs.some((pair) => pair.visible),
    ),
  ).toBe(true);
  await page.waitForTimeout(800);
  expect((await state(page)).commitCount).toBe(0);
});

test('cancel and destroy fence late results; the same instance can initialize again', async ({
  page,
}, testInfo) => {
  await openDemo(page, testInfo);
  await waitForFullCache(page);
  const original = (await state(page)).wallpaper.currentId;
  await configure(page, { imageDelay: 750, fontDelay: 750 });
  await page.evaluate(() => {
    void (window as any).__appearanceDemo.actions.next();
  });
  await expect.poll(async () => (await state(page)).wallpaper.busy).toBe(true);
  await page.getByTestId('cancel').click();
  await page.waitForTimeout(1800);
  expect((await state(page)).wallpaper.currentId).toBe(original);
  expect((await state(page)).wallpaper.autoRotate).toBe(false);
  await expect(page.locator(pairs + '[data-wallpaper-id="' + original + '"]')).toBeVisible();
  await page.evaluate(() => {
    void (window as any).__appearanceDemo.actions.next();
  });
  await expect.poll(async () => (await state(page)).wallpaper.busy).toBe(true);
  await page.getByTestId('destroy').click();
  await expect(page.locator(pairs)).toHaveCount(0);
  await page.waitForTimeout(1800);
  await expect(page.locator(pairs)).toHaveCount(0);
  expect((await state(page)).wallpaper.initialized).toBe(false);
  await expect(page.locator('html')).not.toHaveAttribute('data-appearance-theme');
  await configure(page, { imageDelay: 0, fontDelay: 0 });
  await page.getByTestId('initialize').click();
  await waitForScene(page);
  const reinitialized = await state(page);
  await page.getByTestId('initialize').click();
  expect((await state(page)).wallpaper.currentId).toBe(reinitialized.wallpaper.currentId);
  await page.screenshot({ path: testInfo.outputPath('reinitialized.png'), fullPage: true });
});

test('automatic rotation starts, stops on cancel, and leaves a usable manual controller', async ({
  page,
}, testInfo) => {
  await openDemo(page, testInfo, '&rotationMs=500');
  await waitForFullCache(page);
  const original = (await state(page)).wallpaper.currentId;
  await page.getByTestId('auto-rotate').check();
  await expect.poll(async () => (await state(page)).wallpaper.currentId).not.toBe(original);
  await page.getByTestId('cancel').click();
  const stopped = await state(page);
  await page.waitForTimeout(1400);
  expect((await state(page)).commitCount).toBe(stopped.commitCount);
  expect((await state(page)).wallpaper.autoRotate).toBe(false);
  await page.getByTestId('next-wallpaper').click();
  await expect
    .poll(async () => (await state(page)).wallpaper.currentId)
    .not.toBe(stopped.wallpaper.currentId);
});

test('a complete IndexedDB cache restores without image network, source selection or replay animation', async ({
  page,
}, testInfo) => {
  await openDemo(page, testInfo);
  await waitForFullCache(page);
  const original = (await state(page)).wallpaper.currentId;
  const imageRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/wallpapers/'))
      imageRequests.push(request.url());
  });
  await captureSequence(
    page,
    testInfo,
    'complete-cache-refresh',
    async () => {
      await page.reload();
      await waitForScene(page);
    },
    1800,
  );
  const restored = await state(page);
  expect(restored.wallpaper.currentId).toBe(original);
  expect(restored.sourceCalls).toBe(0);
  expect(restored.imageRequests).toBe(0);
  expect(imageRequests).toEqual([]);
  const commits = await page.evaluate(() =>
    (window as any).__appearanceDemo.events.filter((event: any) => event.type === 'pair-commit'),
  );
  expect(commits.length).toBeGreaterThan(0);
  expect(commits.every((event: any) => event.detail.animate === false)).toBe(true);
});

test('damaged cache blobs recover through a bounded fresh load rather than a permanent busy loop', async ({
  page,
}, testInfo) => {
  await openDemo(page, testInfo);
  await waitForFullCache(page);
  await page.getByTestId('destroy').click();
  await page.getByTestId('corrupt-cache').click();
  await waitForEvent(page, 'cache-corrupted');
  await captureSequence(
    page,
    testInfo,
    'corrupt-cache-refresh',
    async () => {
      await page.reload();
      await waitForScene(page);
    },
    1800,
  );
  const restored = await state(page);
  expect(restored.sourceCalls).toBeGreaterThan(0);
  expect(restored.sourceCalls).toBeLessThan(10);
  expect(restored.imageRequests).toBeLessThan(10);
  expect(restored.wallpaper.busy).toBe(false);
  await page.waitForTimeout(500);
  expect((await state(page)).sourceCalls).toBeLessThan(10);
});

test('ordinary and consecutive refreshes retain every sampled raster in both theme modes', async ({
  page,
}, testInfo) => {
  await openDemo(page, testInfo);
  await waitForFullCache(page);
  for (const preference of ['light', 'dark'] as const) {
    await page.getByTestId('theme-' + preference).click();
    for (let refresh = 0; refresh < 2; refresh++) {
      await captureSequence(
        page,
        testInfo,
        preference + '-refresh-' + refresh,
        async () => {
          await page.reload();
          await waitForScene(page);
        },
        1300,
      );
      await expect(page.locator('html')).toHaveAttribute('data-appearance-theme', preference);
      await expect(page.getByTestId('theme-' + preference)).toHaveAttribute('aria-pressed', 'true');
    }
  }
});

test('theme-only use never starts wallpaper, image traffic or cache maintenance', async ({
  page,
}, testInfo) => {
  const name = namespace(testInfo);
  const imageRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/wallpapers/')) imageRequests.push(request.url());
  });
  await page.goto('/?namespace=' + name + '&mode=theme-only');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await page.getByTestId('theme-dark').click();
  await page.getByTestId('theme-light').click();
  const result = await state(page);
  expect(result.wallpaper).toBeNull();
  expect(result.sourceCalls).toBe(0);
  expect(result.imageRequests).toBe(0);
  expect(imageRequests).toEqual([]);
  await expect(page.locator(pairs)).toHaveCount(0);
  const databases = await page.evaluate(async () =>
    typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map((database) => database.name)
      : null,
  );
  if (databases)
    expect(databases.some((database: string | undefined) => database?.includes(name))).toBe(false);
  else
    testInfo.annotations.push({
      type: 'coverage-limit',
      description:
        'This browser lacks indexedDB.databases(); image traffic and null wallpaper state are still checked, while adapter maintenance independence is covered by package unit tests.',
    });
  await page.screenshot({ path: testInfo.outputPath('theme-only.png'), fullPage: true });
});

test('source rejection and no-items cold starts settle and allow explicit recovery', async ({
  page,
}, testInfo) => {
  for (const scenario of ['source-failure', 'no-items']) {
    await page.goto('/?namespace=' + namespace(testInfo) + '&scenario=' + scenario);
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect.poll(async () => (await state(page)).wallpaper.busy).toBe(false);
    expect((await state(page)).wallpaper.currentId).toBeNull();
    expect((await state(page)).sourceCalls).toBeLessThan(3);
    await page.getByTestId('destroy').click();
    await configure(page, { scenario: 'normal' });
    await page.getByTestId('initialize').click();
    await waitForScene(page);
  }
});

test('reduced-motion mode still commits a fully prepared matching pair', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDemo(page, testInfo);
  const original = (await state(page)).wallpaper.currentId;
  await captureSequence(
    page,
    testInfo,
    'reduced-motion-next',
    async () => {
      await page.getByTestId('next-wallpaper').click();
      await expect.poll(async () => (await state(page)).wallpaper.currentId).not.toBe(original);
      await waitForScene(page);
    },
    900,
  );
  const runningAnimations = await page
    .locator('#wallpaper')
    .evaluate(
      (container) =>
        container
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === 'running').length,
    );
  expect(runningAnimations).toBe(0);
});
