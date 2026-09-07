import { expect, test, type Page } from '@playwright/test';
import { routeWallpaperResources, seedTwoSlots } from '../browser-fixtures';

type ActivityProbe = {
  activeRotation: number[];
  activeManifest: number[];
  transitionRuns: number;
  setHidden(hidden: boolean): void;
};

type ActivitySnapshot = Omit<ActivityProbe, 'setHidden'>;

async function readActivityProbe(page: Page): Promise<ActivitySnapshot> {
  return page.evaluate(() => {
    const probe = (window as Window & { __wallpaperActivityProbe?: ActivityProbe })
      .__wallpaperActivityProbe!;
    return {
      activeRotation: [...probe.activeRotation],
      activeManifest: [...probe.activeManifest],
      transitionRuns: probe.transitionRuns,
    };
  });
}

async function installActivityProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let documentHidden = false;
    const probe: ActivityProbe = {
      activeRotation: [],
      activeManifest: [],
      transitionRuns: 0,
      setHidden(hidden) {
        documentHidden = hidden;
        document.dispatchEvent(new Event('visibilitychange'));
      },
    };
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => documentHidden,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (documentHidden ? 'hidden' : 'visible'),
    });
    const browserWindow: Window = window;
    const schedule = browserWindow.setTimeout.bind(browserWindow);
    const cancel = browserWindow.clearTimeout.bind(browserWindow);
    browserWindow.setTimeout = (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      const id = schedule(handler, delay, ...args);
      if (delay !== undefined && delay >= 5 * 60_000 && delay <= 9 * 60_000) {
        probe.activeRotation.push(id);
      }
      if (delay === 30_000 || delay === 30 * 60_000) probe.activeManifest.push(id);
      return id;
    };
    browserWindow.clearTimeout = (id?: number) => {
      probe.activeRotation = probe.activeRotation.filter((active) => active !== id);
      probe.activeManifest = probe.activeManifest.filter((active) => active !== id);
      cancel(id);
    };
    document.addEventListener(
      'transitionrun',
      (event) => {
        if (
          event.target instanceof Element &&
          event.target.matches('.wallpaper__image') &&
          event.propertyName === 'opacity'
        ) {
          probe.transitionRuns += 1;
        }
      },
      true,
    );
    Object.assign(window, { __wallpaperActivityProbe: probe });
  });
}

test('reduced motion disables automatic rotation and makes manual advance immediate', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600, { autoRotation: true });
  await installActivityProbe(page);
  await page.goto('/en/blog/');

  expect((await readActivityProbe(page)).activeRotation).toEqual([]);
  await page.locator('[data-wallpaper-menu-trigger]').click();
  await page.locator('#wallpaper-settings [data-wallpaper-next]').click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  await expect(page.locator('.wallpaper__image')).toHaveCount(1);
  expect((await readActivityProbe(page)).transitionRuns).toBe(0);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect
    .poll(() => readActivityProbe(page).then((probe) => probe.activeRotation.length))
    .toBe(1);
});

test('a hidden document clears activity and resumes with one fresh schedule', async ({ page }) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600, { autoRotation: true });
  await installActivityProbe(page);
  await page.goto('/en/blog/');
  await expect
    .poll(() => readActivityProbe(page).then((probe) => probe.activeRotation.length))
    .toBe(1);
  await expect
    .poll(() => readActivityProbe(page).then((probe) => probe.activeManifest.length))
    .toBe(1);
  const photo = await page.locator('html').getAttribute('data-wallpaper-photo-id');

  await page.evaluate(() => {
    (
      window as Window & { __wallpaperActivityProbe?: ActivityProbe }
    ).__wallpaperActivityProbe?.setHidden(true);
  });
  expect((await readActivityProbe(page)).activeRotation).toEqual([]);
  expect((await readActivityProbe(page)).activeManifest).toEqual([]);
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', photo!);

  await page.evaluate(() => {
    (
      window as Window & { __wallpaperActivityProbe?: ActivityProbe }
    ).__wallpaperActivityProbe?.setHidden(false);
  });
  await expect
    .poll(() => readActivityProbe(page).then((probe) => probe.activeRotation.length))
    .toBe(1);
  await expect
    .poll(() => readActivityProbe(page).then((probe) => probe.activeManifest.length))
    .toBe(1);
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', photo!);
});
