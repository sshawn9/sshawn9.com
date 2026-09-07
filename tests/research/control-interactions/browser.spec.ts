import { expect, test } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

test('research controls respond, and the Frenet control survives an appearance change', async ({
  page,
}) => {
  await page.goto('/en/blog/frenet-arc-length-conversion/');
  const explorer = page.locator('[data-frenet-explorer="phi"]').first();
  await explorer.scrollIntoViewIfNeeded();
  await expect(explorer.locator('.frenet-main-plot .plot-container')).toBeVisible({
    timeout: 30_000,
  });

  const offsetThumb = explorer.locator(
    '[data-frenet-control="d"] .frenet-slider-thumb[role="slider"]',
  );
  await offsetThumb.focus();
  await offsetThumb.press('ArrowRight');
  await expect(explorer.locator('[data-frenet-status]')).toContainText('d=0.0010');

  const root = page.locator('html');
  const previousTheme = await root.getAttribute('data-theme');
  await page.locator('[data-theme-toggle]').first().click();
  if (previousTheme) await expect(root).not.toHaveAttribute('data-theme', previousTheme);
  await expect(explorer.locator('[data-frenet-status]')).toContainText('d=0.0010');
  await expect(explorer.locator('.plot-container')).toHaveCount(2);

  await page.goto('/en/blog/closed-loop-control-timing/');
  const timingFigure = page.locator('.closed-loop-control-timing');
  await expect(timingFigure.locator('.closed-loop-control-timing-plot svg')).toBeVisible({
    timeout: 30_000,
  });
  const decisionPoint = timingFigure.locator('.decisionPoints path').nth(5);
  await decisionPoint.scrollIntoViewIfNeeded();
  const point = await decisionPoint.boundingBox();
  expect(point).not.toBeNull();
  if (point) {
    const x = point.x + point.width / 2;
    const y = point.y + point.height / 2;
    await page.mouse.move(x, y);
    await expect(timingFigure.locator('.closed-loop-control-timing-plot svg')).toContainText(
      'Drag to adjust the decision offset',
    );
    await page.mouse.down();
    await expect(timingFigure).toHaveAttribute('data-dragging', 'decision-time');
    await page.mouse.move(x + 24, y);
    const intermediateTime = await timingFigure.getAttribute('data-decision-time');
    expect(intermediateTime).not.toBe('50');
    await page.mouse.move(x + 45, y);
    await expect
      .poll(() => timingFigure.getAttribute('data-decision-time'))
      .not.toBe(intermediateTime);
    const latestTime = await timingFigure.getAttribute('data-decision-time');
    await page.mouse.up();
    await expect(timingFigure).not.toHaveAttribute('data-dragging', /.+/);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
    await expect(timingFigure).toHaveAttribute('data-decision-time', latestTime ?? '');
  }
  await expect(timingFigure).not.toHaveAttribute('data-decision-time', '50');
});
