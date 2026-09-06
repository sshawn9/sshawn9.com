import { expect, test, type Page } from '@playwright/test';

const blogPath = '/en/blog/';

async function readSidebarFrames(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __blogSidebarFrameProbe?: { complete: boolean };
            }
          ).__blogSidebarFrameProbe?.complete ?? false,
      ),
    )
    .toBe(true);

  return page.evaluate(
    () =>
      (
        window as Window & {
          __blogSidebarFrameProbe?: {
            frames: Array<{
              resultsOffset: number;
              sidebarWidth: number;
              boundaryVisible: boolean;
              animating: boolean;
            }>;
          };
        }
      ).__blogSidebarFrameProbe?.frames ?? [],
  );
}

test('the desktop sidebar resizes, collapses, and restores its geometry in sampled frames after first contentful paint', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(blogPath);

  const layout = page.locator('[data-blog-sidebar-layout]');
  const sidebar = page.locator('#blog-sidebar');
  await expect(sidebar).toHaveAccessibleName('Article tags');
  const results = page.locator('[data-blog-results]');
  const resizer = page.getByRole('separator', { name: 'Resize blog sidebar' });
  const collapse = page.getByRole('button', { name: 'Collapse blog sidebar' });

  const initialSidebar = await sidebar.boundingBox();
  const initialResults = await results.boundingBox();
  expect(initialSidebar).not.toBeNull();
  expect(initialResults).not.toBeNull();
  expect(initialSidebar!.width).toBeCloseTo(272, 0);
  expect(initialResults!.x - initialSidebar!.x - initialSidebar!.width).toBeCloseTo(40, 0);

  const resizerBox = await resizer.boundingBox();
  expect(resizerBox).not.toBeNull();
  const dragX = resizerBox!.x + resizerBox!.width / 2;
  const dragY = resizerBox!.y + Math.min(resizerBox!.height / 2, 220);
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX + 48, dragY, { steps: 4 });
  await page.mouse.up();
  await expect(resizer).toHaveAttribute('aria-valuenow', '320');

  await resizer.focus();
  await resizer.press('Home');
  await expect(resizer).toHaveAttribute('aria-valuenow', '208');
  await resizer.press('End');
  await expect(resizer).toHaveAttribute('aria-valuenow', '400');

  const resetBox = await resizer.boundingBox();
  expect(resetBox).not.toBeNull();
  await page.mouse.move(resetBox!.x + resetBox!.width / 2, dragY);
  await page.mouse.down();
  await page.mouse.move(resetBox!.x + resetBox!.width / 2 - 80, dragY, { steps: 4 });
  await page.mouse.up();
  await expect(resizer).toHaveAttribute('aria-valuenow', '320');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('blog-sidebar-layout')))
    .toBe('{"collapsed":false,"width":320}');

  await page.addInitScript(() => {
    const probe = {
      frames: [] as Array<{
        resultsOffset: number;
        sidebarWidth: number;
        boundaryVisible: boolean;
        animating: boolean;
      }>,
      complete: false,
      attempts: 0,
    };
    Object.defineProperty(window, '__blogSidebarFrameProbe', {
      configurable: true,
      value: probe,
    });

    const sample = () => {
      probe.attempts += 1;
      const layout = document.querySelector<HTMLElement>('[data-blog-sidebar-layout]');
      const sidebar = document.querySelector<HTMLElement>('#blog-sidebar');
      const results = document.querySelector<HTMLElement>('[data-blog-results]');
      const boundary = document.querySelector<HTMLElement>('[data-blog-sidebar-boundary]');
      if (layout && sidebar && results && boundary) {
        const layoutBox = layout.getBoundingClientRect();
        const sidebarBox = sidebar.getBoundingClientRect();
        const resultsBox = results.getBoundingClientRect();
        const round = (value: number) => Math.round(value * 100) / 100;
        probe.frames.push({
          resultsOffset: round(resultsBox.x - layoutBox.x),
          sidebarWidth: round(sidebarBox.width),
          boundaryVisible: boundary.getClientRects().length > 0,
          animating: layout.hasAttribute('data-sidebar-animating'),
        });
      }
      if (probe.frames.length >= 8 || probe.attempts >= 120) {
        probe.complete = true;
        return;
      }
      requestAnimationFrame(sample);
    };
    const paintObserver = new PerformanceObserver((entries, observer) => {
      if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      observer.disconnect();
      requestAnimationFrame(sample);
    });
    paintObserver.observe({ type: 'paint', buffered: true });
  });

  await page.reload();
  const expandedFrames = await readSidebarFrames(page);
  expect(expandedFrames).toHaveLength(8);
  expect(expandedFrames.every((frame) => frame.resultsOffset === 360)).toBe(true);
  expect(expandedFrames.every((frame) => frame.sidebarWidth === 320)).toBe(true);
  expect(expandedFrames.every((frame) => frame.boundaryVisible && !frame.animating)).toBe(true);

  await collapse.click();
  await expect(layout).toHaveAttribute('data-sidebar-collapsed', '');
  await expect(sidebar).toHaveAttribute('inert', '');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('blog-sidebar-layout')))
    .toBe('{"collapsed":true,"width":320}');

  await page.reload();
  const collapsedFrames = await readSidebarFrames(page);
  expect(collapsedFrames).toHaveLength(8);
  expect(collapsedFrames.every((frame) => frame.resultsOffset === 40)).toBe(true);
  expect(collapsedFrames.every((frame) => frame.sidebarWidth === 320)).toBe(true);
  expect(collapsedFrames.every((frame) => !frame.boundaryVisible && !frame.animating)).toBe(true);
  await expect(page.getByRole('button', { name: 'Expand blog sidebar' })).toBeVisible();
});
