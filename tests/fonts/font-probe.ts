import type { Page } from '@playwright/test';

export type FontFrame = {
  state: string;
  navigationPending: boolean;
  progressPhase: string;
  surfacePresent: boolean;
  visible: boolean;
  fontSurfaces: { name: string; guarded: boolean; visibility: string }[];
  sampleFontFamily: string;
  sampleFontReady: boolean;
  sampleTop: number | null;
  sampleHeight: number | null;
  secondTop: number | null;
  progressPresent: boolean;
  progressOpacity: number;
  progressAnimationEnabled: boolean;
};

export const FONT_ROUTE = /\.(?:woff2?|ttf)(?:\?|$)/;

export async function installFontFrameProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const frames: FontFrame[] = [];
    Object.defineProperty(window, '__fontFrameProbe', {
      configurable: true,
      value: { frames },
    });

    const round = (value: number) => Math.round(value * 1000) / 1000;
    const opacity = (element: HTMLElement | null): number => {
      if (!element) return 0;
      let value = 1;
      for (let current: HTMLElement | null = element; current; current = current.parentElement) {
        value *= Number.parseFloat(getComputedStyle(current).opacity) || 0;
      }
      return round(value);
    };
    const sampleTargets = (): [HTMLElement | null, HTMLElement | null] => {
      const selectors = location.pathname.includes('/planar-frenet-frame/')
        ? ['[data-article-page] .article-prose .katex-html .mathnormal']
        : location.pathname.includes('/git-operations-reference/')
          ? ['[data-article-page] .article-prose pre code']
          : document.querySelector('[data-blog-listing]')
            ? ['[data-blog-article]']
            : document.querySelector('.not-found-page')
              ? ['.not-found-page__content h1', '.not-found-page__description']
              : ['#home-heading', '#home-projects-heading'];
      const firstMatches = document.querySelectorAll<HTMLElement>(selectors[0]);
      const first = firstMatches[0] ?? null;
      const second = selectors[1]
        ? document.querySelector<HTMLElement>(selectors[1])
        : (firstMatches[1] ?? null);
      return [first, second];
    };
    const sample = () => {
      const surface = document.querySelector<HTMLElement>(
        '[data-font-surface].page-outlet, main[data-font-surface]',
      );
      const [target, second] = sampleTargets();
      const progress = document.querySelector<HTMLElement>('.navigation-progress');
      const progressStyle = progress ? getComputedStyle(progress) : null;
      const surfaceStyle = surface ? getComputedStyle(surface) : null;
      const surfaceBox = surface?.getBoundingClientRect();
      const targetBox = target?.getBoundingClientRect();
      const targetStyle = target ? getComputedStyle(target) : null;
      const chineseText = [...(target?.textContent ?? '')]
        .filter((character) => /\p{Script=Han}/u.test(character))
        .join('');
      const secondBox = second?.getBoundingClientRect();
      const surfaceOpacity = opacity(surface);

      frames.push({
        state: document.documentElement.dataset.fontState ?? '',
        navigationPending: document.documentElement.hasAttribute('data-navigation-pending'),
        progressPhase: document.documentElement.dataset.navigationProgress ?? '',
        surfacePresent: surface !== null,
        visible:
          surface !== null &&
          surfaceStyle?.display !== 'none' &&
          surfaceStyle?.visibility !== 'hidden' &&
          surfaceOpacity > 0 &&
          (surfaceBox?.width ?? 0) > 0 &&
          (surfaceBox?.height ?? 0) > 0,
        // Include the shell's required regions even if their gate marker is
        // accidentally removed; selecting only marked surfaces would miss that.
        fontSurfaces: Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-font-surface], .skip-link, .site-header__inner, .page-outlet',
          ),
          (element) => ({
            name: element.className || element.tagName.toLowerCase(),
            guarded: element.hasAttribute('data-font-surface'),
            visibility: getComputedStyle(element).visibility,
          }),
        ),
        sampleFontFamily: targetStyle?.fontFamily ?? '',
        sampleFontReady:
          targetStyle !== null &&
          Array.from(document.fonts).some(
            (face) =>
              face.status === 'loaded' &&
              face.family.replace(/^["']|["']$/g, '') ===
                targetStyle.fontFamily
                  .split(',')[0]!
                  .trim()
                  .replace(/^["']|["']$/g, ''),
          ) &&
          document.fonts.check(
            `${targetStyle.fontStyle} ${targetStyle.fontWeight} 16px ${targetStyle.fontFamily.split(',')[0]}`,
            target?.textContent ?? '',
          ) &&
          (!chineseText || document.fonts.check('400 16px "Noto Sans SC Variable"', chineseText)),
        sampleTop: targetBox ? round(targetBox.top) : null,
        sampleHeight: targetBox ? round(targetBox.height) : null,
        secondTop: secondBox ? round(secondBox.top) : null,
        progressPresent: progress !== null,
        progressOpacity: opacity(progress),
        progressAnimationEnabled:
          progressStyle !== null &&
          progressStyle.animationName !== 'none' &&
          progressStyle.animationPlayState === 'running',
      });
      requestAnimationFrame(sample);
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

export type HeldFontRequests = {
  release(): void;
  urls: string[];
};

export async function holdFontRequests(
  page: Page,
  matches: (url: string) => boolean = () => true,
): Promise<HeldFontRequests> {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const urls: string[] = [];
  await page.route(FONT_ROUTE, async (route) => {
    const url = route.request().url();
    if (!matches(url)) {
      await route.fallback();
      return;
    }
    urls.push(url);
    await gate;
    await route.continue().catch(() => undefined);
  });
  return { release, urls };
}
