import { expect, test } from '@playwright/test';

const articlePath = '/en/blog/git-operations-reference/';

type FoundationFrame = {
  theme?: string;
  fontState?: string;
  surfaceVisible: boolean;
  fontReady: boolean;
  fontFamily: string;
  width: number;
  height: number;
};

test('theme, visible ready fonts and article geometry are coherent in every sampled frame after FCP', async ({
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
      if (heading && surface) {
        const headingBox = heading.getBoundingClientRect();
        const surfaceStyle = getComputedStyle(surface);
        const headingStyle = getComputedStyle(heading);
        const family = headingStyle.fontFamily
          .split(',')[0]!
          .trim()
          .replace(/^['"]|['"]$/g, '');
        probe.frames.push({
          theme: document.documentElement.dataset.theme,
          fontState: document.documentElement.dataset.fontState,
          surfaceVisible:
            surfaceStyle.display !== 'none' &&
            surfaceStyle.visibility !== 'hidden' &&
            opacity(surface) > 0,
          fontReady:
            Array.from(document.fonts).some(
              (face) =>
                face.family.replace(/^['"]|['"]$/g, '') === family && face.status === 'loaded',
            ) &&
            document.fonts.check(
              `${headingStyle.fontStyle} ${headingStyle.fontWeight} 16px ${JSON.stringify(family)}`,
              heading.textContent ?? '',
            ),
          fontFamily: headingStyle.fontFamily,
          width: headingBox.width,
          height: headingBox.height,
        });
      }
      if (probe.frames.length >= 8 || probe.attempts >= 240) {
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

  for (const frame of frames) {
    expect(frame.fontState, JSON.stringify(frame)).toBe('ready');
    expect(frame.surfaceVisible, JSON.stringify(frame)).toBe(true);
    expect(frame.fontReady, JSON.stringify(frame)).toBe(true);
    expect(frame.fontFamily, JSON.stringify(frame)).toContain('Manrope');
  }

  expect(frames).toHaveLength(8);
  expect(
    Math.max(...frames.map((frame) => frame.width)) -
      Math.min(...frames.map((frame) => frame.width)),
  ).toBeLessThan(0.25);
  expect(
    Math.max(...frames.map((frame) => frame.height)) -
      Math.min(...frames.map((frame) => frame.height)),
  ).toBeLessThan(0.25);
});
