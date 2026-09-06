import { expect, test } from '@playwright/test';
import { image, routeWallpaperResources, seedTwoSlots } from '../browser-fixtures';

type RotationProbe = {
  scheduled: Array<{ id: number; photo: string | undefined; delay: number; afterFade: boolean }>;
  active: number[];
  ended: string[];
  completed: Array<{ photo: string | undefined; timers: number }>;
};

test('fade completion starts a fresh rotation period before spare-image loading completes', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600, { autoRotation: true });
  await page.addInitScript(() => {
    // Reusing an old deadline now yields less than five minutes and must fail.
    Math.random = () => 0;
    const probe: RotationProbe = { scheduled: [], active: [], ended: [], completed: [] };
    Object.assign(window, { __rotationProbe: probe });
    const browserWindow: Window = window;
    const schedule = browserWindow.setTimeout.bind(browserWindow);
    const cancel = browserWindow.clearTimeout.bind(browserWindow);
    browserWindow.setTimeout = (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      const id = schedule(handler, delay, ...args);
      if (delay !== undefined && delay >= 5 * 60_000 && delay <= 9 * 60_000) {
        probe.scheduled.push({
          id,
          photo: document.documentElement.dataset.wallpaperPhotoId,
          delay,
          afterFade: probe.ended.includes(document.documentElement.dataset.wallpaperPhotoId ?? ''),
        });
        probe.active.push(id);
      }
      return id;
    };
    browserWindow.clearTimeout = (id?: number) => {
      probe.active = probe.active.filter((active) => active !== id);
      cancel(id);
    };
    document.addEventListener(
      'transitionend',
      (event) => {
        if (
          !(event.target instanceof HTMLElement) ||
          !event.target.matches('[data-wallpaper-current]') ||
          event.propertyName !== 'opacity'
        )
          return;
        probe.ended.push(document.documentElement.dataset.wallpaperPhotoId ?? '');
        requestAnimationFrame(() =>
          probe.completed.push({
            photo: document.documentElement.dataset.wallpaperPhotoId,
            timers: probe.scheduled.length,
          }),
        );
      },
      true,
    );
  });
  let releaseSpare!: () => void;
  const spareGate = new Promise<void>((resolve) => {
    releaseSpare = resolve;
  });
  let spareRequested = false;
  await page.route('https://images.unsplash.com/photo-one?*', async (route) => {
    spareRequested = true;
    await spareGate;
    await route.fulfill({ contentType: 'image/png', body: image });
  });
  const readProbe = () =>
    page.evaluate(() => (window as Window & { __rotationProbe?: RotationProbe }).__rotationProbe!);
  try {
    await page.goto('/en/blog/');
    await expect.poll(async () => (await readProbe()).scheduled.length).toBe(1);
    const initial = (await readProbe()).scheduled[0];
    expect(initial).toMatchObject({ photo: 'photo-one', delay: 300_000, afterFade: false });
    await page.locator('[data-wallpaper-menu-trigger]').click();
    await page.locator('#wallpaper-settings [data-wallpaper-next]').click();
    await expect.poll(() => spareRequested).toBe(true);
    await expect
      .poll(async () => (await readProbe()).completed)
      .toEqual([{ photo: 'photo-two', timers: 2 }]);
    const completed = await readProbe();
    expect(completed.scheduled).toHaveLength(2);
    expect(completed.scheduled[1]).toMatchObject({
      photo: 'photo-two',
      delay: 300_000,
      afterFade: true,
    });
    expect(completed.active).toEqual([completed.scheduled[1].id]);
    expect(completed.active).not.toContain(initial.id);
    expect(
      await page.evaluate(() => sessionStorage.getItem('wallpaper-slot-a-meta-v3')),
    ).toBeNull();
    releaseSpare();
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(sessionStorage.getItem('wallpaper-slot-a-meta-v3') ?? '{}').photo?.id,
        ),
      )
      .toBe('photo-one');
    await page.evaluate(async () => {
      window.dispatchEvent(new Event('online'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const afterRefill = await readProbe();
    expect(afterRefill.scheduled).toEqual(completed.scheduled);
    expect(afterRefill.active).toEqual(completed.active);
  } finally {
    releaseSpare();
  }
});
