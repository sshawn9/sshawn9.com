import { expect, test } from '@playwright/test';
import { PAGE_OUTLET_FADE_MS } from '../../../apps/site/src/runtime/page-outlet-transition';

const pageTransitionEnvironments = [
  {
    label: 'native View Transition available',
    nativeViewTransitions: true,
    webAnimations: true,
    reducedMotion: false,
    animated: true,
  },
  {
    label: 'reduced motion',
    nativeViewTransitions: true,
    webAnimations: true,
    reducedMotion: true,
    animated: false,
  },
] as const;

for (const environment of pageTransitionEnvironments) {
  test(`ordinary cross-page navigation keeps the outgoing scroll until the transparent swap (${environment.label})`, async ({
    page,
  }) => {
    if (environment.reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
    if (!environment.nativeViewTransitions) {
      await page.addInitScript(() => {
        Object.defineProperty(Document.prototype, 'startViewTransition', {
          configurable: true,
          value: undefined,
        });
      });
    }
    if (!environment.webAnimations) {
      await page.addInitScript(() => {
        Object.defineProperty(Element.prototype, 'animate', {
          configurable: true,
          value: undefined,
        });
      });
    }
    await page.goto('/en/blog/');
    const outgoingScroll = await page.evaluate(() => {
      scrollTo({
        top: Math.min(1_600, document.documentElement.scrollHeight - innerHeight),
        behavior: 'instant',
      });
      const probe = {
        complete: false,
        frames: [] as Array<{
          route: 'blog' | 'projects' | 'other';
          scrollY: number;
          opacity: number;
          currentNavigation: string;
          snapshotAnimation: boolean;
        }>,
      };
      Object.defineProperty(window, '__pageTransitionProbe', { value: probe, configurable: true });
      const sample = () => {
        const outlet = document.querySelector<HTMLElement>('.page-outlet');
        const route = document.querySelector('.blog-page')
          ? 'blog'
          : document.querySelector('.project-list-page')
            ? 'projects'
            : 'other';
        const currentNavigation =
          document
            .querySelector<HTMLElement>('.site-header__nav-link[aria-current="page"]')
            ?.textContent?.trim() ?? '';
        const snapshotAnimation = document.getAnimations().some((animation) => {
          const effect = animation.effect as
            (KeyframeEffect & { pseudoElement?: string | null }) | null;
          return effect?.pseudoElement?.includes('page-outlet') ?? false;
        });
        probe.frames.push({
          route,
          scrollY,
          opacity: Number.parseFloat(outlet ? getComputedStyle(outlet).opacity : '1'),
          currentNavigation,
          snapshotAnimation,
        });
        const targetFrames = probe.frames.filter((frame) => frame.route === 'projects');
        if (
          targetFrames.length >= 3 &&
          targetFrames.at(-1)!.opacity > 0.99 &&
          targetFrames.every((frame) => frame.scrollY === 0)
        ) {
          probe.complete = true;
          return;
        }
        requestAnimationFrame(sample);
      };
      document.addEventListener('astro:before-preparation', () => requestAnimationFrame(sample), {
        once: true,
      });
      return scrollY;
    });
    expect(outgoingScroll).toBeGreaterThan(0);

    await page.getByRole('link', { name: 'Projects' }).click();
    await expect(page).toHaveURL(/\/en\/projects\/$/);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __pageTransitionProbe?: { complete: boolean } })
              .__pageTransitionProbe?.complete ?? false,
        ),
      )
      .toBe(true);

    const frames = await page.evaluate(
      () =>
        (
          window as Window & {
            __pageTransitionProbe?: {
              frames: Array<{
                route: 'blog' | 'projects' | 'other';
                scrollY: number;
                opacity: number;
                currentNavigation: string;
                snapshotAnimation: boolean;
              }>;
            };
          }
        ).__pageTransitionProbe?.frames ?? [],
    );
    const outgoingFrames = frames.filter((frame) => frame.route === 'blog');
    const targetFrames = frames.filter((frame) => frame.route === 'projects');
    expect(outgoingFrames.length).toBeGreaterThan(environment.animated ? 3 : 0);
    expect(targetFrames.length).toBeGreaterThanOrEqual(3);
    expect(outgoingFrames.every((frame) => Math.abs(frame.scrollY - outgoingScroll) < 2)).toBe(
      true,
    );
    if (environment.animated) {
      expect(outgoingFrames.some((frame) => frame.opacity > 0.05 && frame.opacity < 0.95)).toBe(
        true,
      );
      expect(targetFrames.some((frame) => frame.opacity > 0.05 && frame.opacity < 0.95)).toBe(true);
    } else {
      expect(frames.every((frame) => frame.opacity === 1)).toBe(true);
    }
    expect(outgoingFrames.every((frame) => frame.currentNavigation === 'Blog')).toBe(true);
    expect(targetFrames.every((frame) => frame.scrollY === 0)).toBe(true);
    expect(targetFrames.every((frame) => frame.currentNavigation === 'Projects')).toBe(true);
    expect(frames.every((frame) => !frame.snapshotAnimation)).toBe(true);
    expect(PAGE_OUTLET_FADE_MS).toBe(180);
  });
}
