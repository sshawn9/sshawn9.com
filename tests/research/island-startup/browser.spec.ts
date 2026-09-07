import { expect, test } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

test('Frenet and closed-loop islands render their expected plot containers', async ({ page }) => {
  await page.goto('/en/blog/frenet-arc-length-conversion/');
  await expect(page.locator('[data-frenet-explorer]')).toHaveCount(10);

  const firstExplorer = page.locator('[data-frenet-explorer="phi"]').first();
  await firstExplorer.scrollIntoViewIfNeeded();
  const mainPlot = firstExplorer.locator('.frenet-main-plot');
  await expect(mainPlot.locator('.plot-container')).toBeVisible({
    timeout: 30_000,
  });

  const surfaceExplorer = page.locator('[data-frenet-explorer="phi-d"]').first();
  const surfacePlot = surfaceExplorer.locator('.frenet-main-plot');
  await surfaceExplorer.scrollIntoViewIfNeeded();
  await expect(surfaceExplorer.locator('.frenet-plot-shell')).toHaveAttribute(
    'aria-busy',
    'false',
    { timeout: 30_000 },
  );
  await expect(surfacePlot.locator('.no-webgl')).toHaveCount(0);
  await expect
    .poll(() =>
      surfacePlot.evaluate((element) =>
        Array.from(element.querySelectorAll('canvas')).some((canvas) => {
          const context = canvas.getContext('webgl');
          return (
            context !== null &&
            !context.isContextLost() &&
            context.drawingBufferWidth > 0 &&
            context.drawingBufferHeight > 0
          );
        }),
      ),
    )
    .toBe(true);

  await page.goto('/en/blog/closed-loop-control-timing/');
  await expect(page.locator('.closed-loop-control-timing-plot svg')).toBeVisible({
    timeout: 30_000,
  });
});
