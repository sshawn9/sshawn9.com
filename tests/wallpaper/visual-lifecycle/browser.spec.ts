import { expect, test } from '@playwright/test';
import { photos, routeWallpaperResources, seedTwoSlots } from '../browser-fixtures';

test('parser checkpoints before the initial image and credit cannot finalize a partial surface', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await page.route('**/en/blog/', async (route) => {
    if (!route.request().isNavigationRequest()) return route.continue();
    const response = await route.fetch();
    const html = await response.text();
    const checkpoint =
      '<script>window.__wallpaperParserCheckpoints=(window.__wallpaperParserCheckpoints||0)+1;</script>';
    const images = '<div class="wallpaper__images">';
    expect(html).toContain(images);
    // Executing a parser-inserted script provides a real microtask checkpoint
    // for MutationObserver delivery before the following HTML is parsed.
    const body = html
      .replace(images, images + checkpoint)
      .replace('<div class="wallpaper__scrim">', checkpoint + '<div class="wallpaper__scrim">');
    await route.fulfill({ response, body });
  });
  await page.goto('/en/blog/');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __wallpaperParserCheckpoints: number })
          .__wallpaperParserCheckpoints,
    ),
  ).toBe(2);
  await expect(page.locator('[data-wallpaper-current]')).toHaveCount(1);
  await expect(page.locator('[data-wallpaper-credit-photographer]')).toHaveText(
    'First Photographer',
  );
  await page.locator('[data-wallpaper-menu-trigger]').click();
  await page.locator('#wallpaper-settings [data-wallpaper-next]').click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  await expect(page.locator('.wallpaper__image')).toHaveCount(1);
});

for (const move of ['moveBefore', 'appendChild'] as const) {
  test(`covering fade keeps its live animation across navigation using ${move}`, async ({
    page,
  }) => {
    await routeWallpaperResources(page);
    await seedTwoSlots(page, 1600);
    if (move === 'appendChild')
      await page.addInitScript(() => {
        Object.defineProperty(Element.prototype, 'moveBefore', {
          value: undefined,
          configurable: true,
        });
      });
    await page.goto('/en/blog/');
    await page.locator('[data-wallpaper-menu-trigger]').click();
    await page.locator('#wallpaper-settings [data-wallpaper-next]').click();
    await expect(page.locator('[data-wallpaper-next]').first()).toBeEnabled();
    const result = await page.evaluate(() => {
      const layers = [...document.querySelectorAll<HTMLElement>('.wallpaper__image')];
      const current = layers.at(-1)!;
      const animation = current.getAnimations()[0];
      animation.pause();
      animation.currentTime = 700;
      Object.assign(window, { __wallpaperLiveLayer: current, __wallpaperLiveAnimation: animation });
      return {
        count: layers.length,
        baseOpacity: getComputedStyle(layers[0]).opacity,
        incomingOpacity: Number(getComputedStyle(current).opacity),
        baseAnimations: layers[0].getAnimations().length,
      };
    });
    expect(result.count).toBe(2);
    expect(result.baseOpacity).toBe('1');
    expect(result.baseAnimations).toBe(0);
    expect(result.incomingOpacity).toBeGreaterThan(0);
    expect(result.incomingOpacity).toBeLessThan(1);
    await page.locator('.site-header__nav-link[href="/en/projects/"]').click();
    await expect(page).toHaveURL('/en/projects/');
    const preserved = await page.evaluate(() => {
      const state = window as unknown as {
        __wallpaperLiveLayer: HTMLElement;
        __wallpaperLiveAnimation: Animation;
      };
      const same =
        state.__wallpaperLiveLayer === document.querySelector('[data-wallpaper-current]') &&
        state.__wallpaperLiveLayer.getAnimations().includes(state.__wallpaperLiveAnimation);
      state.__wallpaperLiveAnimation.finish();
      return same;
    });
    expect(preserved).toBe(true);
    await expect(page.locator('.wallpaper__image')).toHaveCount(1);
    await expect(page.locator('[data-wallpaper-current]')).toHaveCSS('opacity', '1');
  });
}

test('enabling reduced motion during a fade immediately settles the committed photo', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600, { autoRotation: true });
  await page.goto('/en/blog/');
  await page.locator('[data-wallpaper-menu-trigger]').click();
  const next = page.locator('#wallpaper-settings [data-wallpaper-next]');
  await next.click();
  await expect(next).toBeEnabled();
  expect(
    await page
      .locator('[data-wallpaper-current]')
      .evaluate((layer) => layer.getAnimations().length),
  ).toBe(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.wallpaper__image')).toHaveCount(1);
  expect(
    await page
      .locator('[data-wallpaper-current]')
      .evaluate((layer) => layer.getAnimations().length),
  ).toBe(0);
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  await expect(next).toBeEnabled();
});

test('rapid advances with full-size images reclaim covered layers and settle to one image', async ({
  page,
}, testInfo) => {
  const candidates = Array.from({ length: 14 }, (_, index) => ({
    ...photos[0],
    id: `stress-${index}`,
    rawUrl: `https://images.unsplash.com/stress-${index}`,
  }));
  await routeWallpaperResources(page, [...photos, ...candidates]);
  await seedTwoSlots(page, 1600);
  const dataUrls = await page.evaluate((count) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 900;
    const ctx = canvas.getContext('2d')!;
    return Array.from({ length: count }, (_, index) => {
      const gradient = ctx.createLinearGradient(0, 0, 1600, 900);
      gradient.addColorStop(0, `hsl(${index * 23} 50% 25%)`);
      gradient.addColorStop(1, `hsl(${index * 23 + 80} 50% 75%)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1600, 900);
      return canvas.toDataURL('image/jpeg', 0.8);
    });
  }, photos.length + candidates.length);
  await page.addInitScript((data) => {
    sessionStorage.setItem('wallpaper-slot-a-data-v3', data[0]);
    sessionStorage.setItem('wallpaper-slot-b-data-v3', data[1]);
  }, dataUrls);
  const imageByPath = new Map(
    [...photos, ...candidates].map((photo, index) => [
      new URL(photo.rawUrl).pathname,
      Buffer.from(dataUrls[index].split(',')[1], 'base64'),
    ]),
  );
  await page.route('https://images.unsplash.com/**', (route) => {
    const body = imageByPath.get(new URL(route.request().url()).pathname);
    if (!body) throw new Error(`Unexpected wallpaper image: ${route.request().url()}`);
    return route.fulfill({
      contentType: 'image/jpeg',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body,
    });
  });
  await page.goto('/en/blog/');
  await page.locator('[data-wallpaper-menu-trigger]').click();
  await page.evaluate(() => {
    const metrics = { maxLayers: 0, intervals: [] as number[], stopped: false };
    Object.assign(window, { __wallpaperStress: metrics });
    let previous = performance.now();
    const sample = (now: number) => {
      if (metrics.stopped) return;
      metrics.intervals.push(now - previous);
      previous = now;
      metrics.maxLayers = Math.max(
        metrics.maxLayers,
        document.querySelectorAll('.wallpaper__image').length,
      );
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const next = page.locator('#wallpaper-settings [data-wallpaper-next]');
  for (let index = 0; index < 12; index++) {
    const previous = await page.locator('html').getAttribute('data-wallpaper-photo-id');
    await next.click();
    await expect(next).toBeEnabled();
    await expect(page.locator('html')).not.toHaveAttribute('data-wallpaper-photo-id', previous!);
  }
  await expect(page.locator('.wallpaper__image')).toHaveCount(1);
  const result = await page.evaluate(() => {
    const metrics = (
      window as unknown as {
        __wallpaperStress: { stopped: boolean; maxLayers: number; intervals: number[] };
      }
    ).__wallpaperStress;
    metrics.stopped = true;
    const values = metrics.intervals.slice(1).sort((a, b) => a - b);
    return {
      advances: 12,
      decodedImageDimensions: '1600x900',
      maxLayers: metrics.maxLayers,
      sampledFrames: values.length,
      frameIntervalP95Ms: values[Math.floor(values.length * 0.95)],
      remainingAnimations: document
        .querySelector('.wallpaper__images')!
        .getAnimations({ subtree: true }).length,
    };
  });
  expect(result.maxLayers).toBeGreaterThanOrEqual(2);
  expect(result.remainingAnimations).toBe(0);
  await testInfo.attach('rapid-advance-metrics', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});
