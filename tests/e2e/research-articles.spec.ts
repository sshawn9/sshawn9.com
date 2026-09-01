import { expect, test, type Locator } from '@playwright/test';

async function expectAnnotationsNotToOverlap(plot: Locator): Promise<void> {
  const labels = await plot.locator('.annotation-text').evaluateAll((elements) =>
    elements.flatMap((element) => {
      const text = element.textContent?.trim();
      if (!text) return [];
      const box = element.getBoundingClientRect();
      return [{ text, x: box.x, y: box.y, width: box.width, height: box.height }];
    }),
  );

  for (let leftIndex = 0; leftIndex < labels.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < labels.length; rightIndex += 1) {
      const left = labels[leftIndex];
      const right = labels[rightIndex];
      const overlapWidth =
        Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
      const overlapHeight =
        Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
      expect(
        overlapWidth <= 2 || overlapHeight <= 2,
        `Plot annotations “${left.text}” and “${right.text}” overlap`,
      ).toBeTruthy();
    }
  }
}

test('the planar Frenet article renders its complete native figures', async ({ page }) => {
  await page.goto('/zh/blog/planar-frenet-frame/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('平面曲线的有符号 Frenet 标架');
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.locator('.research-plot')).toHaveCount(2);
  await expect(page.locator('.research-plot .js-plotly-plot')).toHaveCount(2, { timeout: 20_000 });
  const expectedFontFamily = await page
    .locator('.research-plot')
    .first()
    .evaluate((element) => getComputedStyle(element).fontFamily);
  await expect
    .poll(() =>
      page
        .locator('.research-plot .js-plotly-plot')
        .first()
        .evaluate((element) => {
          const plot = element as HTMLElement & {
            _fullLayout?: { font?: { family?: string } };
          };
          return plot._fullLayout?.font?.family;
        }),
    )
    .toBe(expectedFontFamily);
  await expect(page.locator('figcaption').first()).toContainText('图 1.');
  for (const plot of await page.locator('.research-plot .js-plotly-plot').all()) {
    await expectAnnotationsNotToOverlap(plot);
  }

  const firstFigure = page
    .locator('[data-figure-focus]')
    .filter({ has: page.locator('[data-kind="planar-curvature-signs"]') });
  const firstCanvas = firstFigure.locator('.research-plot-canvas');
  await expect(firstCanvas).toBeVisible();
  const normalCanvasHeight = (await firstCanvas.boundingBox())?.height ?? 0;
  expect(normalCanvasHeight).toBeGreaterThan(250);
  await firstFigure.locator('[data-figure-focus-toggle]').click();
  await expect(page.locator('[data-figure-focus-dialog]')).toHaveAttribute('open', '');
  expect((await firstCanvas.boundingBox())?.height ?? 0).toBeGreaterThan(normalCanvasHeight * 1.5);
  await firstFigure.locator('[data-figure-focus-toggle]').click();
});

test('the vehicle kinematics article preserves its derivation and native figures', async ({
  page,
}) => {
  await page.goto('/zh/blog/frenet-vehicle-kinematics/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Frenet 坐标下的车辆运动学');
  await expect(page.getByRole('heading', { name: '时间域 Frenet 运动学' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '参考路径弧长域 Frenet 运动学' })).toBeVisible();
  await expect(
    page.getByRole('link', {
      name: '参考路径弧长与车辆轨迹有向弧长的局部换算：交互分析',
    }),
  ).toHaveAttribute('href', '../frenet-arc-length-conversion/');
  await expect(page.locator('.research-plot .js-plotly-plot')).toHaveCount(2, { timeout: 20_000 });
  for (const plot of await page.locator('.research-plot .js-plotly-plot').all()) {
    await expectAnnotationsNotToOverlap(plot);
  }
});

test('the closed-loop timeline supports direct manipulation without sliders', async ({ page }) => {
  await page.goto('/zh/blog/closed-loop-control-timing/');

  const timingFigure = page.locator('.closed-loop-control-timing');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('闭环控制中的信息时序');
  await expect(timingFigure.getByRole('slider')).toHaveCount(0);
  await expect(timingFigure.locator('.closed-loop-control-timing-plot svg')).toBeVisible({
    timeout: 20_000,
  });
  await expect(timingFigure.getByRole('switch', { name: '同步反馈生成与指令执行' })).toBeVisible();
  await expect(timingFigure).toHaveAttribute('data-decision-time', '50');
  await expect(timingFigure).toHaveAttribute('data-first-feedback-time', '-3.5');
  await expect(timingFigure.locator('.timeBoundary0 line')).toHaveCount(1);
  await expect(timingFigure.locator('.timeBoundary100 line')).toHaveCount(1);
  await expect(timingFigure.locator('.feedbackDelaySourceGuide line')).toHaveCount(1);
  await expect(timingFigure.locator('.feedbackDelayTargetGuide line')).toHaveCount(1);
  await expect(timingFigure.locator('.commandDelaySourceGuide line')).toHaveCount(1);
  await expect(timingFigure.locator('.commandDelayTargetGuide line')).toHaveCount(1);
  await expect(timingFigure.locator('.decisionPrimaryRail line')).toHaveCount(1);
  await expect(timingFigure.locator('.decisionAvailabilityRail line')).toHaveCount(1);
  await expect(timingFigure.locator('.applicationAvailabilityRail line')).toHaveCount(1);
  await expect(timingFigure.locator('.applicationPrimaryRail line')).toHaveCount(1);
  await expect(timingFigure.locator('.decisionProjectionStems line')).not.toHaveCount(0);
  await expect(timingFigure.locator('.applicationProjectionStems line')).not.toHaveCount(0);
  await expect(timingFigure.locator('svg text').filter({ hasText: '首点偏移' })).toHaveCount(3);

  const decisionPrimaryRailBox = await timingFigure
    .locator('.decisionPrimaryRail line')
    .boundingBox();
  const decisionAvailabilityRailBox = await timingFigure
    .locator('.decisionAvailabilityRail line')
    .boundingBox();
  const applicationAvailabilityRailBox = await timingFigure
    .locator('.applicationAvailabilityRail line')
    .boundingBox();
  const applicationPrimaryRailBox = await timingFigure
    .locator('.applicationPrimaryRail line')
    .boundingBox();
  expect(decisionPrimaryRailBox && decisionAvailabilityRailBox).toBeTruthy();
  expect(applicationAvailabilityRailBox && applicationPrimaryRailBox).toBeTruthy();
  expect(decisionPrimaryRailBox!.y).toBeLessThan(decisionAvailabilityRailBox!.y);
  expect(applicationAvailabilityRailBox!.y).toBeLessThan(applicationPrimaryRailBox!.y);

  const toolbarBox = await timingFigure
    .locator('.closed-loop-control-timing-toolbar')
    .boundingBox();
  const plotBox = await timingFigure.locator('.closed-loop-control-timing-plot').boundingBox();
  const resetBox = await timingFigure.getByRole('button', { name: '重置' }).boundingBox();
  const switchBox = await timingFigure.locator('.closed-loop-control-timing-switch').boundingBox();
  expect(toolbarBox && plotBox && toolbarBox.y + toolbarBox.height <= plotBox.y + 1).toBeTruthy();
  expect(resetBox && switchBox && switchBox.x < resetBox.x).toBeTruthy();

  const dragBy = async (target: ReturnType<typeof timingFigure.locator>, deltaX: number) => {
    await target.scrollIntoViewIfNeeded();
    const point = await target.boundingBox();
    expect(point).not.toBeNull();
    if (!point) return;
    const x = point.x + point.width / 2;
    const y = point.y + point.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + deltaX, y, { steps: 4 });
    await page.mouse.up();
  };

  const dragToX = async (target: ReturnType<typeof timingFigure.locator>, targetX: number) => {
    const point = await target.boundingBox();
    expect(point).not.toBeNull();
    if (!point) return;
    const x = point.x + point.width / 2;
    const y = point.y + point.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(targetX, y, { steps: 4 });
    await page.mouse.up();
  };

  await dragBy(timingFigure.locator('.decisionPoints path').nth(5), 45);
  await expect(timingFigure).not.toHaveAttribute('data-decision-time', '50');

  await timingFigure.getByRole('button', { name: '重置' }).click();
  await expect(timingFigure).toHaveAttribute('data-decision-time', '50');
  await dragToX(timingFigure.locator('.decisionPoints path').nth(5), plotBox!.x + 2);
  await expect(timingFigure).toHaveAttribute('data-decision-time', '0');
  await dragToX(
    timingFigure.locator('.decisionPoints path').first(),
    plotBox!.x + plotBox!.width - 2,
  );
  await expect(timingFigure).toHaveAttribute('data-decision-time', '100');

  await timingFigure.getByRole('button', { name: '重置' }).click();
  await dragBy(timingFigure.locator('.feedbackPoints path').first(), 35);
  await expect(timingFigure).not.toHaveAttribute('data-feedback-offset', '2.5');

  await timingFigure.getByRole('button', { name: '重置' }).click();
  const intervalPoint = timingFigure.locator('.feedbackPoints path').nth(1);
  await intervalPoint.hover();
  const tooltip = timingFigure.locator('.liveTimingTooltip');
  await expect(tooltip).toBeVisible();
  await page.mouse.move(5, 5);
  await expect(tooltip).toBeHidden();
  await intervalPoint.hover();
  const previousTooltip = await tooltip.textContent();
  const intervalPointBox = await intervalPoint.boundingBox();
  expect(intervalPointBox).not.toBeNull();
  if (intervalPointBox) {
    const x = intervalPointBox.x + intervalPointBox.width / 2;
    const y = intervalPointBox.y + intervalPointBox.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 35, y, { steps: 4 });
    await expect.poll(() => tooltip.textContent()).not.toBe(previousTooltip);
    await page.mouse.up();
  }
  await expect(timingFigure).not.toHaveAttribute('data-feedback-interval', '6');
  await expect(timingFigure).toHaveAttribute('data-first-feedback-time', '-3.5');

  const firstFeedback = timingFigure.locator('.feedbackPoints path').first();
  const secondFeedback = timingFigure.locator('.feedbackPoints path').nth(1);
  const firstFeedbackBox = await firstFeedback.boundingBox();
  const secondFeedbackBox = await secondFeedback.boundingBox();
  expect(firstFeedbackBox && secondFeedbackBox).toBeTruthy();
  if (firstFeedbackBox && secondFeedbackBox) {
    await dragBy(secondFeedback, firstFeedbackBox.x - secondFeedbackBox.x);
    expect(
      Number(await timingFigure.getAttribute('data-feedback-interval')),
    ).toBeGreaterThanOrEqual(2);
  }

  await timingFigure.getByRole('button', { name: '重置' }).click();
  await dragBy(timingFigure.locator('.commandAvailabilityPoints path').nth(5), 35);
  await expect(timingFigure).not.toHaveAttribute('data-command-delay', '15');

  const synchronize = timingFigure.getByRole('switch', { name: '同步反馈生成与指令执行' });
  await expect(synchronize).toBeChecked();
  await timingFigure.locator('.closed-loop-control-timing-switch-control').click();
  await expect(synchronize).not.toBeChecked();
  await timingFigure.getByRole('button', { name: '重置' }).click();
  await expect(synchronize).toBeChecked();
});
