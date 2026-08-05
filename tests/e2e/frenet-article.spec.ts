import { expect, test } from '@playwright/test';

test('the Frenet article renders math and six native interactive figures', async ({ page }) => {
  await page.goto('/zh/blog/frenet-arc-length-conversion/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Frenet 弧长换算关系的交互可视化',
  );
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.locator('[data-frenet-explorer]')).toHaveCount(6);

  const firstExplorer = page.locator('[data-frenet-explorer="phi"]');
  await firstExplorer.scrollIntoViewIfNeeded();
  await expect(firstExplorer.locator('.js-plotly-plot')).toHaveCount(2, { timeout: 20_000 });
  await expect(firstExplorer.locator('.frenet-main-plot')).toBeVisible();
  await expect(firstExplorer.locator('.frenet-geometry-plot')).toBeVisible();
  await expect(firstExplorer.locator('[data-frenet-status]')).toContainText('d=0.0000');

  const sliders = firstExplorer.locator('.frenet-slider');
  await expect(sliders).toHaveCount(4);
  await expect(firstExplorer.locator('.frenet-slider-value')).toHaveCount(4);
  await expect(firstExplorer.locator('.frenet-slider-bounds')).toHaveCount(4);
  await expect(firstExplorer.locator('.frenet-slider-bounds span')).toHaveCount(8);

  const firstTrack = firstExplorer.locator('.frenet-slider-track').first();
  const firstThumb = firstTrack.locator('.frenet-slider-thumb').first();
  const [trackBox, thumbBox] = await Promise.all([
    firstTrack.boundingBox(),
    firstThumb.boundingBox(),
  ]);
  expect(trackBox).not.toBeNull();
  expect(thumbBox).not.toBeNull();
  expect(
    Math.abs(trackBox!.y + trackBox!.height / 2 - (thumbBox!.y + thumbBox!.height / 2)),
  ).toBeLessThan(0.6);

  const offsetThumb = firstExplorer.locator(
    '[data-frenet-control="d"] .frenet-slider-thumb[role="slider"]',
  );
  await offsetThumb.focus();
  await offsetThumb.press('ArrowRight');
  await expect(firstExplorer.locator('[data-frenet-status]')).toContainText('d=0.0010');

  const surfaceExplorer = page.locator('[data-frenet-explorer="phi-d"]');
  await surfaceExplorer.scrollIntoViewIfNeeded();
  await expect(surfaceExplorer.locator('.js-plotly-plot')).toHaveCount(2, { timeout: 20_000 });
});

test('Plotly controls and locale switching keep the article layout stable', async ({ page }) => {
  await page.goto('/zh/blog/frenet-arc-length-conversion/');
  const explorer = page.locator('[data-frenet-explorer="phi"]');
  const figure = page.locator('[data-figure-focus]').filter({ has: explorer });
  await explorer.scrollIntoViewIfNeeded();
  await expect(explorer.locator('.frenet-main-plot')).toBeVisible({ timeout: 20_000 });
  await expect(figure.locator('[data-figure-focus-toggle]')).toHaveAttribute(
    'aria-label',
    '展开图 1',
  );
  await expect(explorer.getByRole('button', { name: '重置' })).toBeVisible();

  const initialHeight = await explorer
    .locator('.frenet-plot-shell')
    .evaluate((element) => element.getBoundingClientRect().height);
  await explorer.locator('.modebar-btn').first().click({ force: true });
  await expect
    .poll(() =>
      explorer
        .locator('.frenet-plot-shell')
        .evaluate((element) => element.getBoundingClientRect().height),
    )
    .toBe(initialHeight);

  const initialScroll = await page.evaluate(() => window.scrollY);
  await page.locator('a[data-locale-switch="en"]').first().click();
  await expect(page).toHaveURL(/\/en\/blog\/frenet-arc-length-conversion\/$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(initialScroll);
  expect(await page.evaluate(() => history.state?.localeSwitchScroll)).toBeUndefined();
  const scrollSamples = await page.evaluate(async () => {
    const samples: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      samples.push(window.scrollY);
    }
    return samples;
  });
  expect(scrollSamples.every((position) => position === initialScroll)).toBe(true);

  const translatedExplorer = page.locator('[data-frenet-explorer="phi"]');
  const translatedFigure = page.locator('[data-figure-focus]').filter({ has: translatedExplorer });
  await expect(translatedExplorer.locator('.frenet-main-plot')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('.article-prose')).toHaveAttribute('lang', 'zh-CN');
  await expect(translatedFigure.locator('[data-figure-focus-toggle]')).toHaveAttribute(
    'aria-label',
    'Expand figure 1',
  );
  await expect(
    translatedExplorer.getByRole('button', { name: 'Reset', exact: true }),
  ).toBeVisible();
  await expect(translatedExplorer.locator('[data-frenet-control="d"]')).toContainText('横向偏差 d');
  await expect
    .poll(() =>
      translatedExplorer
        .locator('.modebar')
        .evaluate((element) => getComputedStyle(element).position),
    )
    .toBe('absolute');
  await translatedExplorer.locator('.modebar-btn').first().click({ force: true });
  const interactionScrollSamples = await page.evaluate(async () => {
    const samples: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      samples.push(window.scrollY);
    }
    return samples;
  });
  expect(interactionScrollSamples.every((position) => position === initialScroll)).toBe(true);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.locator('a[data-locale-switch="zh"]').first().click();
  await expect(page).toHaveURL(/\/zh\/blog\/frenet-arc-length-conversion\/$/);
  const topScrollSamples = await page.evaluate(async () => {
    const samples: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      samples.push(window.scrollY);
    }
    return samples;
  });
  expect(topScrollSamples.every((position) => position === 0)).toBe(true);
});

test('locale switching uses the click-time position after repeated scrolling', async ({ page }) => {
  await page.goto('/zh/blog/frenet-arc-length-conversion/');
  await page.evaluate(() => {
    window.location.hash = '#横向偏差参考曲率曲面';
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const middle = await page.evaluate(() => Math.floor(document.documentElement.scrollHeight / 2));

  for (const top of [middle, 0, middle, 0]) {
    await page.evaluate((position) => window.scrollTo({ top: position, behavior: 'instant' }), top);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(top);
  }

  await page.locator('a[data-locale-switch="en"]').first().click();
  await expect(page).toHaveURL(/\/en\/blog\/frenet-arc-length-conversion\/$/);
  const scrollSamples = await page.evaluate(async () => {
    const samples: number[] = [];
    for (let index = 0; index < 180; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      samples.push(window.scrollY);
    }
    return samples;
  });
  expect(scrollSamples).toEqual(Array.from({ length: 180 }, () => 0));
});

test('the plot splitter resizes both plots live on the first focused drag', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/zh/blog/frenet-arc-length-conversion/');
  const explorer = page.locator('[data-frenet-explorer="phi"]');
  const figure = page.locator('[data-figure-focus]').filter({ has: explorer });
  await explorer.scrollIntoViewIfNeeded();
  await expect(explorer.locator('.js-plotly-plot')).toHaveCount(2, { timeout: 20_000 });

  const caption = figure.locator(':scope > figcaption');
  await expect(caption).toContainText('图 1.');
  expect(await figure.evaluate((element) => element.lastElementChild?.tagName.toLowerCase())).toBe(
    'figcaption',
  );
  expect(await caption.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('0px');

  await figure.locator('[data-figure-focus-toggle]').click();
  const dialog = page.locator('[data-figure-focus-dialog]');
  await expect(dialog).toHaveAttribute('open', '');

  const separator = explorer.getByRole('separator', {
    name: '调整关系图与几何图的宽度',
  });
  await expect(separator).toBeVisible();
  const initialValue = Number(await separator.getAttribute('aria-valuenow'));
  const mainPanel = explorer.locator('.frenet-main-panel');
  const geometryPanel = explorer.locator('.frenet-geometry-panel');
  const readSplitState = () =>
    explorer.evaluate((element) => {
      const readPlotWidth = (selector: string) => {
        const plot = element.querySelector(selector) as HTMLElement & {
          _fullLayout?: { width?: number };
        };
        return plot?._fullLayout?.width ?? null;
      };
      const readPanelWidth = (selector: string) =>
        element.querySelector(selector)?.getBoundingClientRect().width ?? null;
      return {
        mainPanel: readPanelWidth('.frenet-main-panel'),
        geometryPanel: readPanelWidth('.frenet-geometry-panel'),
        mainPlot: readPlotWidth('.frenet-main-plot'),
        geometryPlot: readPlotWidth('.frenet-geometry-plot'),
      };
    });

  await expect.poll(async () => (await mainPanel.boundingBox())?.width ?? 0).toBeGreaterThan(800);
  const separatorBox = await separator.boundingBox();
  const initialMainBox = await mainPanel.boundingBox();
  const initialGeometryBox = await geometryPanel.boundingBox();
  const initialSplitState = await readSplitState();
  expect(separatorBox).not.toBeNull();
  expect(initialMainBox).not.toBeNull();
  expect(initialGeometryBox).not.toBeNull();
  expect(initialSplitState.mainPanel).not.toBeNull();
  expect(initialSplitState.geometryPanel).not.toBeNull();
  expect(initialSplitState.mainPlot).not.toBeNull();
  expect(initialSplitState.geometryPlot).not.toBeNull();
  expect(separatorBox!.x).toBeGreaterThanOrEqual(initialMainBox!.x + initialMainBox!.width - 1);
  expect(separatorBox!.x + separatorBox!.width).toBeLessThanOrEqual(initialGeometryBox!.x + 1);

  await page.mouse.move(
    separatorBox!.x + separatorBox!.width / 2,
    separatorBox!.y + separatorBox!.height / 2,
  );
  await page.mouse.down();
  const dragSamples: Awaited<ReturnType<typeof readSplitState>>[] = [];
  for (let step = 1; step <= 14; step += 1) {
    await page.mouse.move(
      separatorBox!.x + separatorBox!.width / 2 + step * 8,
      separatorBox!.y + separatorBox!.height / 2,
    );
    await page.waitForTimeout(16);
    dragSamples.push(await readSplitState());
  }

  const duringDragValue = Number(await separator.getAttribute('aria-valuenow'));
  expect(duringDragValue).toBeGreaterThan(initialValue);
  expect(dragSamples.at(-1)!.mainPanel).toBeGreaterThan(initialSplitState.mainPanel!);
  expect(dragSamples.at(-1)!.geometryPanel).toBeLessThan(initialSplitState.geometryPanel!);

  const distinctWidths = (key: 'mainPlot' | 'geometryPlot') =>
    new Set(dragSamples.map((sample) => Math.round(sample[key] ?? 0))).size;
  expect(distinctWidths('mainPlot')).toBeGreaterThanOrEqual(10);
  expect(distinctWidths('geometryPlot')).toBeGreaterThanOrEqual(10);

  const maximumLayoutLag = Math.max(
    ...dragSamples.flatMap((sample) => [
      Math.abs(
        sample.mainPanel! -
          initialSplitState.mainPanel! -
          (sample.mainPlot! - initialSplitState.mainPlot!),
      ),
      Math.abs(
        sample.geometryPanel! -
          initialSplitState.geometryPanel! -
          (sample.geometryPlot! - initialSplitState.geometryPlot!),
      ),
    ]),
  );
  expect(maximumLayoutLag).toBeLessThanOrEqual(12);
  await page.mouse.up();

  const draggedValue = Number(await separator.getAttribute('aria-valuenow'));
  await separator.focus();
  await separator.press('ArrowLeft');
  await expect
    .poll(async () => Number(await separator.getAttribute('aria-valuenow')))
    .toBeLessThan(draggedValue);
  const focusOverflow = await dialog.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(focusOverflow.scrollWidth - focusOverflow.clientWidth).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 700, height: 1000 });
  await expect(separator).toHaveCount(0);
  await expect
    .poll(async () => (await geometryPanel.boundingBox())!.y)
    .toBeGreaterThan((await mainPanel.boundingBox())!.y);
});

test('reloading an article restores its scroll position without an animation', async ({ page }) => {
  await page.goto('/zh/blog/frenet-arc-length-conversion/');
  const explorer = page.locator('[data-frenet-explorer="phi-d"]');
  await explorer.scrollIntoViewIfNeeded();
  await expect(explorer.locator('.frenet-main-plot')).toBeVisible({ timeout: 20_000 });
  const initialScroll = await page.evaluate(() => window.scrollY);
  expect(initialScroll).toBeGreaterThan(0);

  await page.reload();
  const reloadScrollSamples = await page.evaluate(async () => {
    const samples: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      samples.push(window.scrollY);
    }
    return samples;
  });
  expect(reloadScrollSamples).toEqual(Array.from({ length: 12 }, () => initialScroll));
});

test('figure focus mode preserves state, position, and native dialog behavior', async ({
  page,
}) => {
  await page.goto('/zh/blog/frenet-arc-length-conversion/');
  const figure = page.locator('[data-figure-focus]').filter({
    has: page.locator('[data-frenet-explorer="phi"]'),
  });
  const explorer = figure.locator('[data-frenet-explorer="phi"]');
  const toggle = figure.locator('[data-figure-focus-toggle]');
  const dialog = page.locator('[data-figure-focus-dialog]');

  await figure.scrollIntoViewIfNeeded();
  await expect(explorer.locator('.frenet-main-plot')).toBeVisible({ timeout: 20_000 });
  await expect(figure.locator(':scope > figcaption')).toContainText('图 1.');
  const normalBox = await figure.boundingBox();
  expect(normalBox).not.toBeNull();

  const offsetThumb = explorer.locator(
    '[data-frenet-control="d"] .frenet-slider-thumb[role="slider"]',
  );
  await offsetThumb.focus();
  await offsetThumb.press('ArrowRight');
  await expect(explorer.locator('[data-frenet-status]')).toContainText('d=0.0010');
  await toggle.scrollIntoViewIfNeeded();
  const initialScroll = await page.evaluate(() => window.scrollY);

  await toggle.click();
  await expect(dialog).toHaveAttribute('open', '');
  await expect(dialog.locator('[data-figure-focus]')).toHaveCount(1);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-figure-focus-open', '');
  await expect(explorer.locator('[data-frenet-status]')).toContainText('d=0.0010');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(initialScroll);

  const focusBox = await figure.boundingBox();
  expect(focusBox).not.toBeNull();
  expect(focusBox!.width).toBeGreaterThan(normalBox!.width);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(initialScroll);

  await page.keyboard.press('Escape');
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(dialog.locator('[data-figure-focus]')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('html')).not.toHaveAttribute('data-figure-focus-open', '');
  await expect(explorer.locator('[data-frenet-status]')).toContainText('d=0.0010');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(initialScroll);

  await toggle.click();
  await expect(dialog).toHaveAttribute('open', '');
  await toggle.click();
  await expect(dialog).not.toHaveAttribute('open', '');
  await expect(explorer.locator('[data-frenet-status]')).toContainText('d=0.0010');
});

test('repeated focus cycles keep both plot scales and the relation snap point stable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/zh/blog/frenet-arc-length-conversion/');
  const explorer = page.locator('[data-frenet-explorer="phi"]');
  const figure = page.locator('[data-figure-focus]').filter({ has: explorer });
  const toggle = figure.locator('[data-figure-focus-toggle]');
  const dialog = page.locator('[data-figure-focus-dialog]').first();
  const plot = explorer.locator('.frenet-main-plot');
  const geometryPlot = explorer.locator('.frenet-geometry-plot');
  await explorer.scrollIntoViewIfNeeded();
  await expect(plot).toBeVisible({ timeout: 20_000 });
  await expect(geometryPlot).toBeVisible();

  const measure = () =>
    explorer.evaluate((element) => {
      const plot = element.querySelector('.frenet-main-plot') as HTMLElement & {
        data?: Array<{ x?: number[] }>;
        _fullData?: Array<{ uid?: string }>;
      };
      const geometry = element.querySelector('.frenet-geometry-plot') as HTMLElement & {
        _fullLayout?: {
          xaxis?: { range: number[]; _length: number };
          yaxis?: { range: number[]; _length: number };
        };
      };
      const selectedUid = plot._fullData?.[3]?.uid;
      const selectedGroup = selectedUid
        ? plot.querySelector(`.scatterlayer .trace${CSS.escape(selectedUid)}`)
        : null;
      const selectedPoint = selectedGroup?.querySelector('.point');
      const selectedPointBox = selectedPoint?.getBoundingClientRect();
      return {
        right: geometry._fullLayout?.xaxis
          ? {
              range: [...geometry._fullLayout.xaxis.range],
              length: geometry._fullLayout.xaxis._length,
            }
          : null,
        rightY: geometry._fullLayout?.yaxis
          ? {
              range: [...geometry._fullLayout.yaxis.range],
              length: geometry._fullLayout.yaxis._length,
            }
          : null,
        selectedX: plot.data?.[3]?.x?.[0],
        selectedPointVisible:
          getComputedStyle(selectedGroup ?? plot).display !== 'none' &&
          Boolean(selectedPointBox?.width && selectedPointBox.height),
      };
    });

  const initial = await measure();
  expect(initial.right).not.toBeNull();
  expect(initial.rightY).not.toBeNull();
  expect(initial.selectedPointVisible).toBe(true);
  let focused: Awaited<ReturnType<typeof measure>> | undefined;

  for (let index = 1; index <= 5; index += 1) {
    await toggle.click();
    await expect(dialog).toHaveAttribute('open', '');
    await expect
      .poll(async () => (await measure()).right?.length ?? 0)
      .toBeGreaterThan(initial.right!.length);
    const focusedNow = await measure();
    expect(focusedNow.selectedPointVisible).toBe(true);
    if (focused) {
      expect(focusedNow.right?.range).toEqual(focused.right?.range);
      expect(focusedNow.rightY?.range).toEqual(focused.rightY?.range);
    } else {
      focused = focusedNow;
    }

    await toggle.click();
    await expect(dialog).not.toHaveAttribute('open', '');
    await expect
      .poll(async () => (await measure()).right?.length ?? 0)
      .toBeCloseTo(initial.right!.length, 5);
    const normalNow = await measure();
    expect(normalNow.right?.range).toEqual(initial.right?.range);
    expect(normalNow.rightY?.range).toEqual(initial.rightY?.range);
    expect(normalNow.selectedPointVisible).toBe(true);
  }

  const hoverPoint = await plot.evaluate((element) => {
    const plot = element as HTMLElement & {
      _fullLayout?: {
        xaxis?: { _offset: number; l2p: (value: number) => number };
        yaxis?: { _offset: number; l2p: (value: number) => number };
      };
      data?: Array<{ x?: number[]; y?: Array<number | null> }>;
    };
    const xaxis = plot._fullLayout?.xaxis;
    const yaxis = plot._fullLayout?.yaxis;
    const trace = plot.data?.[0];
    const index = trace?.x?.findIndex((value) => Math.abs(value - 15) < 1e-9) ?? -1;
    const x = trace?.x?.[index];
    const y = trace?.y?.[index];
    if (!xaxis || !yaxis || x === undefined || y === undefined || y === null) {
      throw new Error('Unable to locate relation point.');
    }
    const rect = plot.getBoundingClientRect();
    return {
      x: rect.left + xaxis._offset + xaxis.l2p(x),
      y: rect.top + yaxis._offset + yaxis.l2p(y),
    };
  });
  await page.mouse.move(hoverPoint.x, hoverPoint.y);
  await expect(explorer.locator('[data-frenet-status]')).toContainText('φ=15.00°');
  await expect.poll(async () => (await measure()).selectedX).toBe(15);
  expect((await measure()).selectedPointVisible).toBe(true);
});

test('surface hover updates geometry without a custom point or camera reset', async ({ page }) => {
  await page.goto('/zh/blog/frenet-arc-length-conversion/');
  const explorer = page.locator('[data-frenet-explorer="d-kappa"]');
  const plot = explorer.locator('.frenet-main-plot');
  const status = explorer.locator('[data-frenet-status]');
  await explorer.scrollIntoViewIfNeeded();
  await expect(explorer.locator('.js-plotly-plot')).toHaveCount(2, { timeout: 20_000 });
  expect(
    await plot.evaluate((element) => {
      const graph = element as HTMLElement & { data?: Array<{ type?: string }> };
      return graph.data?.map((trace) => trace.type) ?? [];
    }),
  ).toEqual(['surface', 'surface']);

  const readAxisRanges = () =>
    plot.evaluate((element) => {
      const graph = element as HTMLElement & {
        _fullLayout?: {
          scene?: {
            xaxis?: { range: number[] };
            yaxis?: { range: number[] };
          };
        };
      };
      return {
        d: [...(graph._fullLayout?.scene?.xaxis?.range ?? [])],
        kappa: [...(graph._fullLayout?.scene?.yaxis?.range ?? [])],
      };
    });

  const initialRanges = await readAxisRanges();
  const dLowerBound = explorer
    .locator('[data-frenet-control="d-range"] .frenet-slider-thumb[role="slider"]')
    .first();
  const kappaUpperBound = explorer
    .locator('[data-frenet-control="kappa-range"] .frenet-slider-thumb[role="slider"]')
    .last();
  await dLowerBound.focus();
  await dLowerBound.press('ArrowRight');
  await kappaUpperBound.focus();
  await kappaUpperBound.press('ArrowLeft');
  await expect
    .poll(async () => {
      const ranges = await readAxisRanges();
      return {
        d: JSON.stringify(ranges.d) !== JSON.stringify(initialRanges.d),
        kappa: JSON.stringify(ranges.kappa) !== JSON.stringify(initialRanges.kappa),
      };
    })
    .toEqual({ d: true, kappa: true });

  const readCameraEye = () =>
    plot.evaluate((element) => {
      const graph = element as HTMLElement & {
        _fullLayout?: { scene?: { _scene?: { camera: { eye: number[] } } } };
      };
      return [...(graph._fullLayout?.scene?._scene?.camera.eye ?? [])].map((value) =>
        Number(value.toFixed(3)),
      );
    });

  const initialEye = await readCameraEye();
  const canvasBox = await plot.locator('canvas').first().boundingBox();
  expect(canvasBox).not.toBeNull();
  const start = {
    x: canvasBox!.x + canvasBox!.width * 0.52,
    y: canvasBox!.y + canvasBox!.height * 0.48,
  };
  await page.mouse.move(start.x, start.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.move(start.x + 90, start.y - 35, { steps: 10 });
  await page.mouse.up();
  await expect.poll(readCameraEye).not.toEqual(initialEye);
  const adjustedEye = await readCameraEye();

  const initialStatus = await status.textContent();
  for (const [x, y] of [
    [0.35, 0.35],
    [0.65, 0.35],
    [0.35, 0.65],
    [0.65, 0.65],
  ]) {
    await page.mouse.move(
      canvasBox!.x + canvasBox!.width * x,
      canvasBox!.y + canvasBox!.height * y,
    );
    await page.waitForTimeout(50);
    if ((await status.textContent()) !== initialStatus) break;
  }
  await expect(status).not.toHaveText(initialStatus ?? '', { timeout: 2_000 });
  await expect.poll(readCameraEye).toEqual(adjustedEye);
});
