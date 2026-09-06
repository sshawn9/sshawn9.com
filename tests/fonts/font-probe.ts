import type { Page } from '@playwright/test';

export type FontFrame = {
  state: string;
  visible: boolean;
  firstHeight: number;
  secondTop: number;
};

export const FONT_ROUTE = '**/*.woff2';

export async function installFontFrameProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const frames: FontFrame[] = [];
    Object.defineProperty(window, '__fontFrameProbe', {
      configurable: true,
      value: { frames },
    });

    const sample = () => {
      const outlet = document.querySelector<HTMLElement>('[data-font-surface].page-outlet');
      const articles = document.querySelectorAll<HTMLElement>('[data-blog-article]');
      if (outlet && articles.length >= 2) {
        const outletStyle = getComputedStyle(outlet);
        const first = articles[0].getBoundingClientRect();
        const second = articles[1].getBoundingClientRect();
        const round = (value: number) => Math.round(value * 1000) / 1000;
        frames.push({
          state: document.documentElement.dataset.fontState ?? '',
          visible: outletStyle.visibility !== 'hidden' && outletStyle.opacity !== '0',
          firstHeight: round(first.height),
          secondTop: round(second.top),
        });
      }
      if (frames.length < 180) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

export async function readFontFrames(page: Page): Promise<FontFrame[]> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __fontFrameProbe?: { frames: FontFrame[] };
        }
      ).__fontFrameProbe?.frames ?? [],
  );
}

export async function holdFontRequests(page: Page): Promise<{ release(): void; urls: string[] }> {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const urls: string[] = [];
  await page.route(FONT_ROUTE, async (route) => {
    urls.push(route.request().url());
    await gate;
    await route.continue().catch(() => undefined);
  });
  return { release, urls };
}
