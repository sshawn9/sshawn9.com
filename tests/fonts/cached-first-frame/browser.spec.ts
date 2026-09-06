import { expect, test, type Page } from '@playwright/test';
import { installFontFrameProbe, readFontFrames, type FontFrame } from '../font-probe';

type SurfaceFrame = {
  state: string;
  visible: boolean;
  fontFamily: string;
  sampleTop: number;
  sampleHeight: number;
};

const blogPath = '/zh/blog/';

async function installSurfaceFrameProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const frames: SurfaceFrame[] = [];
    Object.defineProperty(window, '__surfaceFrameProbe', {
      configurable: true,
      value: { frames },
    });
    const sample = () => {
      const outlet = document.querySelector<HTMLElement>('[data-font-surface].page-outlet');
      const target = document.querySelector<HTMLElement>(
        '[data-article-page] .article-prose p, [data-blog-article], h1, #main-content',
      );
      if (outlet && target) {
        const style = getComputedStyle(outlet);
        const targetStyle = getComputedStyle(target);
        const box = target.getBoundingClientRect();
        frames.push({
          state: document.documentElement.dataset.fontState ?? '',
          visible: style.visibility !== 'hidden' && style.opacity !== '0',
          fontFamily: targetStyle.fontFamily,
          sampleTop: Math.round(box.top * 1000) / 1000,
          sampleHeight: Math.round(box.height * 1000) / 1000,
        });
      }
      if (frames.length < 120) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function readSurfaceFrames(page: Page): Promise<SurfaceFrame[]> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __surfaceFrameProbe?: { frames: SurfaceFrame[] };
        }
      ).__surfaceFrameProbe?.frames ?? [],
  );
}

function expectStableGeometry(frames: FontFrame[]): void {
  expect(frames.length).toBeGreaterThan(0);
  const first = frames[0];
  expect(
    frames.every(
      (frame) =>
        Math.abs(frame.firstHeight - first.firstHeight) < 0.25 &&
        Math.abs(frame.secondTop - first.secondTop) < 0.25,
    ),
  ).toBe(true);
}

test('cached reload starts with final typography and stable geometry', async ({ page }) => {
  await installFontFrameProbe(page);
  await page.goto(blogPath, { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  await expect.poll(async () => (await readFontFrames(page)).length).toBeGreaterThanOrEqual(8);

  const frames = await readFontFrames(page);
  expect(frames.every((frame) => frame.state === 'ready' && frame.visible)).toBe(true);
  expectStableGeometry(frames);
});

test('cached reload stays stable across representative Latin, CJK, code and math pages', async ({
  page,
}) => {
  await installSurfaceFrameProbe(page);
  const paths = ['/en/', '/zh/blog/', '/zh/blog/planar-frenet-frame/'];

  for (const path of paths) {
    await page.goto(path, { waitUntil: 'networkidle' });
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await expect.poll(async () => (await readSurfaceFrames(page)).length).toBeGreaterThanOrEqual(8);

    const frames = (await readSurfaceFrames(page)).filter((frame) => frame.visible);
    expect(frames.length).toBeGreaterThan(0);
    const first = frames[0];
    const observedFrames = [
      ...new Map(
        frames.map((frame) => [
          `${frame.state}|${frame.visible}|${frame.fontFamily}|${frame.sampleTop}|${frame.sampleHeight}`,
          frame,
        ]),
      ).values(),
    ];
    expect(
      frames.every(
        (frame) =>
          frame.state === 'ready' &&
          frame.visible &&
          frame.fontFamily === first.fontFamily &&
          Math.abs(frame.sampleTop - first.sampleTop) < 0.25 &&
          Math.abs(frame.sampleHeight - first.sampleHeight) < 0.25,
      ),
      `${path} changed typography after its first visible frame: ${JSON.stringify(observedFrames)}`,
    ).toBe(true);
  }
});
