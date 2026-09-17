import { expect, test, type Locator } from '@playwright/test';
import { parseHTML } from 'linkedom';

test.describe.configure({ timeout: 60_000 });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/wallpapers**', (route) => route.fulfill({ status: 503, body: '{}' }));
});

const articles = [
  {
    slug: 'planar-frenet-frame',
    figures: [
      { kind: 'planar-curvature-signs', panels: 3, labels: [4, 4, 4], label: /^K\s*=\s*0$/ },
      { kind: 'planar-heading', panels: 2, labels: [3, 4], label: /^T\s*\(s\)$/ },
    ],
  },
  {
    slug: 'frenet-vehicle-kinematics',
    figures: [
      { kind: 'vehicle-state', panels: 1, labels: [5], label: /^d$/ },
      { kind: 'vehicle-velocity', panels: 2, labels: [4, 4], label: /^v\s*cos\s*φ\s*T$/ },
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

async function expectAllCardLabelsReadable(
  root: Locator,
  expectedLabels: readonly number[],
  wrapped = false,
) {
  const result = await root.evaluate((element) => {
    const cards = Array.from(element.querySelectorAll<HTMLElement>('.research-panel-slot'));
    const failures: string[] = [];
    const selector = '.research-label, .research-panel-title, .research-panel-note';
    const labelCounts: number[] = [];
    const boundaries: DOMRect[] = [];
    cards.forEach((card, cardIndex) => {
      const boundary = card.getBoundingClientRect();
      boundaries.push(boundary);
      // Only outer labels are compared. KaTeX's nested boxes and hidden MathML
      // represent the same formula, not separate overlapping annotations.
      const labels = Array.from(card.querySelectorAll<HTMLElement>(selector)).filter(
        (label) => !label.parentElement?.closest(selector),
      );
      labelCounts.push(labels.length);
      if (labels.length === 0) failures.push(`Panel ${cardIndex + 1} has no labels`);
      const measured = labels.map((label) => {
        const text = label.querySelector('annotation')?.textContent ?? label.textContent ?? '';
        const name = `Panel ${cardIndex + 1}: ${text.trim()}`;
        const box = label.getBoundingClientRect();
        const style = getComputedStyle(label);
        if (
          box.width <= 0 ||
          box.height <= 0 ||
          style.visibility !== 'visible' ||
          Number(style.opacity) === 0
        ) {
          failures.push(`${name} has no visible label box`);
        }
        const withinCard = (rect: DOMRect) =>
          rect.left >= boundary.left - 1 &&
          rect.right <= boundary.right + 1 &&
          rect.top >= boundary.top - 1 &&
          rect.bottom <= boundary.bottom + 1;
        if (!withinCard(box)) failures.push(`${name} extends outside its own panel card`);
        if (label.clientWidth > 0 && label.scrollWidth > label.clientWidth + 1) {
          failures.push(`${name} has overflowing or clipped horizontal content`);
        }
        // A constrained outer span can fit while its unwrapped formula still
        // overflows. Check actual visible text ranges against the same card.
        const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement;
          if (!node.textContent?.trim() || parent?.closest('.katex-mathml')) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          if (
            Array.from(range.getClientRects()).some((rect) => rect.width > 0 && !withinCard(rect))
          ) {
            failures.push(`${name} has painted text outside its own panel card`);
            break;
          }
        }
        return { name, box };
      });
      for (let i = 0; i < measured.length; i += 1) {
        for (let j = i + 1; j < measured.length; j += 1) {
          const a = measured[i];
          const b = measured[j];
          const width = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
          const height = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
          const smallerArea = Math.min(a.box.width * a.box.height, b.box.width * b.box.height);
          if (width > 2 && height > 2 && width * height > smallerArea * 0.1) {
            failures.push(
              `${a.name} overlaps ${b.name} by ${width.toFixed(1)} x ${height.toFixed(1)}px`,
            );
          }
        }
      }
    });
    const stacked = boundaries.some((a, index) =>
      boundaries
        .slice(index + 1)
        .some(
          (b) =>
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            (b.top >= a.bottom - 1 || a.top >= b.bottom - 1),
        ),
    );
    return { cards: cards.length, labels: labelCounts, stacked, failures };
  });
  expect(result.cards).toBe(expectedLabels.length);
  // These counts are independent fixture expectations, not derived from the
  // rendering model: removing a difficult label must not make this test pass.
  expect(result.labels, 'Each subpanel must retain all its labels, title, and notes').toEqual(
    expectedLabels,
  );
  expect(result.failures, (await root.getAttribute('data-kind')) ?? 'Research figure').toEqual([]);
  if (wrapped && expectedLabels.length > 1) {
    expect(result.stacked, 'Narrow available width must wrap subpanels onto separate rows').toBe(
      true,
    );
  }
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

for (const article of articles) {
  test(`${article.slug}: fixed diagrams keep painted panels and labels inside narrow and wide layouts without loading Plotly`, async ({
    page,
  }) => {
    const plotlyRequests: string[] = [];
    page.on('request', (request) => {
      if (plotlyRuntime.test(request.url())) plotlyRequests.push(request.url());
    });
    // Preserve the original layout coverage without inheriting another article's theme toggle.
    await page.emulateMedia({
      colorScheme: article.slug === 'planar-frenet-frame' ? 'light' : 'dark',
    });
    await page.goto(`/en/blog/${article.slug}/`);
    await page.evaluate(() => document.fonts.ready);
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const figure of article.figures) {
        const root = page.locator(`[data-research-figure][data-kind="${figure.kind}"]`);
        await expectPaintedPanels(root, figure.panels);
        await expectLabelWithinFigure(root, figure.label);
        await expectAllCardLabelsReadable(root, figure.labels, width < 400);
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
    // The layout must respond to its own available width, not just the viewport.
    const prose = page.locator('.article-prose');
    const previousWidth = await prose.evaluate((element: HTMLElement) => element.style.maxWidth);
    try {
      // Current grid wrap thresholds include the frame border, padding and gaps.
      // Check both sides: a newly wrapped row must still fit every annotation.
      const widths = [360, ...[514, 642, 770].flatMap((width) => [width - 1, width, width + 1])];
      for (const width of widths) {
        await prose.evaluate((element: HTMLElement, value) => {
          element.style.maxWidth = `${value}px`;
        }, width);
        for (const figure of article.figures) {
          const root = page.locator(`[data-research-figure][data-kind="${figure.kind}"]`);
          expect((await root.boundingBox())!.width).toBeLessThanOrEqual(width);
          await expectPaintedPanels(root, figure.panels);
          await expectAllCardLabelsReadable(root, figure.labels, width === 360);
        }
      }
    } finally {
      await prose.evaluate((element: HTMLElement, value) => {
        element.style.maxWidth = value;
      }, previousWidth);
    }
    if (article.slug === 'planar-frenet-frame') {
      const resizer = page.getByRole('separator', { name: 'Resize article sidebar' });
      await resizer.focus();
      await resizer.press('End');
      await expect(resizer).toHaveAttribute('aria-valuenow', '352');
      for (const figure of article.figures) {
        const root = page.locator(`[data-research-figure][data-kind="${figure.kind}"]`);
        await expectPaintedPanels(root, figure.panels);
        await expectAllCardLabelsReadable(root, figure.labels);
      }
      const first = page.locator('[data-research-figure][data-kind="planar-curvature-signs"]');
      const beforeCollapse = (await first.boundingBox())!.width;
      await page.getByRole('button', { name: 'Collapse article sidebar' }).click();
      await expect(page.locator('[data-article-sidebar-layout]')).toHaveAttribute(
        'data-sidebar-collapsed',
        '',
      );
      await expect
        .poll(async () => (await first.boundingBox())!.width)
        .toBeGreaterThan(beforeCollapse);
      for (const figure of article.figures) {
        const root = page.locator(`[data-research-figure][data-kind="${figure.kind}"]`);
        await expectPaintedPanels(root, figure.panels);
        await expectAllCardLabelsReadable(root, figure.labels);
      }
      await page.getByRole('button', { name: 'Expand article sidebar' }).click();
    }
    await expect(page.locator('[data-plotly-figure], .plot-container')).toHaveCount(0);
    expect(plotlyRequests).toEqual([]);
  });

  test(`${article.slug}: fixed diagram labels follow light and dark theme changes without loading Plotly`, async ({
    page,
  }) => {
    const plotlyRequests: string[] = [];
    page.on('request', (request) => {
      if (plotlyRuntime.test(request.url())) plotlyRequests.push(request.url());
    });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`/en/blog/${article.slug}/`);
    await page.evaluate(() => document.fonts.ready);
    const ink = page.locator('[data-research-figure]').last().getByText('(a)', { exact: true });
    // Theme-dependent text may be SVG text or HTML; read the actual paint
    // property without requiring one label implementation.
    const readPaint = () =>
      ink.first().evaluate((label) => {
        const style = getComputedStyle(label);
        return label instanceof SVGElement ? style.fill : style.color;
      });
    for (const theme of ['dark', 'light']) {
      const before = await readPaint();
      await page.locator('[data-theme-toggle]').first().click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect.poll(readPaint).not.toBe(before);
    }
    await expect(page.locator('[data-plotly-figure], .plot-container')).toHaveCount(0);
    expect(plotlyRequests).toEqual([]);
  });
}

test('narrow figure focus starts at the top, exposes close, and restores the page after reaching the caption', async ({
  page,
}) => {
  for (const [index, article] of articles.entries()) {
    await page.setViewportSize({ width: index === 0 ? 320 : 390, height: 844 });
    await page.goto(`/en/blog/${article.slug}/`);
    await page.evaluate(() => document.fonts.ready);
    for (const figure of article.figures) {
      const root = page.locator(`[data-research-figure][data-kind="${figure.kind}"]`);
      const frame = root.locator('xpath=ancestor::figure[1]');
      const toggle = frame.locator('[data-figure-focus-toggle]');
      await toggle.scrollIntoViewIfNeeded();
      const before = await frame.evaluate((element) => ({
        scrollY,
        documentTop: element.getBoundingClientRect().top + scrollY,
        height: element.getBoundingClientRect().height,
      }));
      await toggle.click();
      const dialog = page.locator('[data-figure-focus-dialog]');
      await expect(dialog).toHaveAttribute('open', '');
      await expect(toggle).toBeInViewport({ ratio: 1 });
      expect(
        await toggle.evaluate((button) => {
          const box = button.getBoundingClientRect();
          return button.contains(
            document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
          );
        }),
        'The top close button must be directly hittable',
      ).toBe(true);
      const opening = await frame.evaluate((element) => ({
        scrollTop: element.closest('dialog')!.scrollTop,
        firstCardTop: element.querySelector('.research-panel-slot')!.getBoundingClientRect().top,
      }));
      expect(
        opening.scrollTop,
        'Opening focus must not jump down to the caption or last panel',
      ).toBeLessThanOrEqual(1);
      expect(opening.firstCardTop).toBeGreaterThanOrEqual(0);
      expect(opening.firstCardTop).toBeLessThan(844);
      await expectPaintedPanels(root, figure.panels);
      await expectAllCardLabelsReadable(root, figure.labels, true);
      const caption = frame.locator('figcaption');
      await caption.scrollIntoViewIfNeeded();
      await expect(caption).toBeInViewport({ ratio: 1 });
      await expect(caption).not.toHaveText('');
      await expect(toggle).toBeInViewport({ ratio: 1 });
      expect(
        await toggle.evaluate((button) => {
          const box = button.getBoundingClientRect();
          return button.contains(
            document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
          );
        }),
        'The sticky close button must remain directly hittable at the caption',
      ).toBe(true);
      await toggle.click();
      await expect(dialog).not.toHaveAttribute('open', '');
      await expect(toggle).toBeFocused();
      await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before.scrollY, 1);
      const restored = await frame.evaluate((element) => ({
        documentTop: element.getBoundingClientRect().top + scrollY,
        height: element.getBoundingClientRect().height,
      }));
      expect(restored.documentTop).toBeCloseTo(before.documentTop, 1);
      expect(restored.height).toBeCloseTo(before.height, 1);
    }
  }
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
