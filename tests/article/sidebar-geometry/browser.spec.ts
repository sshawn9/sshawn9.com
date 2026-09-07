import { expect, test } from '@playwright/test';

const articlePath = '/en/blog/git-operations-reference/';

test('the article sidebar resizes, collapses, and restores consistently in sampled frames after first contentful paint', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(articlePath);

  const layout = page.locator('[data-article-sidebar-layout]');
  const sidebar = page.locator('#article-sidebar');
  const resizer = page.getByRole('separator', { name: 'Resize article sidebar' });
  await expect(sidebar).toHaveAccessibleName('Article information and navigation');
  await expect(resizer).toHaveAttribute('aria-valuenow', '224');

  await resizer.focus();
  await resizer.press('End');
  await expect(resizer).toHaveAttribute('aria-valuenow', '352');
  await resizer.press('ArrowRight');
  await resizer.press('ArrowRight');
  await expect(resizer).toHaveAttribute('aria-valuenow', '320');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('article-sidebar-layout')))
    .toBe('{"collapsed":false,"width":320}');

  await page.getByRole('button', { name: 'Collapse article sidebar' }).click();
  await expect(layout).toHaveAttribute('data-sidebar-collapsed', '');
  await expect(sidebar).toHaveAttribute('inert', '');

  await page.addInitScript(() => {
    const probe = { frames: [] as Array<{ collapsed: boolean; track: string }>, attempts: 0 };
    Object.defineProperty(window, '__articleSidebarFrameProbe', {
      configurable: true,
      value: probe,
    });
    const sample = () => {
      probe.attempts += 1;
      const layout = document.querySelector<HTMLElement>('[data-article-sidebar-layout]');
      if (layout) {
        probe.frames.push({
          collapsed: document.documentElement.hasAttribute('data-article-sidebar-collapsed'),
          track: getComputedStyle(layout).gridTemplateColumns,
        });
      }
      if (probe.frames.length < 8 && probe.attempts < 120) requestAnimationFrame(sample);
    };
    const observer = new PerformanceObserver((entries, paintObserver) => {
      if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      paintObserver.disconnect();
      requestAnimationFrame(sample);
    });
    observer.observe({ type: 'paint', buffered: true });
  });

  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __articleSidebarFrameProbe?: { frames: Array<{ collapsed: boolean }> };
            }
          ).__articleSidebarFrameProbe?.frames.length ?? 0,
      ),
    )
    .toBe(8);
  const frames = await page.evaluate(
    () =>
      (
        window as Window & {
          __articleSidebarFrameProbe?: {
            frames: Array<{ collapsed: boolean; track: string }>;
          };
        }
      ).__articleSidebarFrameProbe?.frames ?? [],
  );
  expect(frames.every((frame) => frame.collapsed)).toBe(true);
  expect(frames.every((frame) => frame.track.endsWith('0px'))).toBe(true);

  await page.setViewportSize({ width: 760, height: 900 });
  await expect(layout).not.toHaveAttribute('data-sidebar-collapsed', '');
  await expect(page.locator('.article-mobile-support')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('button', { name: 'Expand article sidebar' })).toBeVisible();
});

for (const viewport of [
  { height: 520, headerPosition: 'sticky' },
  { height: 500, headerPosition: 'relative' },
] as const) {
  test(`the article sidebar remains usable at a ${viewport.height}px viewport and stops before the footer`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: viewport.height });
    await page.goto(articlePath);
    await expect(page.locator('.site-header')).toHaveCSS('position', viewport.headerPosition);

    await page.evaluate(() => scrollTo({ top: 800, behavior: 'instant' }));
    const readingGeometry = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>('.article-sidebar-shell');
      const control = document.querySelector<HTMLElement>('.article-sidebar-controls button');
      if (!sidebar || !control) throw new Error('Expected article sidebar fixtures');
      return {
        sidebar: sidebar.getBoundingClientRect().toJSON(),
        control: control.getBoundingClientRect().toJSON(),
        viewportHeight: innerHeight,
      };
    });
    expect(readingGeometry.sidebar.top).toBeGreaterThanOrEqual(0);
    expect(readingGeometry.sidebar.bottom).toBeLessThanOrEqual(readingGeometry.viewportHeight);
    expect(readingGeometry.control.top).toBeGreaterThanOrEqual(0);
    expect(readingGeometry.control.bottom).toBeLessThanOrEqual(readingGeometry.viewportHeight);

    await page.evaluate(() =>
      scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
    );
    const footerGeometry = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>('.article-sidebar-shell');
      const control = document.querySelector<HTMLElement>('.article-sidebar-controls button');
      const footer = document.querySelector<HTMLElement>('.site-footer');
      if (!sidebar || !control || !footer) throw new Error('Expected article boundary fixtures');
      return {
        sidebar: sidebar.getBoundingClientRect().toJSON(),
        control: control.getBoundingClientRect().toJSON(),
        footer: footer.getBoundingClientRect().toJSON(),
        viewportHeight: innerHeight,
      };
    });
    expect(footerGeometry.sidebar.bottom).toBeLessThanOrEqual(footerGeometry.footer.top + 1);
    expect(footerGeometry.control.top).toBeGreaterThanOrEqual(0);
    expect(footerGeometry.control.bottom).toBeLessThanOrEqual(footerGeometry.viewportHeight);
  });
}
