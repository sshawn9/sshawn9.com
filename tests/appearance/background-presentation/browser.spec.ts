import { expect, test, type Page } from '@playwright/test';
import { routeWallpaperResources, seedTwoSlots } from '../../wallpaper/browser-fixtures';

type BackgroundState = {
  theme: string | undefined;
  mode: string | undefined;
  stageOpacity: number;
  currentOpacity: number;
  backgroundImage: string;
  imageOpacity: number;
  lightScrimOpacity: number;
  darkScrimOpacity: number;
  creditHidden: boolean;
};

async function backgroundState(page: Page): Promise<BackgroundState> {
  return page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('.wallpaper__stage')!;
    const current = document.querySelector<HTMLElement>('[data-wallpaper-current]')!;
    const images = document.querySelector<HTMLElement>('.wallpaper__images')!;
    const scrim = document.querySelector<HTMLElement>('.wallpaper__scrim')!;
    const credit = document.querySelector<HTMLElement>('[data-wallpaper-credit]')!;
    return {
      theme: document.documentElement.dataset.theme,
      mode: document.documentElement.dataset.wallpaperMode,
      stageOpacity: Number(getComputedStyle(stage).opacity),
      currentOpacity: Number(getComputedStyle(current).opacity),
      backgroundImage: getComputedStyle(current).backgroundImage,
      imageOpacity: Number(getComputedStyle(images).opacity),
      lightScrimOpacity: Number(getComputedStyle(scrim, '::before').opacity),
      darkScrimOpacity: Number(getComputedStyle(scrim, '::after').opacity),
      creditHidden: credit.hidden === true,
    };
  });
}

async function settlePresentation(page: Page): Promise<void> {
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition', 'active', {
    timeout: 2_000,
  });
  await expect(page.locator('[data-backdrop-surface]')).not.toHaveAttribute(
    'data-wallpaper-mode-transition',
    'active',
    { timeout: 2_000 },
  );
}

test('the four theme and background combinations project one coherent backdrop state', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  await page.goto('/en/blog/');
  await settlePresentation(page);

  const root = page.locator('html');
  const theme = page.locator('[data-theme-toggle]').first();
  const menu = page.locator('[data-wallpaper-menu-trigger]');
  await menu.click();
  const enabledControl = page.locator('#wallpaper-settings [data-wallpaper-enabled-control]');
  const enabled = enabledControl.locator('[data-wallpaper-enabled]');

  const scenicLight = await backgroundState(page);
  expect(scenicLight).toMatchObject({
    theme: 'light',
    mode: 'scenic',
    stageOpacity: 1,
    currentOpacity: 1,
    lightScrimOpacity: 1,
    darkScrimOpacity: 0,
    creditHidden: false,
  });
  expect(scenicLight.backgroundImage).not.toBe('none');

  await enabledControl.click();
  await expect(enabled).not.toBeChecked();
  await settlePresentation(page);
  expect(await backgroundState(page)).toMatchObject({
    theme: 'light',
    mode: 'default',
    stageOpacity: 0,
    currentOpacity: 1,
    lightScrimOpacity: 1,
    darkScrimOpacity: 0,
    creditHidden: true,
  });

  await theme.click();
  await settlePresentation(page);
  const defaultDark = await backgroundState(page);
  expect(defaultDark).toMatchObject({
    theme: 'dark',
    mode: 'default',
    stageOpacity: 0,
    currentOpacity: 1,
    lightScrimOpacity: 0,
    darkScrimOpacity: 1,
    creditHidden: true,
  });
  expect(defaultDark.imageOpacity).toBeLessThan(scenicLight.imageOpacity);

  await menu.click();
  await enabledControl.click();
  await expect(enabled).toBeChecked();
  await settlePresentation(page);
  expect(await backgroundState(page)).toMatchObject({
    theme: 'dark',
    mode: 'scenic',
    stageOpacity: 1,
    currentOpacity: 1,
    lightScrimOpacity: 0,
    darkScrimOpacity: 1,
    creditHidden: false,
  });
  await expect(root).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
});

test('rapidly reversed theme and mode transitions settle on only the latest choice', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  await page.goto('/en/blog/');
  await page.locator('[data-wallpaper-menu-trigger]').click();
  const enabledControl = page.locator('#wallpaper-settings [data-wallpaper-enabled-control]');
  const enabled = enabledControl.locator('[data-wallpaper-enabled]');
  const theme = page.locator('[data-theme-toggle]').first();

  await enabledControl.click();
  await expect(enabled).not.toBeChecked();
  await enabledControl.click();
  await expect(enabled).toBeChecked();
  await theme.click();
  await theme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'scenic');
  await settlePresentation(page);

  expect(await backgroundState(page)).toMatchObject({
    theme: 'light',
    mode: 'scenic',
    stageOpacity: 1,
    currentOpacity: 1,
    lightScrimOpacity: 1,
    darkScrimOpacity: 0,
    creditHidden: false,
  });
  const layers = await page.locator('.wallpaper__image').evaluateAll((elements) =>
    elements.map((element) => ({
      current: element.hasAttribute('data-wallpaper-current'),
      opacity: Number(getComputedStyle(element).opacity),
      backgroundImage: getComputedStyle(element).backgroundImage,
    })),
  );
  const currentLayers = layers.filter((layer) => layer.current);
  expect(currentLayers).toHaveLength(1);
  expect(currentLayers[0]).toMatchObject({ opacity: 1 });
  expect(currentLayers[0]?.backgroundImage).not.toBe('none');
  expect(layers.filter((layer) => !layer.current).every((layer) => layer.opacity === 0)).toBe(true);
  await expect(page.locator('[data-wallpaper-credit]')).toHaveAttribute(
    'data-wallpaper-photo-id',
    'photo-one',
  );
});
