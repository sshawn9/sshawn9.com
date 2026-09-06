import { expect, test } from '@playwright/test';
import { photos, routeWallpaperResources, seedTwoSlots } from '../browser-fixtures';

type AdvanceSample = {
  id: string | undefined;
  busy: string | null;
  disabled: boolean;
  opacity: number;
};
type AdvanceProbe = { samples: AdvanceSample[]; original: HTMLElement; originalImage: string };

test('the fade start releases next, and another click can advance during the unfinished fade', async ({
  page,
}) => {
  const third = {
    ...photos[0],
    id: 'photo-three',
    rawUrl: 'https://images.unsplash.com/photo-three',
    photographerName: 'Third Photographer',
  };
  await routeWallpaperResources(page, [...photos, third]);
  await seedTwoSlots(page, 1600);
  // Distinct pixels reveal accidental reuse of a retiring layer's storage slot.
  const thirdImage = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 9;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#207040';
    context.fillRect(0, 0, 16, 9);
    return canvas.toDataURL();
  });
  let releaseNext!: () => void;
  const nextReady = new Promise<void>((resolve) => {
    releaseNext = resolve;
  });
  let refillRequested = false;
  await page.route('https://images.unsplash.com/photo-three?*', async (route) => {
    refillRequested = true;
    await nextReady;
    await route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(thirdImage.split(',')[1], 'base64'),
    });
  });
  await page.goto('/en/blog/');
  await page.locator('[data-wallpaper-menu-trigger]').click();
  const next = page.locator('#wallpaper-settings [data-wallpaper-next]');
  await page.evaluate(() => {
    const original = document.querySelector<HTMLElement>('[data-wallpaper-current]')!;
    const probe: AdvanceProbe = {
      samples: [],
      original,
      originalImage: getComputedStyle(original).backgroundImage,
    };
    Object.assign(window, { __advanceProbe: probe });
    // Hold real transitions after transitionstart, not by fabricating events.
    document.addEventListener(
      'transitionstart',
      (event) => {
        const layer = event.target;
        if (
          !(layer instanceof HTMLElement) ||
          !layer.matches('.wallpaper__image') ||
          event.propertyName !== 'opacity'
        )
          return;
        for (const animation of layer.getAnimations()) {
          if (!(animation instanceof CSSTransition) || animation.transitionProperty !== 'opacity')
            continue;
          animation.pause();
          animation.currentTime = Number(animation.effect!.getTiming().duration) / 3;
        }
        if (!layer.hasAttribute('data-wallpaper-current')) return;
        requestAnimationFrame(() => {
          const button = document.querySelector<HTMLButtonElement>('[data-wallpaper-next]')!;
          probe.samples.push({
            id: document.documentElement.dataset.wallpaperPhotoId,
            busy: button.ariaBusy,
            disabled: button.disabled,
            opacity: Number(getComputedStyle(layer).opacity),
          });
        });
      },
      true,
    );
  });
  const samples = () =>
    page.evaluate(
      () => (window as Window & { __advanceProbe?: AdvanceProbe }).__advanceProbe!.samples,
    );
  try {
    const preparation = await next.evaluate((button: HTMLButtonElement) => {
      button.click();
      return { busy: button.ariaBusy, disabled: button.disabled };
    });
    expect(preparation).toEqual({ busy: 'true', disabled: true });
    await expect.poll(async () => (await samples()).length).toBe(1);
    const [first] = await samples();
    expect(first).toMatchObject({ id: 'photo-two', busy: 'false', disabled: false });
    expect(first.opacity).toBeGreaterThan(0);
    expect(first.opacity).toBeLessThan(1);
    await expect.poll(() => refillRequested).toBe(true);
    await expect(next).toBeEnabled();
    releaseNext();
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(sessionStorage.getItem('wallpaper-slot-a-meta-v3') ?? '{}').photo?.id,
        ),
      )
      .toBe('photo-three');
    const retired = await page.evaluate(() => {
      const { original, originalImage } = (window as Window & { __advanceProbe?: AdvanceProbe })
        .__advanceProbe!;
      return {
        connected: original.isConnected,
        imageUnchanged: getComputedStyle(original).backgroundImage === originalImage,
        ownsSlot: original.hasAttribute('data-wallpaper-slot'),
      };
    });
    expect(retired).toEqual({ connected: true, imageUnchanged: true, ownsSlot: false });
    await next.click();
    await expect.poll(async () => (await samples()).length).toBe(2);
    const second = (await samples())[1];
    expect(second).toMatchObject({ id: 'photo-three', busy: 'false', disabled: false });
    expect(second.opacity).toBeGreaterThan(0);
    expect(second.opacity).toBeLessThan(1);
    // Late callbacks from earlier layers cannot reclaim the current image.
    await page.locator('.wallpaper__images').evaluate((images) => {
      for (const animation of images.getAnimations({ subtree: true })) animation.finish();
    });
    await expect(page.locator('.wallpaper__image')).toHaveCount(1);
    await expect(page.locator('[data-wallpaper-current]')).toHaveCSS('opacity', '1');
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-three');
    await expect(page.locator('[data-wallpaper-credit-photographer]')).toHaveText(
      'Third Photographer',
    );
    await expect(next).toBeEnabled();
    expect(
      await page.evaluate(
        () => JSON.parse(sessionStorage.getItem('wallpaper-tab-state-v3') ?? '{}').currentSlot,
      ),
    ).toBe('a');
  } finally {
    releaseNext();
  }
});

test('missing transition events cannot leave the next control busy indefinitely', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await page.goto('/en/blog/');
  await page.addStyleTag({ content: '.wallpaper__image { transition: none !important; }' });
  await page.locator('[data-wallpaper-menu-trigger]').click();
  const next = page.locator('#wallpaper-settings [data-wallpaper-next]');
  await next.click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  await expect(next).toHaveAttribute('aria-busy', 'false', { timeout: 1000 });
  await expect(next).toBeEnabled();
  await expect(page.locator('.wallpaper__image')).toHaveCount(1, { timeout: 4000 });
});
