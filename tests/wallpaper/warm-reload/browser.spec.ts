import { expect, test, type Page } from '@playwright/test';
import { routeWallpaperResources, seedTwoSlots } from '../browser-fixtures';

type StablePresentation = {
  photo: string | undefined;
  backgroundImage: string;
  filter: string;
  imageOpacity: string;
  lightScrimOpacity: string;
  darkScrimOpacity: string;
  creditPhoto: string | undefined;
  photographer: string | null;
  creditHidden: boolean;
};

async function stablePresentation(page: Page): Promise<StablePresentation> {
  return page.evaluate(() => {
    const current = document.querySelector<HTMLElement>('[data-wallpaper-current]')!;
    const images = document.querySelector<HTMLElement>('.wallpaper__images')!;
    const scrim = document.querySelector<HTMLElement>('.wallpaper__scrim')!;
    const credit = document.querySelector<HTMLElement>('[data-wallpaper-credit]')!;
    return {
      photo: document.documentElement.dataset.wallpaperPhotoId,
      backgroundImage: getComputedStyle(current).backgroundImage,
      filter: getComputedStyle(current).filter,
      imageOpacity: getComputedStyle(images).opacity,
      lightScrimOpacity: getComputedStyle(scrim, '::before').opacity,
      darkScrimOpacity: getComputedStyle(scrim, '::after').opacity,
      creditPhoto: credit.dataset.wallpaperPhotoId,
      photographer:
        credit.querySelector('[data-wallpaper-credit-photographer]')?.textContent ?? null,
      creditHidden: credit.hidden === true,
    };
  });
}

test('a saved photo and attribution own every warm-refresh first frame without replay', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const imageRequests = await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await page.addInitScript(() => {
    document.addEventListener('transitionrun', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-backdrop-surface]')) return;
      document.documentElement.dataset.wallpaperTransitionRuns = String(
        Number(document.documentElement.dataset.wallpaperTransitionRuns ?? '0') + 1,
      );
    });
    const observer = new PerformanceObserver((entries, self) => {
      if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      self.disconnect();
      const root = document.documentElement;
      const active = document.querySelector<HTMLElement>('.wallpaper__image');
      const credit = document.querySelector<HTMLElement>('[data-wallpaper-credit]');
      const creditVisible =
        credit !== null &&
        credit.hidden === false &&
        getComputedStyle(credit).visibility === 'visible' &&
        (credit.textContent?.includes('First Photographer') ?? false);
      root.dataset.wallpaperFirstPaint = JSON.stringify({
        id: root.dataset.wallpaperPhotoId,
        mode: root.dataset.wallpaperMode,
        image: active ? getComputedStyle(active).backgroundImage !== 'none' : false,
        stage: getComputedStyle(document.querySelector<HTMLElement>('.wallpaper__stage')!).opacity,
        credit: creditVisible,
        creditPhoto: credit?.dataset.wallpaperPhotoId,
      });
      const creditFrames: Array<{ visible: boolean; photo: string | undefined }> = [];
      const sampleCredit = () => {
        const frameCredit = document.querySelector<HTMLElement>('[data-wallpaper-credit]');
        creditFrames.push({
          visible:
            frameCredit !== null &&
            frameCredit.hidden === false &&
            getComputedStyle(frameCredit).visibility === 'visible',
          photo: frameCredit?.dataset.wallpaperPhotoId,
        });
        if (creditFrames.length < 8) {
          requestAnimationFrame(sampleCredit);
        } else {
          root.dataset.wallpaperCreditFrames = JSON.stringify(creditFrames);
        }
      };
      requestAnimationFrame(sampleCredit);
    });
    observer.observe({ type: 'paint', buffered: true });
  });

  await page.goto('/en/blog/');
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  imageRequests.length = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
    await expect(page.locator('html')).toHaveAttribute(
      'data-wallpaper-first-paint',
      JSON.stringify({
        id: 'photo-one',
        mode: 'scenic',
        image: true,
        stage: '1',
        credit: true,
        creditPhoto: 'photo-one',
      }),
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(document.documentElement.dataset.wallpaperCreditFrames ?? '[]'),
        ),
      )
      .toEqual(Array.from({ length: 8 }, () => ({ visible: true, photo: 'photo-one' })));
    expect(
      await page.evaluate(() =>
        Number(document.documentElement.dataset.wallpaperTransitionRuns ?? '0'),
      ),
    ).toBe(0);
  }
  expect(imageRequests).toEqual([]);
});

test('a newly committed photo keeps the same final presentation after reload', async ({ page }) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await page.goto('/en/blog/');
  await page.locator('[data-wallpaper-menu-trigger]').click();
  await page.locator('#wallpaper-settings [data-wallpaper-next]').click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  await expect(page.locator('.wallpaper__image')).toHaveCount(1);
  await expect(page.locator('[data-wallpaper-current]')).toHaveCSS('opacity', '1');
  const beforeReload = await stablePresentation(page);
  expect(beforeReload).toMatchObject({
    photo: 'photo-two',
    creditPhoto: 'photo-two',
    photographer: 'Second Photographer',
    creditHidden: false,
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  expect(await stablePresentation(page)).toEqual(beforeReload);
});
