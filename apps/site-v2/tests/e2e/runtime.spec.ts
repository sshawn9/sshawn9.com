import { expect, test } from '@playwright/test';
import {
  NAVIGATION_FADE_MS,
  NAVIGATION_MIN_VISIBLE_MS,
  NAVIGATION_SHOW_DELAY_MS,
} from '../../src/runtime/navigation-feedback';
import { PAGE_OUTLET_FADE_MS } from '../../src/runtime/page-outlet-transition';

const articlePath = '/en/blog/git-operations-reference/';

test('same-build navigation preserves the shell and synchronizes locale semantics', async ({
  page,
}) => {
  await page.goto('/en/blog/');
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-site-shell]')!.dataset.identityProbe = 'original';
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a')) {
      link.dataset.astroPrefetch = 'false';
    }
  });

  await page.getByRole('link', { name: 'Git Operations Reference' }).click();
  await expect(page).toHaveURL(new RegExp(`${articlePath}$`));
  await expect(page.locator('[data-site-shell]')).toHaveAttribute(
    'data-identity-probe',
    'original',
  );

  const localeLink = page.getByRole('link', { name: '中文' });
  await expect(localeLink).toHaveAttribute('href', '/zh/blog/git-operations-reference/');
  await localeLink.click();

  await expect(page).toHaveURL(/\/zh\/blog\/git-operations-reference\/$/);
  await expect(page.locator('[data-site-shell]')).toHaveAttribute(
    'data-identity-probe',
    'original',
  );
  await expect(page.locator('[data-site-shell]')).toHaveAttribute('data-shell-locale', 'zh');
  await expect(page.locator('[data-shell-sync-key="primary-navigation"]')).toHaveAttribute(
    'aria-label',
    '主导航',
  );
  await expect(page.locator('[data-shell-sync-key="blog"]')).toHaveText('博客');
  await expect(page.locator('[data-shell-sync-key="blog"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('html')).toHaveAttribute('data-appearance-script', 'enabled');
  await expect(page.locator('[data-shell-sync-key="theme-toggle"]')).toBeVisible();
  await expect(page.locator('[data-shell-sync-key="wallpaper-trigger"]')).toBeVisible();
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
    label: 'native View Transition unavailable',
    nativeViewTransitions: false,
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
  {
    label: 'Web Animations unavailable',
    nativeViewTransitions: true,
    webAnimations: false,
    reducedMotion: false,
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
          document.querySelector<HTMLElement>('[data-shell-nav-prefix][aria-current="page"]')
            ?.dataset.shellSyncKey ?? '';
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
    expect(outgoingFrames.every((frame) => frame.currentNavigation === 'blog')).toBe(true);
    expect(targetFrames.every((frame) => frame.scrollY === 0)).toBe(true);
    expect(targetFrames.every((frame) => frame.currentNavigation === 'projects')).toBe(true);
    expect(frames.every((frame) => !frame.snapshotAnimation)).toBe(true);
    expect(PAGE_OUTLET_FADE_MS).toBe(180);
  });
}

test('cross-page fragment placement is complete before the target begins to appear', async ({
  page,
}) => {
  const targetId = 'maintenance-maintain-repository-data';
  await page.goto('/en/blog/');
  await page.evaluate((fragment) => {
    const link = document.querySelector<HTMLAnchorElement>(
      'a[href="/en/blog/git-operations-reference/"]',
    );
    if (!link) throw new Error('Article link was not found');
    link.href = `${link.href}#${fragment}`;
    link.dataset.astroPrefetch = 'false';
    Object.defineProperty(window, '__fragmentPlacementFrames', {
      configurable: true,
      value: [] as Array<{ scrollY: number; targetTop: number; opacity: number }>,
    });
    document.addEventListener(
      'astro:after-swap',
      () => {
        let remaining = 16;
        const sample = () => {
          const target = document.getElementById(fragment);
          const outlet = document.querySelector<HTMLElement>('.page-outlet');
          (
            window as Window & {
              __fragmentPlacementFrames?: Array<{
                scrollY: number;
                targetTop: number;
                opacity: number;
              }>;
            }
          ).__fragmentPlacementFrames?.push({
            scrollY,
            targetTop: target?.getBoundingClientRect().top ?? Number.NaN,
            opacity: Number.parseFloat(outlet ? getComputedStyle(outlet).opacity : '1'),
          });
          remaining -= 1;
          if (remaining > 0) requestAnimationFrame(sample);
        };
        sample();
      },
      { once: true },
    );
  }, targetId);

  await page.getByRole('link', { name: 'Git Operations Reference' }).click();
  await expect(page).toHaveURL(new RegExp(`${articlePath}#${targetId}$`));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __fragmentPlacementFrames?: Array<unknown>;
            }
          ).__fragmentPlacementFrames?.length ?? 0,
      ),
    )
    .toBe(16);

  const frames = await page.evaluate(
    () =>
      (
        window as Window & {
          __fragmentPlacementFrames?: Array<{
            scrollY: number;
            targetTop: number;
            opacity: number;
          }>;
        }
      ).__fragmentPlacementFrames ?? [],
  );
  const finalFrame = frames.at(-1)!;
  expect(finalFrame.scrollY).toBeGreaterThan(0);
  expect(frames.some((frame) => frame.opacity > 0.05 && frame.opacity < 0.95)).toBe(true);
  expect(frames.every((frame) => Math.abs(frame.scrollY - finalFrame.scrollY) < 2)).toBe(true);
  expect(frames.every((frame) => Math.abs(frame.targetTop - finalFrame.targetTop) < 2)).toBe(true);
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
  await expect(page.locator('[data-shell-sync-key="about"]')).toHaveAttribute(
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
      sample();
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
  expect(samples.every((sample: number) => Math.abs(sample - savedY) < 2)).toBe(true);
});

test('slow same-build navigation exposes feedback without replacing the shell', async ({
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
    document.querySelector<HTMLElement>('[data-site-shell]')!.dataset.identityProbe = 'original';
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
  await expect(page.locator('[data-site-shell]')).toHaveAttribute(
    'data-identity-probe',
    'original',
  );
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending', '');
  await expect(page.locator('main')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation-progress', 'active', {
    timeout: NAVIGATION_MIN_VISIBLE_MS + NAVIGATION_FADE_MS + 1_000,
  });
});

test('a target from another build performs a complete document navigation', async ({ page }) => {
  let modifiedClientFetches = 0;
  await page.addInitScript(() => {
    const key = 'v2-document-load-count';
    const count = Number(sessionStorage.getItem(key) ?? 0) + 1;
    sessionStorage.setItem(key, String(count));
  });
  await page.route(`**${articlePath}`, async (route) => {
    if (route.request().resourceType() !== 'fetch') {
      await route.continue();
      return;
    }

    modifiedClientFetches += 1;
    const response = await route.fetch();
    const originalHtml = await response.text();
    const html = originalHtml.replace(
      /(<meta name="site-build-id" content=")[^"]+("\s*\/?>)/,
      '$1another-build$2',
    );
    expect(html).not.toBe(originalHtml);
    await route.fulfill({ response, body: html });
  });

  await page.goto('/en/blog/');
  await page.evaluate(() => {
    document.querySelector<HTMLAnchorElement>(
      'a[href="/en/blog/git-operations-reference/"]',
    )!.dataset.astroPrefetch = 'false';
    document.querySelector<HTMLElement>('[data-site-shell]')!.dataset.identityProbe = 'old-build';
  });
  await page.getByRole('link', { name: 'Git Operations Reference' }).click();

  await expect(page).toHaveURL(new RegExp(`${articlePath}$`));
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('v2-document-load-count')))
    .toBe('2');
  await expect(page.locator('[data-site-shell]')).not.toHaveAttribute(
    'data-identity-probe',
    'old-build',
  );
  expect(modifiedClientFetches).toBe(1);
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
    document.querySelector<HTMLElement>('[data-site-shell]')!.dataset.identityProbe = 'original';
  });

  const staleClick = page.getByRole('link', { name: 'Git Operations Reference' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
  await page.getByRole('link', { name: '中文' }).click();
  await expect(page).toHaveURL(/\/zh\/blog\/$/);
  releaseFirstResponse();
  await staleClick;

  await expect(page.locator('[data-site-shell]')).toHaveAttribute(
    'data-identity-probe',
    'original',
  );
  await expect(page.locator('[data-site-shell]')).toHaveAttribute('data-shell-locale', 'zh');
  await page.waitForTimeout(50);
  expect(pageErrors).toEqual([]);
});

test('page controllers mount once after repeated client navigations', async ({ page }) => {
  await page.goto('/en/blog/');

  for (let visit = 0; visit < 3; visit += 1) {
    await expect(page.locator('[data-blog-listing]')).toHaveAttribute(
      'data-blog-runtime-ready',
      '',
    );
    await page.locator('[data-blog-article] h2 a').first().click();
    await expect(page.locator('[data-article-page]')).toHaveAttribute(
      'data-article-runtime-ready',
      '',
    );
    await page.locator('[data-shell-sync-key="blog"]').click();
    await expect(page).toHaveURL(/\/en\/blog\/$/);
  }

  await page.locator('[data-blog-tag-definition][data-tag-slug="astro"]').click();
  await expect(page.locator('[data-blog-listing]')).toHaveAttribute(
    'data-selected-tags',
    '["astro"]',
  );
  expect(new URL(page.url()).searchParams.getAll('tag')).toEqual(['astro']);
});
