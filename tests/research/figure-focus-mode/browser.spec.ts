import { expect, test, type Locator, type Page } from '@playwright/test';
import { cameraOf } from '../plotly-camera';

test.describe.configure({ timeout: 60_000 });

async function viewportGeometry(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.site-header__inner');
    const box = header?.getBoundingClientRect();
    return { left: box?.left ?? -1, width: box?.width ?? -1, scrollY };
  });
}

async function splitRatio(explorer: Locator): Promise<number> {
  return explorer.evaluate((element) => {
    const main = element.querySelector<HTMLElement>('.frenet-main-panel');
    const geometry = element.querySelector<HTMLElement>('.frenet-geometry-panel');
    if (!main || !geometry) throw new Error('Missing Frenet split panels.');
    const mainWidth = main.getBoundingClientRect().width;
    const geometryWidth = geometry.getBoundingClientRect().width;
    return mainWidth / (mainWidth + geometryWidth);
  });
}

test('focus mode moves one live figure and keeps its latest parameter state', async ({ page }) => {
  await page.goto('/en/blog/frenet-arc-length-conversion/');
  const explorer = page.locator('[data-frenet-explorer="phi"]').first();
  await explorer.scrollIntoViewIfNeeded();
  await expect(explorer.locator('.frenet-main-plot .plot-container')).toBeVisible({
    timeout: 30_000,
  });

  const figure = explorer.locator('xpath=ancestor::figure[@data-figure-focus][1]');
  await explorer.evaluate((element) => {
    element.dataset.identityProbe = 'original';
  });
  const parameter = explorer.locator(
    '[data-frenet-control="d"] .frenet-slider-thumb[role="slider"]',
  );
  await parameter.focus();
  await parameter.press('ArrowRight');
  await expect(explorer.locator('[data-frenet-status]')).toContainText('d=0.0010');

  const toggle = figure.locator('[data-figure-focus-toggle]');
  await expect(toggle).toHaveAccessibleName('Expand figure 1');
  await toggle.click();

  const dialog = page.locator('[data-figure-focus-dialog]');
  await expect(dialog).toHaveAttribute('open', '');
  expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(true);
  await expect(toggle).toHaveAccessibleName('Collapse figure 1');
  await expect(dialog.locator('[data-identity-probe="original"]')).toHaveCount(1);
  await parameter.focus();
  await parameter.press('ArrowRight');
  await expect(explorer.locator('[data-frenet-status]')).toContainText('d=0.0020');

  await toggle.click();
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(figure.locator('[data-identity-probe="original"]')).toHaveCount(1);
  await expect(explorer.locator('[data-frenet-status]')).toContainText('d=0.0020');
  await expect(toggle).toHaveAccessibleName('Expand figure 1');
  await expect(toggle).toBeFocused();
});

test('opening figure focus mode preserves shell geometry and page scroll', async ({ page }) => {
  await page.goto('/en/blog/frenet-arc-length-conversion/');
  const toggle = page.locator('[data-figure-focus-toggle]').first();
  await toggle.scrollIntoViewIfNeeded();
  const before = await viewportGeometry(page);
  await toggle.click();
  await expect(page.locator('[data-figure-focus-dialog]')).toHaveAttribute('open', '');
  const after = await viewportGeometry(page);
  expect(after.left).toBeCloseTo(before.left, 1);
  expect(after.width).toBeCloseTo(before.width, 1);
  await expect
    .poll(() => viewportGeometry(page).then((value) => value.scrollY))
    .toBeCloseTo(before.scrollY, 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-figure-focus-dialog]')).not.toHaveAttribute('open', '');
  const restored = await viewportGeometry(page);
  expect(restored.left).toBeCloseTo(before.left, 1);
  expect(restored.width).toBeCloseTo(before.width, 1);
  expect(restored.scrollY).toBeCloseTo(before.scrollY, 1);
});

test('focus mode preserves a selected 3D camera and panel proportion', async ({ page }) => {
  await page.goto('/en/blog/frenet-arc-length-conversion/');
  const explorer = page.locator('[data-frenet-explorer="phi-d"]').first();
  await explorer.scrollIntoViewIfNeeded();
  const surface = explorer.locator('.frenet-main-plot');
  await expect(surface.locator('.plot-container')).toBeVisible({ timeout: 30_000 });
  await expect(explorer.locator('.frenet-plot-shell')).toHaveAttribute('aria-busy', 'false');
  await expect
    .poll(() =>
      surface.evaluate((element) =>
        Array.from(element.querySelectorAll('canvas')).some((canvas) => {
          const context = canvas.getContext('webgl');
          return context !== null && !context.isContextLost() && context.drawingBufferWidth > 0;
        }),
      ),
    )
    .toBe(true);

  await surface.scrollIntoViewIfNeeded();
  await expect(surface).toBeInViewport();
  const plotBox = await surface.boundingBox();
  expect(plotBox).not.toBeNull();
  const initialCamera = await cameraOf(surface);
  if (plotBox) {
    await page.mouse.move(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(plotBox.x + plotBox.width * 0.64, plotBox.y + plotBox.height * 0.4, {
      steps: 6,
    });
    await page.mouse.up();
  }
  await expect.poll(() => cameraOf(surface)).not.toEqual(initialCamera);
  const selectedCamera = await cameraOf(surface);
  const selectedRatio = await splitRatio(explorer);

  const figure = explorer.locator('xpath=ancestor::figure[@data-figure-focus][1]');
  await figure.locator('[data-figure-focus-toggle]').click();
  await expect(page.locator('[data-figure-focus-dialog]')).toHaveAttribute('open', '');
  await expect.poll(() => cameraOf(surface)).toEqual(selectedCamera);
  await expect.poll(() => splitRatio(explorer)).toBeCloseTo(selectedRatio, 2);

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-figure-focus-dialog]')).not.toHaveAttribute('open', '');
  await expect.poll(() => cameraOf(surface)).toEqual(selectedCamera);
  await expect.poll(() => splitRatio(explorer)).toBeCloseTo(selectedRatio, 2);
  await explorer.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect.poll(() => cameraOf(surface)).toEqual(initialCamera);
});

test('focus controls expose localized open and close actions', async ({ page }) => {
  await page.goto('/zh/blog/frenet-arc-length-conversion/');
  const explorer = page.locator('[data-frenet-explorer="phi"]').first();
  const figure = explorer.locator('xpath=ancestor::figure[@data-figure-focus][1]');
  const toggle = figure.locator('[data-figure-focus-toggle]');
  await expect(toggle).toHaveAccessibleName('展开图 1');
  await toggle.click();
  await expect(page.locator('[data-figure-focus-dialog]')).toHaveAttribute('open', '');
  await expect(toggle).toHaveAccessibleName('收起图 1');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-figure-focus-dialog]')).not.toHaveAttribute('open', '');
  await expect(toggle).toHaveAccessibleName('展开图 1');
  await expect(toggle).toBeFocused();
});

test('figure content stays open while the visible dialog surround closes focus mode', async ({
  page,
}) => {
  await page.goto('/en/blog/frenet-arc-length-conversion/');
  const explorer = page.locator('[data-frenet-explorer="phi"]').first();
  const figure = explorer.locator('xpath=ancestor::figure[@data-figure-focus][1]');
  const toggle = figure.locator('[data-figure-focus-toggle]');
  await toggle.click();
  const dialog = page.locator('[data-figure-focus-dialog]');
  await expect(dialog).toHaveAttribute('open', '');

  await figure.locator('figcaption').click();
  await expect(dialog).toHaveAttribute('open', '');

  const surroundPoint = await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const candidates = [
      { x: box.left + 1, y: box.top + 1 },
      { x: box.right - 1, y: box.top + 1 },
      { x: box.left + 1, y: box.bottom - 1 },
      { x: box.right - 1, y: box.bottom - 1 },
    ];
    const point = candidates.find(
      ({ x, y }) =>
        document.elementFromPoint(x, y) === element && getComputedStyle(element).display !== 'none',
    );
    if (!point) throw new Error('The focus dialog has no visible, directly hittable surround.');
    return point;
  });
  await page.mouse.click(surroundPoint.x, surroundPoint.y);
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(toggle).toBeFocused();
});
