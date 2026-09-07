import { expect, test } from '@playwright/test';
import { cameraOf } from '../plotly-camera';

test.describe.configure({ timeout: 60_000 });

test('sidebar layout changes preserve the live Frenet parameter and camera state', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
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

  await explorer.evaluate((element) => {
    element.dataset.sidebarContinuityProbe = 'same-instance';
  });
  const parameter = explorer.locator(
    '[data-frenet-control="kappa"] .frenet-slider-thumb[role="slider"]',
  );
  await parameter.focus();
  await surface.evaluate((element) => {
    const plot = element as HTMLElement & {
      once(event: 'plotly_afterplot', callback: () => void): void;
    };
    plot.once('plotly_afterplot', () => {
      plot.dataset.parameterRendered = '';
    });
  });
  await parameter.press('ArrowRight');
  await expect(explorer.locator('[data-frenet-status]')).toContainText('κᵣ=0.0010');
  await expect(surface).toHaveAttribute('data-parameter-rendered', '');

  await surface.scrollIntoViewIfNeeded();
  await expect(surface).toBeInViewport();
  const plotBox = await surface.boundingBox();
  expect(plotBox).not.toBeNull();
  const initialCamera = await cameraOf(surface);
  expect(initialCamera?.eye).toBeTruthy();
  if (plotBox) {
    await page.mouse.move(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(plotBox.x + plotBox.width * 0.66, plotBox.y + plotBox.height * 0.42, {
      steps: 6,
    });
    await page.mouse.up();
  }
  await expect.poll(() => cameraOf(surface)).not.toEqual(initialCamera);
  const selectedCamera = await cameraOf(surface);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
      ),
  );
  const selectedStatus = await explorer.locator('[data-frenet-status]').textContent();
  const initialWidth = await explorer.evaluate((element) => element.getBoundingClientRect().width);

  const layout = page.locator('[data-article-sidebar-layout]');
  await page.getByRole('button', { name: 'Collapse article sidebar' }).click();
  await expect(layout).toHaveAttribute('data-sidebar-collapsed', '');
  await expect
    .poll(() => explorer.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(initialWidth);

  await page.getByRole('button', { name: 'Expand article sidebar' }).click();
  await expect(layout).not.toHaveAttribute('data-sidebar-collapsed', '');
  const resizer = page.getByRole('separator', { name: 'Resize article sidebar' });
  await resizer.focus();
  await resizer.press('End');
  await expect(resizer).toHaveAttribute('aria-valuenow', '352');

  await expect(page.locator('[data-sidebar-continuity-probe="same-instance"]')).toHaveCount(1);
  await expect(explorer.locator('[data-frenet-status]')).toHaveText(selectedStatus ?? '');
  await expect.poll(() => cameraOf(surface)).toEqual(selectedCamera);
  await expect
    .poll(() => explorer.evaluate((element) => element.getBoundingClientRect().width))
    .toBeLessThan(initialWidth);
});
