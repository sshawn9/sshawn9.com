import { expect, test } from '@playwright/test';

const articlePath = '/en/blog/git-operations-reference/';

type FoundationFrame = {
  theme?: string;
  fontState?: string;
  surfaceVisible: boolean;
  progressOpacity: number;
  progressAnimationEnabled: boolean;
  fontFamily: string;
  width: number;
  height: number;
};

test('theme, font gate and article geometry are coherent in every sampled frame after FCP', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'dark');
    const state = window as Window & {
      __foundationFrameProbe?: {
        frames: FoundationFrame[];
        complete: boolean;
        attempts: number;
      };
    };
    state.__foundationFrameProbe = { frames: [], complete: false, attempts: 0 };

    const opacity = (element: HTMLElement | null): number => {
      if (!element) return 0;
      let result = 1;
      for (let current: HTMLElement | null = element; current; current = current.parentElement) {
        result *= Number.parseFloat(getComputedStyle(current).opacity) || 0;
      }
      return result;
    };
    const sample = () => {
      const probe = state.__foundationFrameProbe!;
      probe.attempts += 1;
      const heading = document.querySelector<HTMLElement>('[data-article-page] .article-header h1');
      const surface = document.querySelector<HTMLElement>('[data-font-surface].page-outlet');
      const progress = document.querySelector<HTMLElement>('.navigation-progress');
      if (heading && surface && progress) {
        const headingBox = heading.getBoundingClientRect();
        const surfaceStyle = getComputedStyle(surface);
        const progressStyle = getComputedStyle(progress);
        probe.frames.push({
          theme: document.documentElement.dataset.theme,
          fontState: document.documentElement.dataset.fontState,
          surfaceVisible:
            surfaceStyle.display !== 'none' &&
            surfaceStyle.visibility !== 'hidden' &&
            opacity(surface) > 0,
          progressOpacity: opacity(progress),
          progressAnimationEnabled:
            progressStyle.animationName !== 'none' &&
            progressStyle.animationPlayState === 'running',
          fontFamily: getComputedStyle(heading).fontFamily,
          width: headingBox.width,
          height: headingBox.height,
        });
      }
      const readyCount = probe.frames.filter((frame) => frame.fontState === 'ready').length;
      if (readyCount >= 8 || probe.attempts >= 240) {
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
          (
            window as Window & {
              __foundationFrameProbe?: { complete: boolean };
            }
          ).__foundationFrameProbe?.complete,
        ),
      ),
    )
    .toBe(true);

  const frames = await page.evaluate(
    () =>
      (
        window as Window & {
          __foundationFrameProbe?: { frames: FoundationFrame[] };
        }
      ).__foundationFrameProbe?.frames ?? [],
  );
  expect(frames.length).toBeGreaterThanOrEqual(8);
  expect(
    frames.every((frame) => frame.theme === 'dark'),
    JSON.stringify(frames),
  ).toBe(true);

  let readyObserved = false;
  for (const frame of frames) {
    expect(['loading', 'ready'], JSON.stringify(frame)).toContain(frame.fontState);
    if (frame.fontState === 'loading') {
      expect(readyObserved, JSON.stringify(frame)).toBe(false);
      expect(frame.surfaceVisible, JSON.stringify(frame)).toBe(false);
      expect(frame.progressOpacity, JSON.stringify(frame)).toBeGreaterThan(0.99);
      expect(frame.progressAnimationEnabled, JSON.stringify(frame)).toBe(true);
      continue;
    }

    readyObserved = true;
    expect(frame.surfaceVisible, JSON.stringify(frame)).toBe(true);
    expect(frame.fontFamily, JSON.stringify(frame)).toContain('Manrope');
  }

  const readyFrames = frames.filter((frame) => frame.fontState === 'ready');
  expect(readyFrames).toHaveLength(8);
  expect(
    Math.max(...readyFrames.map((frame) => frame.width)) -
      Math.min(...readyFrames.map((frame) => frame.width)),
  ).toBeLessThan(0.25);
  expect(
    Math.max(...readyFrames.map((frame) => frame.height)) -
      Math.min(...readyFrames.map((frame) => frame.height)),
  ).toBeLessThan(0.25);
});
