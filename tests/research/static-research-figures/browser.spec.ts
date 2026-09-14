import { expect, test, type Locator } from '@playwright/test';
import { parseHTML } from 'linkedom';

test.describe.configure({ timeout: 60_000 });

const articles = [
  {
    slug: 'planar-frenet-frame',
    figures: [
      { kind: 'planar-curvature-signs', panels: 3, label: /^K\s*=\s*0$/ },
      { kind: 'planar-heading', panels: 2, label: /^T\s*\(s\)$/ },
    ],
  },
  {
    slug: 'frenet-vehicle-kinematics',
    figures: [
      { kind: 'vehicle-state', panels: 1, label: /^d$/ },
      { kind: 'vehicle-velocity', panels: 2, label: /^v\s*cos\s*φ\s*T$/ },
    ],
  },
] as const;
const plotlyRuntime = /\/plotly-gl3d\.min\.[^/]+\.js(?:\?|$)/;

test('time derivative dots are typeset above their letters in inline and focused diagrams', async ({
  page,
}) => {
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url());
  });
  await page.goto('/zh/blog/frenet-vehicle-kinematics/');
  await page.evaluate(() => document.fonts.ready);
  const graph = page.locator('[data-research-figure][data-kind="vehicle-velocity"]');
  const figure = graph.locator('xpath=ancestor::figure[1]');
  const formulas = graph.locator('.research-label .katex');
  await expect(formulas).toHaveCount(3);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const focus of [false, true]) {
      if (focus) await figure.locator('[data-figure-focus-toggle]').click();
      for (const [index, letter] of ['z', 's', 'd'].entries()) {
        const formula = formulas.nth(index);
        await expect(formula).toBeVisible();
        await expect(formula).toHaveCSS('font-size', '18px');
        const mover = formula.locator('.katex-mathml mover');
        await expect(mover).toHaveCount(1);
        await expect(mover.locator('mi').first()).toHaveText(letter);
        await expect(mover.locator('mo')).toHaveText('˙');
        const accent = formula.locator('.katex-html .accent');
        const base = accent.locator('.vlist > span').first().locator('.mord');
        const dot = accent.locator('.accent-body > .mord');
        await expect(base).toHaveText(letter);
        await expect(dot).toHaveText('˙');
        const baseBox = (await base.boundingBox())!;
        const dotBox = (await dot.boundingBox())!;
        const dotCenter = dotBox.x + dotBox.width / 2;
        expect(dotCenter).toBeGreaterThanOrEqual(baseBox.x - 1);
        expect(dotCenter).toBeLessThanOrEqual(baseBox.x + baseBox.width + 1);
        expect(dotBox.y).toBeLessThanOrEqual(baseBox.y + 0.5);
      }
      if (focus) {
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-figure-focus-dialog]')).not.toHaveAttribute('open', '');
      }
    }
  }
  expect(scripts.filter((url) => /(?:katex|plotly)/i.test(url))).toEqual([]);
});

async function expectPaintedPanels(root: Locator, count: number) {
  const panels = root.locator('svg[data-research-panel]');
  await expect(panels).toHaveCount(count);
  const bounds = await root.boundingBox();
  expect(bounds).not.toBeNull();
  for (const panel of await panels.all()) {
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
    const coordinateFrame = await panel.evaluate((svg) => {
      const parent = svg.parentElement;
      const geometry = svg.querySelector<SVGSVGElement>('svg[viewBox]');
      const transform = geometry?.getScreenCTM();
      if (!parent?.matches('.research-panel') || !transform) {
        throw new Error('Expected the SVG geometry and labels to share a research-panel frame.');
      }
      const parentBox = parent.getBoundingClientRect();
      return {
        width: parentBox.width,
        height: parentBox.height,
        xScale: Math.hypot(transform.a, transform.b),
        yScale: Math.hypot(transform.c, transform.d),
      };
    });
    expect(box!.width, 'Outer SVG width must match the label coordinate frame').toBeCloseTo(
      coordinateFrame.width,
      1,
    );
    expect(box!.height, 'Outer SVG height must match the label coordinate frame').toBeCloseTo(
      coordinateFrame.height,
      1,
    );
    expect(coordinateFrame.xScale, 'Geometry must retain equal x/y scales').toBeCloseTo(
      coordinateFrame.yScale,
      1,
    );
    expect(box!.x).toBeGreaterThanOrEqual(bounds!.x - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
    expect(
      await panel.evaluate((svg) =>
        Array.from(svg.querySelectorAll('path, polyline, polygon, line')).some((shape) => {
          if (shape.closest('defs')) return false;
          const box = shape.getBoundingClientRect();
          const style = getComputedStyle(shape);
          return (
            (box.width > 2 || box.height > 2) &&
            style.visibility === 'visible' &&
            Number(style.opacity) > 0 &&
            (style.stroke !== 'none' || style.fill !== 'none')
          );
        }),
      ),
      'Each SVG panel must contain visible painted geometry, not just an empty viewport',
    ).toBe(true);
  }
}

async function expectLabelWithinFigure(root: Locator, text: RegExp) {
  const label = root.getByText(text).first();
  await expect(label).toBeVisible();
  const bounds = await root.boundingBox();
  const box = await label.boundingBox();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
  expect(box!.x).toBeGreaterThanOrEqual(bounds!.x - 1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
  expect(box!.y).toBeGreaterThanOrEqual(bounds!.y - 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
}

test('SSR fixed figures render without scripts in an isolated component document in either locale', async ({
  browser,
  baseURL,
  request,
}) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    for (const locale of ['en', 'zh']) {
      for (const article of articles) {
        const response = await request.get(`/${locale}/blog/${article.slug}/`);
        expect(response.ok()).toBe(true);
        const source = parseHTML(await response.text()).document;
        const isolated = parseHTML(
          '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>Static research figure component</title></head><body><main class="article-prose"></main></body></html>',
        ).document;
        isolated.documentElement.setAttribute('lang', source.documentElement.getAttribute('lang')!);

        // Keep actual emitted CSS, including inline font declarations and the
        // article-prose cascade. This is deliberately not the site's font-gated
        // page shell: it tests the server-rendered component, not no-JS routing.
        const styles = source.head.querySelectorAll('link[rel="stylesheet"], style');
        expect(styles.length, 'The source document must provide its built styles').toBeGreaterThan(
          0,
        );
        for (const style of styles) {
          const clone = style.cloneNode(true) as Element;
          if (clone.tagName === 'LINK') {
            clone.setAttribute('href', new URL(clone.getAttribute('href')!, response.url()).href);
          }
          isolated.head.append(clone);
        }
        const roots = source.querySelectorAll('[data-research-figure]');
        expect(roots.length).toBe(article.figures.length);
        for (const root of roots) {
          const figure = root.closest('figure');
          if (!figure) throw new Error('The SSR research diagram must retain its figure wrapper.');
          isolated.querySelector('main')!.append(figure.cloneNode(true));
        }
        for (const script of isolated.querySelectorAll('script')) script.remove();
        const componentUrl = new URL(
          `/__test-components/research/${locale}/${article.slug}/`,
          response.url(),
        ).href;
        await page.route(componentUrl, (route) =>
          route.fulfill({ contentType: 'text/html', body: isolated.toString() }),
        );
        await page.goto(componentUrl);
        await page.unroute(componentUrl);
        await expect(page.locator('script, [data-font-surface]')).toHaveCount(0);
        await expect(page.locator('[data-research-figure]')).toHaveCount(article.figures.length);
        for (const figure of article.figures) {
          const root = page.locator(`[data-research-figure][data-kind="${figure.kind}"]`);
          const frame = root.locator('xpath=ancestor::figure[1]');
          await expectPaintedPanels(root, figure.panels);
          await expectLabelWithinFigure(root, figure.label);
          await expect(frame.locator('figcaption')).toBeVisible();
          await expect(frame.locator('figcaption')).not.toHaveText('');
          await expect(frame.locator('astro-island, interactive-figure-status')).toHaveCount(0);
        }
      }
    }
  } finally {
    await context.close();
  }
});

test('fixed diagrams keep painted panels and labels inside narrow and wide layouts without loading Plotly', async ({
  page,
}) => {
  const plotlyRequests: string[] = [];
  page.on('request', (request) => {
    if (plotlyRuntime.test(request.url())) plotlyRequests.push(request.url());
  });
  for (const article of articles) {
    await page.goto(`/en/blog/${article.slug}/`);
    await page.evaluate(() => document.fonts.ready);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const figure of article.figures) {
        const root = page.locator(`[data-research-figure][data-kind="${figure.kind}"]`);
        await expectPaintedPanels(root, figure.panels);
        await expectLabelWithinFigure(root, figure.label);
        if (figure.kind === 'planar-heading') {
          const explanation = root.getByText('κᵣ(s) = lim Δθᵣ / Δs', { exact: true });
          const tangent = root.getByText('T(s)', { exact: true });
          await expect(explanation).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
          const backing = await root
            .locator('.research-plot-canvas')
            .evaluate((canvas) => getComputedStyle(canvas).backgroundColor);
          expect(backing, 'Vector label backing must remain opaque').not.toBe('rgba(0, 0, 0, 0)');
          await expect(tangent).toHaveCSS('background-color', backing);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width + 1,
      );
    }
    const ink = page.locator('[data-research-figure]').last().getByText('(a)', { exact: true });
    // Theme-dependent text may be SVG text or HTML; read the actual paint
    // property without requiring one label implementation.
    const readPaint = () =>
      ink.first().evaluate((label) => {
        const style = getComputedStyle(label);
        return label instanceof SVGElement ? style.fill : style.color;
      });
    const before = await readPaint();
    await page.locator('[data-theme-toggle]').first().click();
    await expect.poll(readPaint).not.toBe(before);
    await expect(page.locator('[data-plotly-figure], .plot-container')).toHaveCount(0);
  }
  expect(plotlyRequests).toEqual([]);
});

test('fixed diagrams move into focus and return with their captions and geometry intact', async ({
  page,
}) => {
  const plotlyRequests: string[] = [];
  page.on('request', (request) => {
    if (plotlyRuntime.test(request.url())) plotlyRequests.push(request.url());
  });
  for (const article of articles) {
    await page.goto(`/en/blog/${article.slug}/`);
    for (const figure of article.figures) {
      const root = page.locator(`[data-research-figure][data-kind="${figure.kind}"]`);
      const frame = root.locator('xpath=ancestor::figure[1]');
      const toggle = frame.locator('[data-figure-focus-toggle]');
      await toggle.scrollIntoViewIfNeeded();
      const original = await root.elementHandle();
      const caption = await frame.locator('figcaption').textContent();
      const before = await frame.boundingBox();
      await toggle.click();
      const dialog = page.locator('[data-figure-focus-dialog]');
      await expect(dialog).toHaveAttribute('open', '');
      expect(await original!.evaluate((element) => Boolean(element.closest('dialog[open]')))).toBe(
        true,
      );
      await expectPaintedPanels(root, figure.panels);
      await expectLabelWithinFigure(root, figure.label);
      await expect(frame.locator('figcaption')).toHaveText(caption!);
      await page.keyboard.press('Escape');
      await expect(dialog).not.toHaveAttribute('open', '');
      await expect(toggle).toBeFocused();
      expect(
        await original!.evaluate((element) => element.isConnected && !element.closest('dialog')),
      ).toBe(true);
      await expectPaintedPanels(root, figure.panels);
      await expect(frame.locator('figcaption')).toHaveText(caption!);
      const after = await frame.boundingBox();
      expect(after!.height).toBeCloseTo(before!.height, 1);
      expect(after!.width).toBeCloseTo(before!.width, 1);
      await original!.dispose();
    }
  }
  expect(plotlyRequests).toEqual([]);
});
