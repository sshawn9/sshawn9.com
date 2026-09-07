import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

const plotlyRuntime = /\/plotly-gl3d\.min\.[^/]+\.js(?:\?|$)/;

type FigureGeometry = {
  figureTop: number;
  figureHeight: number;
  followingTop: number;
};

async function figureGeometry(figure: Locator): Promise<FigureGeometry> {
  return figure.evaluate((element) => {
    const following = element.nextElementSibling;
    if (!(following instanceof HTMLElement)) throw new Error('Missing content after figure.');
    const figureBox = element.getBoundingClientRect();
    const followingBox = following.getBoundingClientRect();
    return {
      figureTop: figureBox.top + scrollY,
      figureHeight: figureBox.height,
      followingTop: followingBox.top + scrollY,
    };
  });
}

function expectStableGeometry(before: FigureGeometry, after: FigureGeometry): void {
  expect(after.figureTop).toBeCloseTo(before.figureTop, 1);
  expect(after.figureHeight).toBeCloseTo(before.figureHeight, 1);
  expect(after.followingTop).toBeCloseTo(before.followingTop, 1);
}

async function holdPlotlyRequest(page: Page): Promise<{
  requested: Promise<void>;
  release(action: 'continue' | 'abort'): void;
}> {
  let reportRequested!: () => void;
  let releaseRequest!: (action: 'continue' | 'abort') => void;
  const requested = new Promise<void>((resolve) => {
    reportRequested = resolve;
  });
  const gate = new Promise<'continue' | 'abort'>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(plotlyRuntime, async (route: Route) => {
    reportRequested();
    const action = await gate;
    if (action === 'continue') await route.continue();
    else await route.abort();
  });
  return { requested, release: releaseRequest };
}

test('loading the Plotly runtime does not move the following article content', async ({ page }) => {
  const runtime = await holdPlotlyRequest(page);
  await page.goto('/en/blog/frenet-arc-length-conversion/');
  const figure = page.locator('[data-figure-focus]').first();
  await figure.scrollIntoViewIfNeeded();
  await runtime.requested;
  await expect(figure.locator('.frenet-plot-shell')).toHaveAttribute('aria-busy', 'true');
  const before = await figureGeometry(figure);

  runtime.release('continue');
  await expect(figure.locator('.frenet-main-plot .plot-container')).toBeVisible({
    timeout: 30_000,
  });
  await expect(figure.locator('.frenet-plot-shell')).toHaveAttribute('aria-busy', 'false');
  expectStableGeometry(before, await figureGeometry(figure));
});

test('a Plotly runtime failure replaces the reserved region without moving the article', async ({
  page,
}) => {
  const runtime = await holdPlotlyRequest(page);
  await page.goto('/en/blog/frenet-arc-length-conversion/');
  const figure = page.locator('[data-figure-focus]').first();
  await figure.scrollIntoViewIfNeeded();
  await runtime.requested;
  await expect(figure.locator('.frenet-plot-shell')).toHaveAttribute('aria-busy', 'true');
  const before = await figureGeometry(figure);

  runtime.release('abort');
  await expect(figure.locator('interactive-figure-status')).toHaveAttribute('data-state', 'error');
  await expect(figure.locator('.frenet-plot-error')).toBeVisible();
  expectStableGeometry(before, await figureGeometry(figure));
});
