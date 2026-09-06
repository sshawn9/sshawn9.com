import { expect, test } from '@playwright/test';

const blogPath = '/en/blog/';

test('sidebar scrolling is independent and restores in sampled frames after refresh', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(blogPath);

  const panel = page.locator('[data-blog-mobile-panel]');
  const pageY = await page.evaluate(() => scrollY);
  await panel.evaluate((element) => element.scrollTo(0, 240));
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const savedPanelY = await panel.evaluate((element) => element.scrollTop);
  expect(await page.evaluate(() => scrollY)).toBe(pageY);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (history.state as { sshawn9?: { regions?: Record<string, { y?: number }> } } | null)
            ?.sshawn9?.regions?.['blog-sidebar-tags']?.y ?? 0,
      ),
    )
    .toBe(savedPanelY);

  await page.addInitScript(() => {
    const values: number[] = [];
    Object.defineProperty(window, '__blogScrollFrameProbe', {
      configurable: true,
      value: { values, complete: false },
    });
    const sample = () => {
      const panel = document.querySelector<HTMLElement>('[data-scroll-region="blog-sidebar-tags"]');
      if (panel) values.push(panel.scrollTop);
      if (values.length >= 8) {
        (
          window as Window & { __blogScrollFrameProbe?: { complete: boolean } }
        ).__blogScrollFrameProbe!.complete = true;
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
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __blogScrollFrameProbe?: { complete: boolean };
            }
          ).__blogScrollFrameProbe?.complete ?? false,
      ),
    )
    .toBe(true);
  const restoredFrames = await page.evaluate(
    () =>
      (
        window as Window & {
          __blogScrollFrameProbe?: { values: number[] };
        }
      ).__blogScrollFrameProbe?.values ?? [],
  );
  expect(restoredFrames).toHaveLength(8);
  expect(restoredFrames.every((value) => value === savedPanelY)).toBe(true);
});
