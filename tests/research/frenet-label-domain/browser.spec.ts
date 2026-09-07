import { expect, test, type Locator } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

const labelTexts = new Set(['Δs', 'd', 'Δℓ', 'φ']);

type Rect = {
  text: string;
  top: number;
  right: number;
  bottom: number;
  left: number;
};

async function renderedLabelRects(plot: Locator): Promise<{ container: Rect; labels: Rect[] }> {
  return plot.evaluate(
    (element, expectedLabels) => {
      const expected = new Set(expectedLabels);
      const rect = (target: Element, text: string): Rect => {
        const bounds = target.getBoundingClientRect();
        return {
          text,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          left: bounds.left,
        };
      };
      return {
        container: rect(element, 'geometry plot'),
        labels: Array.from(element.querySelectorAll('svg text')).flatMap((text) => {
          const value = text.textContent?.trim() ?? '';
          return expected.has(value) ? [rect(text, value)] : [];
        }),
      };
    },
    [...labelTexts],
  );
}

function expectVisibleAndSeparate({
  container,
  labels,
}: {
  container: Rect;
  labels: Rect[];
}): void {
  expect(labels.map(({ text }) => text).sort()).toEqual([...labelTexts].sort());
  labels.forEach((label) => {
    expect(label.right - label.left, `${label.text} has no rendered width`).toBeGreaterThan(0);
    expect(label.bottom - label.top, `${label.text} has no rendered height`).toBeGreaterThan(0);
    expect(label.left, `${label.text} crosses the left plot edge`).toBeGreaterThanOrEqual(
      container.left - 1,
    );
    expect(label.right, `${label.text} crosses the right plot edge`).toBeLessThanOrEqual(
      container.right + 1,
    );
    expect(label.top, `${label.text} crosses the top plot edge`).toBeGreaterThanOrEqual(
      container.top - 1,
    );
    expect(label.bottom, `${label.text} crosses the bottom plot edge`).toBeLessThanOrEqual(
      container.bottom + 1,
    );
  });

  for (let first = 0; first < labels.length; first += 1) {
    for (let second = first + 1; second < labels.length; second += 1) {
      const a = labels[first]!;
      const b = labels[second]!;
      const separate =
        a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      expect(separate, `${a.text} and ${b.text} overlap in rendered pixels`).toBe(true);
    }
  }
}

for (const sample of [
  { name: 'wide positive extremes', width: 1440, key: 'End', phi: '30.00°', d: '0.5000' },
  { name: 'narrow negative extremes', width: 620, key: 'Home', phi: '-30.00°', d: '-0.5000' },
] as const) {
  test(`rendered geometry labels remain readable at ${sample.name}`, async ({ page }) => {
    await page.setViewportSize({ width: sample.width, height: 900 });
    await page.goto('/en/blog/frenet-arc-length-conversion/');
    const explorer = page.locator('[data-frenet-explorer="kappa"]').first();
    await explorer.scrollIntoViewIfNeeded();
    const geometryPlot = explorer.locator('.frenet-geometry-plot');
    await expect(geometryPlot.locator('.plot-container')).toBeVisible({ timeout: 30_000 });

    for (const variable of ['phi', 'd'] as const) {
      const slider = explorer.locator(
        `[data-frenet-control="${variable}"] .frenet-slider-thumb[role="slider"]`,
      );
      await slider.focus();
      await slider.press(sample.key);
    }
    await expect(explorer.locator('[data-frenet-status]')).toContainText(`φ=${sample.phi}`);
    await expect(explorer.locator('[data-frenet-status]')).toContainText(`d=${sample.d}`);
    await expect
      .poll(() => renderedLabelRects(geometryPlot).then(({ labels }) => labels.length))
      .toBe(4);
    expectVisibleAndSeparate(await renderedLabelRects(geometryPlot));

    const figure = explorer.locator('xpath=ancestor::figure[@data-figure-focus][1]');
    const caption = figure.locator(':scope > figcaption');
    await expect(caption).toHaveCount(1);
    const attribution = await figure.evaluate((element) => {
      const explorerElement = element.querySelector<HTMLElement>('[data-frenet-explorer]');
      const captionElement = element.querySelector<HTMLElement>(':scope > figcaption');
      if (!explorerElement || !captionElement) throw new Error('Missing figure attribution nodes.');
      const figureBox = element.getBoundingClientRect();
      const explorerBox = explorerElement.getBoundingClientRect();
      const captionBox = captionElement.getBoundingClientRect();
      return {
        directChild: captionElement.parentElement === element,
        captionAfterPlot: captionBox.top >= explorerBox.bottom - 1,
        captionInsideFigure:
          captionBox.top >= figureBox.top - 1 && captionBox.bottom <= figureBox.bottom + 1,
      };
    });
    expect(attribution).toEqual({
      directChild: true,
      captionAfterPlot: true,
      captionInsideFigure: true,
    });
  });
}
