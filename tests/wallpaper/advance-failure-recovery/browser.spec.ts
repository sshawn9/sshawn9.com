import { expect, test, type Page } from '@playwright/test';
import { image, routeWallpaperResources, seedTwoSlots } from '../browser-fixtures';

type DecodeGates = { held: number; completed: number[]; release(index: number): void };

async function holdFirstTwoDecodes(page: Page) {
  await page.addInitScript(() => {
    const originalDecode = Image.prototype.decode;
    const releases: Array<() => void> = [];
    const gates = [0, 1].map(
      (index) =>
        new Promise<void>((resolve) => {
          releases[index] = resolve;
        }),
    );
    const probe: DecodeGates = {
      held: 0,
      completed: [],
      release: (index) => releases[index](),
    };
    Object.assign(window, { __wallpaperCancellationGates: probe });
    Image.prototype.decode = function decode() {
      const decoded = originalDecode.call(this);
      if (probe.held >= gates.length || !this.src.startsWith('data:image/')) return decoded;
      const index = probe.held++;
      return gates[index].then(() => decoded).finally(() => probe.completed.push(index));
    };
  });
}

const readDecodes = (page: Page) =>
  page.evaluate(() => {
    const probe = (window as Window & { __wallpaperCancellationGates?: DecodeGates })
      .__wallpaperCancellationGates!;
    return { held: probe.held, completed: probe.completed };
  });

async function releaseDecode(page: Page, index: number) {
  await page.evaluate((index) => {
    (
      window as Window & { __wallpaperCancellationGates?: DecodeGates }
    ).__wallpaperCancellationGates?.release(index);
  }, index);
}

async function storedSlots(page: Page) {
  return page.evaluate(() => ({
    current: JSON.parse(sessionStorage.getItem('wallpaper-tab-state-v3') ?? '{}').currentSlot,
    a: JSON.parse(sessionStorage.getItem('wallpaper-slot-a-meta-v3') ?? '{}').photo?.id,
    b: JSON.parse(sessionStorage.getItem('wallpaper-slot-b-meta-v3') ?? '{}').photo?.id,
  }));
}

test('a failed candidate request leaves the current photo intact and permits a successful retry', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await page.addInitScript(() => {
    sessionStorage.removeItem('wallpaper-slot-b-meta-v3');
    sessionStorage.removeItem('wallpaper-slot-b-data-v3');
  });
  let failImages = true;
  let failedRequests = 0;
  let releaseFailures: () => void = () => {};
  const failureGate = new Promise<void>((resolve) => {
    releaseFailures = resolve;
  });
  await page.route('https://images.unsplash.com/**', async (route) => {
    if (!failImages) {
      await route.fulfill({ contentType: 'image/png', body: image });
      return;
    }
    failedRequests += 1;
    await failureGate;
    await route.abort('failed');
  });

  await page.goto('/en/blog/');
  await page.locator('[data-wallpaper-menu-trigger]').click();
  const next = page.locator('#wallpaper-settings [data-wallpaper-next]');
  await expect(next).toBeEnabled();
  await expect.poll(() => failedRequests).toBeGreaterThan(0);
  await next.click();
  await expect(next).toHaveAttribute('aria-busy', 'true');
  releaseFailures();
  await expect(next).toHaveAttribute('aria-busy', 'false');
  await expect(next).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
  await expect(page.locator('[data-wallpaper-credit-photographer]')).toHaveText(
    'First Photographer',
  );

  failImages = false;
  await next.click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  await expect(page.locator('[data-wallpaper-credit-photographer]')).toHaveText(
    'Second Photographer',
  );
  await expect(next).toHaveAttribute('aria-busy', 'false');
  await expect(next).toBeEnabled();
});

test('a cancelled decode cannot resume or clear the busy state of a newer Next operation', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await holdFirstTwoDecodes(page);

  await page.goto('/en/blog/');
  await page.locator('[data-wallpaper-menu-trigger]').click();
  const next = page.locator('#wallpaper-settings [data-wallpaper-next]');
  const enabledControl = page.locator('#wallpaper-settings [data-wallpaper-enabled-control]');
  const enabled = enabledControl.locator('[data-wallpaper-enabled]');
  try {
    await next.click();
    await expect.poll(async () => (await readDecodes(page)).held).toBe(1);
    await enabledControl.click();
    await expect(enabled).not.toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'default');
    await enabledControl.click();
    await expect(enabled).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'scenic');
    await expect(next).toHaveAttribute('aria-busy', 'false');
    await expect(next).toBeEnabled();
    expect((await readDecodes(page)).completed).toEqual([]);

    // A new explicit intent must be accepted without waiting for the old decode.
    await next.click();
    await expect.poll(async () => (await readDecodes(page)).held).toBe(2);
    await expect(next).toHaveAttribute('aria-busy', 'true');
    await releaseDecode(page, 0);
    await expect.poll(async () => (await readDecodes(page)).completed).toEqual([0]);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
    expect(await storedSlots(page)).toEqual({ current: 'a', a: 'photo-one', b: 'photo-two' });
    await expect(next).toHaveAttribute('aria-busy', 'true');
    await expect(next).toBeDisabled();

    await releaseDecode(page, 1);
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
    await expect(page.locator('[data-wallpaper-credit-photographer]')).toHaveText(
      'Second Photographer',
    );
    await expect(next).toHaveAttribute('aria-busy', 'false');
    await expect(next).toBeEnabled();
  } finally {
    await releaseDecode(page, 0);
    await releaseDecode(page, 1);
  }
});

test('disabling scenic mode cancels a Next waiting for the independently prepared spare', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await page.addInitScript(() => {
    sessionStorage.removeItem('wallpaper-slot-b-meta-v3');
    sessionStorage.removeItem('wallpaper-slot-b-data-v3');
  });
  let releaseSpare = () => {};
  const spareGate = new Promise<void>((resolve) => {
    releaseSpare = resolve;
  });
  let spareRequests = 0;
  await page.route('https://images.unsplash.com/photo-two?*', async (route) => {
    spareRequests += 1;
    await spareGate;
    await route.fulfill({
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: image,
    });
  });
  try {
    await page.goto('/en/blog/');
    await expect.poll(() => spareRequests).toBe(1);
    await page.locator('[data-wallpaper-menu-trigger]').click();
    const next = page.locator('#wallpaper-settings [data-wallpaper-next]');
    const enabledControl = page.locator('#wallpaper-settings [data-wallpaper-enabled-control]');
    await next.click();
    await expect(next).toHaveAttribute('aria-busy', 'true');
    await enabledControl.click();
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'default');
    await enabledControl.click();
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'scenic');
    await expect(next).toHaveAttribute('aria-busy', 'false');
    await expect(next).toBeEnabled();
    expect((await storedSlots(page)).b).toBeUndefined();

    releaseSpare();
    await expect.poll(async () => (await storedSlots(page)).b).toBe('photo-two');
    // Sample subsequent paints so a resumed stale advance cannot hide behind
    // the brief interval between persisting the spare and committing it.
    const currentPhotos = await page.evaluate(async () => {
      const samples: Array<string | undefined> = [];
      for (let frame = 0; frame < 8; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        samples.push(document.documentElement.dataset.wallpaperPhotoId);
      }
      return samples;
    });
    expect(currentPhotos).toEqual(Array(8).fill('photo-one'));
    expect(await storedSlots(page)).toEqual({ current: 'a', a: 'photo-one', b: 'photo-two' });
    expect(spareRequests).toBe(1);
    await next.click();
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
    await expect(next).toHaveAttribute('aria-busy', 'false');
  } finally {
    releaseSpare();
  }
});

test('off and on during a committed fade preserve the photo and start rotation only after the fade', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600, { autoRotation: true });
  type FadeProbe = {
    held: boolean;
    finished: boolean;
    scheduled: Array<{ id: number; delay: number; afterFade: boolean }>;
    active: number[];
  };
  await page.addInitScript(() => {
    const probe: FadeProbe = { held: false, finished: false, scheduled: [], active: [] };
    Object.assign(window, { __wallpaperCommittedFade: probe });
    const browserWindow: Window = window;
    const schedule = browserWindow.setTimeout.bind(browserWindow);
    const cancel = browserWindow.clearTimeout.bind(browserWindow);
    browserWindow.setTimeout = (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      const id = schedule(handler, delay, ...args);
      if (delay !== undefined && delay >= 300_000 && delay <= 540_000) {
        probe.scheduled.push({ id, delay, afterFade: probe.finished });
        probe.active.push(id);
      }
      return id;
    };
    browserWindow.clearTimeout = (id?: number) => {
      probe.active = probe.active.filter((active) => active !== id);
      cancel(id);
    };
    document.addEventListener(
      'transitionstart',
      (event) => {
        if (
          !(event.target instanceof HTMLElement) ||
          !event.target.matches('[data-wallpaper-current]') ||
          event.propertyName !== 'opacity'
        )
          return;
        for (const animation of event.target.getAnimations()) {
          if (!(animation instanceof CSSTransition) || animation.transitionProperty !== 'opacity')
            continue;
          animation.pause();
          animation.currentTime = Number(animation.effect!.getTiming().duration) / 3;
          probe.held = true;
        }
      },
      true,
    );
    document.addEventListener(
      'transitionend',
      (event) => {
        if (
          event.target instanceof HTMLElement &&
          event.target.matches('[data-wallpaper-current]') &&
          event.propertyName === 'opacity'
        )
          probe.finished = true;
      },
      true,
    );
  });
  const readFade = () =>
    page.evaluate(
      () => (window as Window & { __wallpaperCommittedFade?: FadeProbe }).__wallpaperCommittedFade!,
    );

  await page.goto('/en/blog/');
  await expect.poll(async () => (await readFade()).scheduled.length).toBe(1);
  await page.locator('[data-wallpaper-menu-trigger]').click();
  const next = page.locator('#wallpaper-settings [data-wallpaper-next]');
  const enabledControl = page.locator('#wallpaper-settings [data-wallpaper-enabled-control]');
  await next.click();
  await expect.poll(async () => (await readFade()).held).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  expect((await storedSlots(page)).current).toBe('b');
  await expect(next).toHaveAttribute('aria-busy', 'false');
  await enabledControl.click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'default');
  expect((await storedSlots(page)).current).toBe('b');
  await enabledControl.click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'scenic');
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  const pending = await readFade();
  expect(pending.finished).toBe(false);
  expect(pending.active).toEqual([]);
  expect(pending.scheduled).toHaveLength(1);
  await page.locator('.wallpaper__images').evaluate((images) => {
    for (const animation of images.getAnimations({ subtree: true })) animation.finish();
  });
  await expect.poll(async () => (await readFade()).finished).toBe(true);
  await expect.poll(async () => (await readFade()).scheduled.length).toBe(2);
  const finished = await readFade();
  expect(finished.scheduled[1].afterFade).toBe(true);
  expect(finished.scheduled[1].delay).toBeGreaterThanOrEqual(300_000);
  expect(finished.scheduled[1].delay).toBeLessThanOrEqual(540_000);
  expect(finished.active).toEqual([finished.scheduled[1].id]);
  await expect(page.locator('[data-wallpaper-current]')).toHaveCSS('opacity', '1');
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  expect((await storedSlots(page)).current).toBe('b');
});
