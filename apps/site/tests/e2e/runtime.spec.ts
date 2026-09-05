import { expect, test } from '@playwright/test';
import {
  NAVIGATION_FADE_MS,
  NAVIGATION_MIN_VISIBLE_MS,
  NAVIGATION_SHOW_DELAY_MS,
} from '../../src/runtime/navigation-feedback';
import { PAGE_OUTLET_FADE_MS } from '../../src/runtime/page-outlet-transition';

const articlePath = '/en/blog/git-operations-reference/';

test('same-build navigation preserves the wallpaper visual and uses target locale semantics', async ({
  page,
}) => {
  await page.goto('/en/blog/');
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-wallpaper-visual]')!.dataset.identityProbe =
      'original';
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a')) {
      link.dataset.astroPrefetch = 'false';
    }
  });

  await page.getByRole('link', { name: 'Git Operations Reference' }).click();
  await expect(page).toHaveURL(new RegExp(`${articlePath}$`));
  await expect(page.locator('[data-wallpaper-visual]')).toHaveAttribute(
    'data-identity-probe',
    'original',
  );

  const localeLink = page.getByRole('link', { name: '中文' });
  await expect(localeLink).toHaveAttribute('href', '/zh/blog/git-operations-reference/');
  await localeLink.click();

  await expect(page).toHaveURL(/\/zh\/blog\/git-operations-reference\/$/);
  await expect(page.locator('[data-wallpaper-visual]')).toHaveAttribute(
    'data-identity-probe',
    'original',
  );
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '博客' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('html')).toHaveAttribute('data-appearance-script', 'enabled');
  await expect(page.locator('[data-theme-toggle]').first()).toBeVisible();
  await expect(page.locator('[data-wallpaper-menu-trigger]')).toBeVisible();
});

test('keyboard navigation focuses target content while pointer navigation preserves focus semantics', async ({
  page,
}) => {
  await page.goto('/zh/');
  const aboutLink = page.getByRole('link', { name: '关于' });
  await aboutLink.focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/zh\/about\/$/);
  await expect(page.locator('#main-content')).toBeFocused();
  const announcer = page.locator('.astro-route-announcer');
  await expect(announcer).toContainText('关于');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

  await page.getByRole('link', { name: '博客' }).click();
  await expect(page).toHaveURL(/\/zh\/blog\/$/);
  await expect(page.locator('#main-content')).not.toBeFocused();
});

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

test('a navigation superseded during its outgoing fade cannot swap or leave visual state behind', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/en/blog/');
  await page.evaluate(() => {
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a')) {
      link.dataset.astroPrefetch = 'false';
    }
  });

  const staleClick = page.getByRole('link', { name: 'Projects' }).click();
  await expect(page.locator('.page-outlet')).toHaveAttribute('data-page-outlet-leaving', '');
  await page.getByRole('link', { name: 'About' }).click();
  await staleClick;

  await expect(page).toHaveURL(/\/en\/about\/$/);
  await expect(page.locator('.about-page')).toBeVisible();
  await expect(page.getByRole('link', { name: 'About', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('.page-outlet')).toHaveCSS('opacity', '1');
  await expect(page.locator('.page-outlet')).not.toHaveAttribute('data-page-outlet-leaving', '');
  await expect(page.locator('.page-outlet')).not.toHaveAttribute('data-page-outlet-entering', '');
  expect(pageErrors).toEqual([]);
});

test('history traversal restores its scroll before the target route becomes visible', async ({
  page,
}) => {
  await page.goto('/en/blog/');
  const savedY = await page.evaluate(() => {
    scrollTo({
      top: Math.min(1_600, document.documentElement.scrollHeight - innerHeight),
      behavior: 'instant',
    });
    return scrollY;
  });
  expect(savedY).toBeGreaterThan(0);

  await page.getByRole('link', { name: 'About' }).click();
  await expect(page).toHaveURL(/\/en\/about\/$/);
  await page.evaluate(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      if (!document.querySelector('.blog-page')) return;
      observer.disconnect();
      const samples: number[] = [];
      const sample = () => {
        samples.push(scrollY);
        if (samples.length < 8) requestAnimationFrame(sample);
        else root.dataset.traversalScrollSamples = JSON.stringify(samples);
      };
      // MutationObserver runs inside the framework's atomic swap before its
      // saved scroll is applied. The first render opportunity is the behavior
      // boundary: no intermediate synchronous DOM state can reach the screen.
      requestAnimationFrame(sample);
    });
    observer.observe(root, { childList: true, subtree: true });
  });

  await page.goBack();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect(page.locator('html')).toHaveAttribute('data-traversal-scroll-samples', /\[/);
  const samples = await page
    .locator('html')
    .evaluate((root) => JSON.parse((root as HTMLElement).dataset.traversalScrollSamples ?? '[]'));
  expect(samples).toHaveLength(8);
  expect(
    samples.every((sample: number) => Math.abs(sample - savedY) < 2),
    `saved=${savedY}; samples=${samples.join(',')}`,
  ).toBe(true);
});

test('slow same-build navigation exposes feedback without replacing the wallpaper visual', async ({
  page,
}) => {
  let releaseResponse = () => {};
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });

  await page.route(`**${articlePath}`, async (route) => {
    if (route.request().resourceType() !== 'fetch') {
      await route.continue();
      return;
    }
    await responseGate;
    await route.continue();
  });
  await page.goto('/en/blog/');
  await page.evaluate(() => {
    document.querySelector<HTMLAnchorElement>(
      'a[href="/en/blog/git-operations-reference/"]',
    )!.dataset.astroPrefetch = 'false';
    document.querySelector<HTMLElement>('[data-wallpaper-visual]')!.dataset.identityProbe =
      'original';
  });

  const click = page.getByRole('link', { name: 'Git Operations Reference' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true');
  await page.waitForTimeout(NAVIGATION_SHOW_DELAY_MS + 20);
  await expect(page.locator('html')).toHaveAttribute('data-navigation-progress', 'active');
  await expect(page.locator('.page-outlet')).toHaveCSS('opacity', '1');
  expect(
    await page.evaluate(() =>
      document.getAnimations().some((animation) => {
        const effect = animation.effect as
          (KeyframeEffect & { pseudoElement?: string | null }) | null;
        return effect?.pseudoElement?.includes('page-outlet') ?? false;
      }),
    ),
  ).toBe(false);

  releaseResponse();
  await click;
  await expect(page).toHaveURL(new RegExp(`${articlePath}$`));
  await expect(page.locator('[data-wallpaper-visual]')).toHaveAttribute(
    'data-identity-probe',
    'original',
  );
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending', '');
  await expect(page.locator('main')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation-progress', 'active', {
    timeout: NAVIGATION_MIN_VISIBLE_MS + NAVIGATION_FADE_MS + 1_000,
  });
});

test('a newer navigation cancels stale preparation without a late error or swap', async ({
  page,
}) => {
  let releaseFirstResponse = () => {};
  const firstResponseGate = new Promise<void>((resolve) => {
    releaseFirstResponse = resolve;
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route(`**${articlePath}`, async (route) => {
    if (route.request().resourceType() !== 'fetch') {
      await route.continue();
      return;
    }
    await firstResponseGate;
    await route.continue();
  });

  await page.goto('/en/blog/');
  await page.evaluate(() => {
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a')) {
      link.dataset.astroPrefetch = 'false';
    }
    document.querySelector<HTMLElement>('[data-wallpaper-visual]')!.dataset.identityProbe =
      'original';
  });

  const staleClick = page.getByRole('link', { name: 'Git Operations Reference' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
  await page.getByRole('link', { name: '中文' }).click();
  await expect(page).toHaveURL(/\/zh\/blog\/$/);
  releaseFirstResponse();
  await staleClick;

  await expect(page.locator('[data-wallpaper-visual]')).toHaveAttribute(
    'data-identity-probe',
    'original',
  );
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await page.waitForTimeout(50);
  expect(pageErrors).toEqual([]);
});
