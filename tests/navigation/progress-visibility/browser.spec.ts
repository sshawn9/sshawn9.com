import { expect, test } from '@playwright/test';

// Frozen from ee23e94, before the font-wait fix. Rename both the selector and
// keyframes so the reference cannot override the production animation.
const legacyReferenceCss = `
  .progress-reference {
    position: absolute;
    top: env(safe-area-inset-top);
    left: 0;
    width: 26%;
    height: 2px;
    opacity: 0;
    pointer-events: none;
    transform: translate3d(-110%, 0, 0);
    background: var(--text-accent-hover);
    visibility: hidden;
  }
  html[data-font-state='loading'] .progress-reference,
  html[data-navigation-progress='active'] .progress-reference {
    animation: progress-reference-motion 1.1s cubic-bezier(0.45, 0, 0.55, 1) infinite;
    opacity: 1;
  }
  html[data-navigation-progress='finishing'] .progress-reference {
    opacity: 0;
    transform: translate3d(390%, 0, 0);
    transition: opacity 120ms ease-out;
  }
  @keyframes progress-reference-motion {
    from { transform: translate3d(-110%, 0, 0); }
    to { transform: translate3d(390%, 0, 0); }
  }
`;

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(
    'progress matches the original header animation (' + reducedMotion + ')',
    async ({ page, browserName }, testInfo) => {
      await page.emulateMedia({ reducedMotion });
      await page.goto('/zh/blog/');
      await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');

      const comparison = await page.evaluate(
        async ({ css, reducedMotion }) => {
          const progress = document.querySelector<HTMLElement>('.navigation-progress')!;
          const header = document.querySelector<HTMLElement>('.site-header')!;
          const reference = document.createElement('div');
          reference.className = 'progress-reference';
          reference.setAttribute('aria-hidden', 'true');
          header.append(reference);
          const style = document.createElement('style');
          style.textContent = css;
          document.head.append(style);

          const root = document.documentElement;
          const round = (value: number) => Math.round(value * 1000) / 1000;
          const snapshot = (element: HTMLElement) => {
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
              left: round(box.left),
              right: round(box.right),
              top: round(box.top),
              width: round(box.width),
              height: round(box.height),
              opacity: round(Number(style.opacity)),
              color: style.backgroundColor,
              position: style.position,
              zIndex: style.zIndex,
              pointerEvents: style.pointerEvents,
              duration: style.animationDuration,
              iterations: style.animationIterationCount,
              easing: style.animationTimingFunction,
              transition: style.transition,
            };
          };
          const comparisons = [];
          for (const state of ['loading', 'active', 'finishing', 'idle']) {
            root.dataset.fontState = state === 'loading' ? 'loading' : 'ready';
            if (state === 'active' || state === 'finishing')
              root.dataset.navigationProgress = state;
            else root.removeAttribute('data-navigation-progress');

            // Reduced motion completes the original global 0.01ms animation.
            if (reducedMotion === 'reduce') {
              await new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              );
            }
            const animations = [progress, reference].map((element) => element.getAnimations()[0]);
            animations.forEach((animation) => animation?.pause());
            const times =
              reducedMotion === 'reduce' || state === 'idle'
                ? [0]
                : state === 'finishing'
                  ? [0, 60, 120]
                  : [0, 80, 160, 275, 550, 825, 1020, 1099, 1100, 1375, 1650, 1925];
            for (const time of times) {
              animations.forEach((animation) => {
                if (animation) animation.currentTime = time;
              });
              comparisons.push({
                state,
                time,
                actual: snapshot(progress),
                reference: snapshot(reference),
              });
            }
          }

          // Capture the real bar at the midpoint, not an intentionally offscreen frame.
          root.dataset.navigationProgress = 'active';
          const animation = progress.getAnimations()[0];
          animation?.pause();
          if (animation) animation.currentTime = 550;
          const headerBox = header.getBoundingClientRect();
          return {
            comparisons,
            parentIsHeader: progress.parentElement === header,
            childCount: progress.childElementCount,
            visibility: getComputedStyle(progress).visibility,
            header: { left: headerBox.left, right: headerBox.right, width: headerBox.width },
          };
        },
        { css: legacyReferenceCss, reducedMotion },
      );

      expect(comparison.parentIsHeader).toBe(true);
      expect(comparison.childCount).toBe(0);
      expect(comparison.visibility).toBe('visible');
      for (const sample of comparison.comparisons) {
        expect(sample.actual, JSON.stringify(sample)).toEqual(sample.reference);
      }
      const initial = comparison.comparisons[0]!.actual;
      expect(initial.height).toBe(2);
      expect(initial.width).toBeCloseTo(comparison.header.width * 0.26, 1);
      expect(initial.right).toBeLessThan(comparison.header.left);
      if (reducedMotion === 'reduce') {
        expect(Number.parseFloat(initial.duration) * 1000).toBeCloseTo(0.01, 5);
        expect(initial.iterations).toBe('1');
      } else {
        expect(initial.duration).toBe('1.1s');
        expect(initial.iterations).toBe('infinite');
        const exit = comparison.comparisons.find(
          (sample) => sample.state === 'active' && sample.time === 1099,
        )!;
        expect(exit.actual.left).toBeGreaterThan(comparison.header.right);
        const finishing = comparison.comparisons.find(
          (sample) => sample.state === 'finishing' && sample.time === 60,
        )!;
        expect(finishing.actual.left).toBeGreaterThan(comparison.header.right);
        expect(finishing.actual.opacity).toBeGreaterThan(0);
        expect(finishing.actual.opacity).toBeLessThan(1);
      }

      if (browserName === 'chromium' && reducedMotion === 'no-preference') {
        const session = await page.context().newCDPSession(page);
        try {
          const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
          await testInfo.attach('legacy-progress-midpoint', {
            body: Buffer.from(data, 'base64'),
            contentType: 'image/png',
          });
        } finally {
          await session.detach();
        }
      }

      await page.setViewportSize({ width: 1280, height: 240 });
      const scrolled = await page.evaluate(() => {
        scrollTo({ top: 240, behavior: 'instant' });
        return {
          scrollY,
          headerTop: document.querySelector('.site-header')!.getBoundingClientRect().top,
          progressTop: document.querySelector('.navigation-progress')!.getBoundingClientRect().top,
        };
      });
      expect(scrolled.scrollY).toBeGreaterThan(0);
      expect(scrolled.headerTop).toBeLessThan(0);
      expect(scrolled.progressTop).toBeCloseTo(scrolled.headerTop, 1);
    },
  );
}
