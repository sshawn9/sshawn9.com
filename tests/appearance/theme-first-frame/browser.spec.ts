import { expect, test } from '@playwright/test';

const articlePath = '/en/blog/git-operations-reference/';

test('theme and article geometry stay stable in the sampled frames after first contentful paint', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'dark');
    const state = window as Window & {
      __foundationFrameProbe?: {
        frames: Array<{
          theme?: string;
          fontState?: string;
          fontFamily: string;
          width: number;
          height: number;
        }>;
        complete: boolean;
        attempts: number;
      };
    };
    state.__foundationFrameProbe = { frames: [], complete: false, attempts: 0 };

    const sample = () => {
      const probe = state.__foundationFrameProbe!;
      probe.attempts += 1;
      const heading = document.querySelector<HTMLElement>('.article-header h1');
      if (heading) {
        const box = heading.getBoundingClientRect();
        probe.frames.push({
          theme: document.documentElement.dataset.theme,
          fontState: document.documentElement.dataset.fontState,
          fontFamily: getComputedStyle(heading).fontFamily,
          width: box.width,
          height: box.height,
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

  await page.goto(articlePath);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(page.locator('#initial-frame-ready')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as Window & { __foundationFrameProbe?: { complete: boolean } })
            .__foundationFrameProbe?.complete,
        ),
      ),
    )
    .toBe(true);

  const frames = await page.evaluate(
    () =>
      (
        window as Window & {
          __foundationFrameProbe?: {
            frames: Array<{
              theme?: string;
              fontState?: string;
              fontFamily: string;
              width: number;
              height: number;
            }>;
          };
        }
      ).__foundationFrameProbe?.frames ?? [],
  );
  expect(frames).toHaveLength(8);
  expect(frames.every((frame) => frame.theme === 'dark')).toBe(true);
  expect(frames.every((frame) => frame.fontState === frames[0]?.fontState)).toBe(true);
  expect(frames.every((frame) => frame.fontFamily.includes('Manrope Variable'))).toBe(true);
  expect(
    Math.max(...frames.map((frame) => frame.width)) -
      Math.min(...frames.map((frame) => frame.width)),
  ).toBeLessThan(0.25);
  expect(
    Math.max(...frames.map((frame) => frame.height)) -
      Math.min(...frames.map((frame) => frame.height)),
  ).toBeLessThan(0.25);
});
