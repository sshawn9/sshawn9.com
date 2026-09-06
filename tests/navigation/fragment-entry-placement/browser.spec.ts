import { expect, test } from '@playwright/test';
import { PAGE_OUTLET_FADE_MS } from '../../../apps/site/src/runtime/page-outlet-transition';

const articlePath = '/en/blog/git-operations-reference/';

test('cross-page fragment placement is complete before the target begins to appear', async ({
  page,
}) => {
  const targetId = 'maintenance-maintain-repository-data';
  type FragmentPlacementSample = {
    scrollY: number;
    targetTop: number;
    expectedTargetTop: number;
    opacity: number;
  };
  type FragmentPlacementProbe = {
    initial?: FragmentPlacementSample;
    animation?: Animation;
    failure?: string;
  };
  type FragmentPlacementWindow = Window & {
    __fragmentPlacementProbe?: FragmentPlacementProbe;
  };

  await page.goto('/en/blog/');
  await page.evaluate((fragment) => {
    const link = document.querySelector<HTMLAnchorElement>(
      'a[href="/en/blog/git-operations-reference/"]',
    );
    if (!link) throw new Error('Article link was not found');
    link.href = `${link.href}#${fragment}`;
    link.dataset.astroPrefetch = 'false';
    const probe: FragmentPlacementProbe = {};
    Object.defineProperty(window, '__fragmentPlacementProbe', {
      configurable: true,
      value: probe,
    });
    document.addEventListener(
      'astro:after-swap',
      () => {
        const target = document.getElementById(fragment);
        const outlet = document.querySelector<HTMLElement>('.page-outlet');
        if (!target || !outlet) {
          probe.failure = 'Fragment target or outlet was not found after the swap';
          return;
        }
        probe.initial = {
          scrollY,
          targetTop: target.getBoundingClientRect().top,
          expectedTargetTop: Number.parseFloat(getComputedStyle(target).scrollMarginTop),
          opacity: Number.parseFloat(getComputedStyle(outlet).opacity),
        };
        const animation = outlet.matches('[data-page-outlet-entering]')
          ? outlet
              .getAnimations()
              .find(
                (candidate) =>
                  candidate.effect instanceof KeyframeEffect && candidate.effect.target === outlet,
              )
          : undefined;
        if (!animation) {
          probe.failure = 'Target outlet animation was not available after the swap';
          return;
        }
        animation.pause();
        animation.currentTime = 0;
        probe.animation = animation;
      },
      { once: true },
    );
  }, targetId);

  await page.getByRole('link', { name: 'Git Operations Reference' }).click();
  await expect(page).toHaveURL(new RegExp(`${articlePath}#${targetId}$`));
  await page.waitForFunction(() => {
    const probe = (window as FragmentPlacementWindow).__fragmentPlacementProbe;
    return Boolean(probe?.initial || probe?.failure);
  });
  const samples = await page.evaluate(
    ({ duration, targetId }) => {
      const probe = (window as FragmentPlacementWindow).__fragmentPlacementProbe;
      if (!probe?.initial) throw new Error(probe?.failure ?? 'Fragment placement was not sampled');
      if (probe.failure || !probe.animation)
        throw new Error(probe.failure ?? 'Animation was not paused');

      const target = document.getElementById(targetId);
      const outlet = document.querySelector<HTMLElement>('.page-outlet');
      if (!target || !outlet) throw new Error('Fragment target or outlet was not found');
      const sample = (time: number) => {
        probe.animation!.currentTime = time;
        return {
          scrollY,
          targetTop: target.getBoundingClientRect().top,
          expectedTargetTop: Number.parseFloat(getComputedStyle(target).scrollMarginTop),
          opacity: Number.parseFloat(getComputedStyle(outlet).opacity),
        };
      };
      return [probe.initial, sample(0), sample(duration / 2), sample(duration)];
    },
    { duration: PAGE_OUTLET_FADE_MS, targetId },
  );

  const [initial, transparent, halfway, complete] = samples;
  expect(initial.scrollY).toBeGreaterThan(0);
  expect(initial.opacity).toBeCloseTo(0, 5);
  expect(transparent.opacity).toBeCloseTo(0, 5);
  expect(halfway.opacity).toBeGreaterThan(0);
  expect(halfway.opacity).toBeLessThan(1);
  expect(complete.opacity).toBeCloseTo(1, 5);
  expect(samples.every((sample) => Math.abs(sample.scrollY - initial.scrollY) < 2)).toBe(true);
  expect(samples.every((sample) => Math.abs(sample.targetTop - initial.targetTop) < 2)).toBe(true);
  expect(Math.abs(initial.targetTop - initial.expectedTargetTop)).toBeLessThan(2);

  const finalFrame = await page.evaluate(async (fragment) => {
    const animation = (window as FragmentPlacementWindow).__fragmentPlacementProbe?.animation;
    const target = document.getElementById(fragment);
    if (!animation || !target) throw new Error('Animation cleanup could not be observed');
    animation.currentTime = 0;
    animation.play();
    await animation.finished;
    return { scrollY, targetTop: target.getBoundingClientRect().top };
  }, targetId);
  expect(Math.abs(finalFrame.scrollY - initial.scrollY)).toBeLessThan(2);
  expect(Math.abs(finalFrame.targetTop - initial.targetTop)).toBeLessThan(2);
  const outlet = page.locator('.page-outlet');
  await expect(outlet).toHaveCSS('opacity', '1');
  await expect(outlet).not.toHaveAttribute('data-page-outlet-entering', '');
  expect(await outlet.evaluate((element) => element.style.opacity)).toBe('');
});
