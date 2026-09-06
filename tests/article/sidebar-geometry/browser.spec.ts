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
