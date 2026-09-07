import { expect, test } from '@playwright/test';

const blogPath = '/en/blog/';

test('sidebar scrolling is independent and restores in sampled frames after refresh', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(blogPath);

  const panel = page.locator('[data-blog-mobile-panel]');
  const pageY = await page.evaluate(() => scrollY);
  await panel.hover();
  await page.mouse.wheel(0, 240);
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(pageY);

  await panel.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  const pageYBeforeBoundaryWheel = await page.evaluate(() => scrollY);
  await panel.hover();
  await page.mouse.wheel(0, 240);
  expect(await page.evaluate(() => scrollY)).toBe(pageYBeforeBoundaryWheel);

  const savedPanelY = await panel.evaluate((element) => element.scrollTop);
  await page.locator('[data-blog-results]').hover();
  await page.mouse.wheel(0, 240);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(pageY);
  expect(await panel.evaluate((element) => element.scrollTop)).toBe(savedPanelY);
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

  await page.locator('[data-blog-article]:not([hidden]) h2 a').first().click();
  await expect(page).toHaveURL(/\/en\/blog\/[^?]+\/$/);
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[data-blog-listing]')) return;
      observer.disconnect();
      const samples: number[] = [];
      const sample = () => {
        const region = document.querySelector<HTMLElement>(
          '[data-scroll-region="blog-sidebar-tags"]',
        );
        if (region) samples.push(region.scrollTop);
        if (samples.length < 8) requestAnimationFrame(sample);
        else document.documentElement.dataset.blogSidebarTraversalSamples = JSON.stringify(samples);
      };
      requestAnimationFrame(sample);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });

  await page.goBack();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect(page.locator('html')).toHaveAttribute('data-blog-sidebar-traversal-samples', /\[/);
  const traversalSamples = await page
    .locator('html')
    .evaluate((root) =>
      JSON.parse((root as HTMLElement).dataset.blogSidebarTraversalSamples ?? '[]'),
    );
  expect(traversalSamples).toHaveLength(8);
  expect(traversalSamples.every((value: number) => value === savedPanelY)).toBe(true);
});
