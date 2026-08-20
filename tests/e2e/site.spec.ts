import { expect, test } from '@playwright/test';

test('the site header exposes desktop navigation and a mobile disclosure menu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/blog/');

  await expect(page.locator('link[rel="preload"][as="font"]')).toHaveCount(2);

  const header = page.locator('.site-header');
  const identity = header.locator('.site-header__identity');
  const desktopNavigation = header.locator('.site-header__primary-nav');
  const menuButton = header.locator('[data-site-menu-trigger]');

  await expect(identity).toHaveAttribute('href', '/en/');
  await expect(desktopNavigation).toBeVisible();
  await expect(desktopNavigation.locator('a')).toHaveCount(3);
  expect(
    await desktopNavigation
      .locator('a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('data-swup-preload'))),
  ).toEqual(['', '', '']);
  expect(
    await desktopNavigation
      .locator('a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
  ).toEqual(['/en/projects/', '/en/blog/', '/en/about/']);
  await expect(desktopNavigation.locator('a[href="/en/blog/"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(menuButton).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(desktopNavigation).toBeHidden();
  await expect(menuButton).toBeVisible();

  await menuButton.click();
  const mobilePanel = page.locator('#site-navigation');
  await expect(mobilePanel).toBeVisible();
  await expect(menuButton).toHaveAccessibleName('Close navigation');
  await expect(mobilePanel.locator('a[href="/en/blog/"]')).toHaveAttribute('aria-current', 'page');
  await expect(mobilePanel.locator('[data-theme-toggle]')).toBeVisible();
  await expect(mobilePanel.locator('[data-wallpaper-menu-trigger]')).toHaveCount(0);
  await expect(mobilePanel.locator('[data-wallpaper-enabled]')).toBeVisible();
  await expect(mobilePanel.locator('[data-wallpaper-auto-rotation]')).toBeVisible();

  await page.setViewportSize({ width: 820, height: 844 });
  await expect(mobilePanel).toBeHidden();
  await expect(mobilePanel).not.toHaveAttribute('open', '');
  await expect(page.locator('[data-wallpaper-menu]')).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(menuButton).toHaveAccessibleName('Open navigation');
});

test('the mobile site navigation remains usable without client JavaScript', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  await page.goto('/en/');
  await expect(page.locator('html')).not.toHaveAttribute('data-site-chrome-ready');
  await expect(page.locator('[data-site-menu-trigger]')).toBeHidden();
  const fallback = page.locator('[data-site-menu-fallback]');
  await expect(fallback).toBeVisible();
  const fallbackTrigger = fallback.locator('summary');
  await expect(fallbackTrigger).toHaveAccessibleName('Open navigation');
  await fallbackTrigger.click();
  await expect(fallbackTrigger).toHaveAccessibleName('Close navigation');
  await expect(fallback.locator('.site-header__mobile-fallback-panel')).toBeVisible();
  await expect(fallback.locator('nav a')).toHaveCount(4);

  await fallback.locator('a[href="/en/about/"]').click();
  await expect(page).toHaveURL(/\/en\/about\/$/);
  await expect(page.locator('#main-content')).toContainText('This page is still taking shape.');

  await context.close();
});

test('slow client navigation reports progress without changing the header height', async ({
  page,
}) => {
  let releaseRequest: (() => void) | undefined;
  let requestCount = 0;
  const requestReleased = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });

  await page.route(/\/en\/about\/\?navigation-feedback-test=1$/, async (route) => {
    requestCount += 1;
    await requestReleased;
    await route.continue();
  });
  await page.goto('/en/');
  const header = page.locator('.site-header');
  const initialHeight = await header.evaluate((element) => element.getBoundingClientRect().height);
  await header.locator('[data-wallpaper-menu-trigger]').click();
  await expect(page.locator('[data-wallpaper-menu]')).toBeVisible();
  await expect(page.locator('[data-wallpaper-menu]')).toHaveAttribute('role', 'dialog');

  const navigationPoint = await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>(
      '[data-site-header-sync="desktop-about"]',
    );
    if (!link) throw new Error('The test navigation link is missing.');
    link.href = '/en/about/?navigation-feedback-test=1';
    link.removeAttribute('data-swup-preload');
    Object.defineProperty(window, '__navigationSource', {
      configurable: true,
      value: link,
    });
    Object.defineProperty(window, '__siteChromeContext', {
      configurable: true,
      value: document.querySelector('#site-chrome-context'),
    });
    const bounds = link.getBoundingClientRect();
    const point = {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
    const hitTests: Array<{
      sameTarget: boolean;
      cursor: string | undefined;
      hitTag: string | undefined;
      hitClass: string | undefined;
    }> = [];
    let finished = false;
    document.addEventListener('site:page-load', () => (finished = true), { once: true });
    const recordHitTarget = () => {
      const target = document.elementFromPoint(point.x, point.y);
      const interactive = target?.closest<HTMLAnchorElement>(
        '[data-site-header-sync="desktop-about"]',
      );
      hitTests.push({
        sameTarget: interactive === link,
        cursor: interactive ? getComputedStyle(interactive).cursor : undefined,
        hitTag: target?.tagName,
        hitClass:
          target instanceof Element ? (target.getAttribute('class') ?? undefined) : undefined,
      });
    };
    const sampleHitTarget = () => {
      recordHitTarget();
      if (!finished) requestAnimationFrame(sampleHitTarget);
    };
    ['swup:visit:start', 'site:before-swap', 'site:chrome-context', 'site:after-swap'].forEach(
      (eventName) => document.addEventListener(eventName, recordHitTarget, { once: true }),
    );
    Object.defineProperty(window, '__navigationHitTests', {
      configurable: true,
      value: hitTests,
    });
    sampleHitTarget();
    return point;
  });
  await page.mouse.click(navigationPoint.x, navigationPoint.y);

  await expect(page.locator('[data-wallpaper-menu]')).toBeHidden();
  await expect(page.locator('html')).toHaveAttribute('data-navigation-progress', 'active');
  await expect(page.locator('#swup')).toHaveClass(/is-changing/);
  expect(
    await page
      .locator('html')
      .evaluate((element) =>
        ['is-changing', 'is-animating', 'is-leaving', 'is-rendering'].some((className) =>
          element.classList.contains(className),
        ),
      ),
  ).toBe(false);
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true');
  const pendingLink = page.locator('[data-site-header-sync="desktop-about"]');
  await expect(pendingLink).not.toHaveAttribute('aria-busy', 'true');
  await expect
    .poll(() => pendingLink.evaluate((element) => getComputedStyle(element).cursor))
    .toBe('pointer');
  expect(await header.evaluate((element) => element.getBoundingClientRect().height)).toBe(
    initialHeight,
  );

  const requestCountBeforeDuplicateClick = requestCount;
  expect(requestCountBeforeDuplicateClick).toBeGreaterThan(0);
  await pendingLink.dispatchEvent('click');
  await page.waitForTimeout(50);
  expect(requestCount).toBe(requestCountBeforeDuplicateClick);

  releaseRequest?.();
  await expect(page).toHaveURL(/\/en\/about\/\?navigation-feedback-test=1$/);
  await expect(pendingLink).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __navigationSource?: HTMLAnchorElement })
            .__navigationSource ===
          document.querySelector('[data-site-header-sync="desktop-about"]'),
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __siteChromeContext?: Element }).__siteChromeContext ===
        document.querySelector('#site-chrome-context'),
    ),
  ).toBe(true);
  const navigationHitTests = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __navigationHitTests?: Array<{ sameTarget: boolean; cursor?: string }>;
        }
      ).__navigationHitTests ?? [],
  );
  expect(
    navigationHitTests.filter(({ sameTarget, cursor }) => !sameTarget || cursor !== 'pointer'),
  ).toEqual([]);
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending', '');
  await expect(page.locator('main')).not.toHaveAttribute('aria-busy', 'true');
});

test('language switching keeps the route and stores the preference', async ({ page }) => {
  await page.goto('/en/blog/');
  await page.evaluate(() => {
    Object.defineProperty(window, '__siteHeader', {
      configurable: true,
      value: document.querySelector('[data-site-header]'),
    });
  });
  await page.locator('a[data-locale-switch="zh"]').first().click();

  await expect(page).toHaveURL(/\/zh\/blog\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('[data-site-header-sync="home"]')).toHaveAttribute('href', '/zh/');
  await expect(page.locator('[data-site-header-sync="desktop-projects"]')).toHaveText('项目');
  await expect(page.locator('[data-site-header-sync="desktop-blog"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('[data-site-header-sync="desktop-locale"]')).toHaveAttribute(
    'data-locale-switch',
    'en',
  );
  await expect(page.locator('[data-site-skip-link]')).toHaveText('跳到主要内容');
  await expect(page.locator('#swup-announcer')).toContainText(/^已导航至：/);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __siteHeader?: HTMLElement }).__siteHeader ===
          document.querySelector('[data-site-header]'),
      ),
    )
    .toBe(true);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('PARAGLIDE_LOCALE'))).toBe('zh');
});

test('SiteChrome replays the latest page context when hydration finishes after navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let releaseSiteChrome: (() => void) | undefined;
  let reportSiteChromeRequest: (() => void) | undefined;
  const siteChromeReleased = new Promise<void>((resolve) => {
    releaseSiteChrome = resolve;
  });
  const siteChromeRequested = new Promise<void>((resolve) => {
    reportSiteChromeRequest = resolve;
  });

  await page.route(/\/_astro\/SiteChrome\.[^/]+\.js(?:\?.*)?$/, async (route) => {
    reportSiteChromeRequest?.();
    await siteChromeReleased;
    await route.continue();
  });

  const initialNavigation = page.goto('/en/');
  await siteChromeRequested;
  const fallback = page.locator('[data-site-menu-fallback]');
  await expect(page.locator('html')).not.toHaveAttribute('data-site-chrome-ready');
  await expect(page.locator('[data-site-menu-trigger]')).toBeHidden();
  await expect(fallback).toBeVisible();
  const fallbackTriggerBox = await fallback.locator('summary').boundingBox();
  const fallbackHeaderHeight = await page
    .locator('.site-header')
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(fallbackTriggerBox).not.toBeNull();
  await expect.poll(() => page.evaluate(() => Boolean(window.swup))).toBe(true);

  await fallback.locator('summary').click();
  await fallback.locator('a[href="/en/about/"]').click();
  await expect(page).toHaveURL(/\/en\/about\/$/);
  await expect
    .poll(() => page.locator('#site-chrome-context').evaluate((element) => element.textContent))
    .toContain('"pathname":"/en/about/"');
  await expect(page.locator('[data-site-header-sync="home"]')).toHaveAttribute(
    'aria-current',
    'page',
  );

  releaseSiteChrome?.();
  await initialNavigation;
  await expect(page.locator('html')).toHaveAttribute('data-site-chrome-ready', 'true');
  await expect(fallback).toBeHidden();
  const enhancedTrigger = page.locator('[data-site-menu-trigger]');
  await expect(enhancedTrigger).toBeVisible();
  const enhancedTriggerBox = await enhancedTrigger.boundingBox();
  const enhancedHeaderHeight = await page
    .locator('.site-header')
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(enhancedTriggerBox).not.toBeNull();
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(enhancedTriggerBox![key] - fallbackTriggerBox![key])).toBeLessThan(0.5);
  }
  expect(Math.abs(enhancedHeaderHeight - fallbackHeaderHeight)).toBeLessThan(0.5);
  await expect(page.locator('[data-site-header-sync="mobile-about"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.locator('[data-site-header-sync="home"]')).not.toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('keyboard navigation moves focus to main content and announces in the page language', async ({
  page,
}) => {
  await page.goto('/zh/');
  const aboutLink = page.locator('[data-site-header-sync="desktop-about"]');
  await aboutLink.focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/zh\/about\/$/);
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.locator('#swup-announcer')).toContainText(/^已导航至：/);
});

test('a hard refresh does not replay below-fold reveal animations', async ({ page }) => {
  await page.goto('/en/');
  await expect
    .poll(() => page.locator('[data-reveal][style*="opacity"]').count())
    .toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator('[data-reveal][style*="opacity"]')).toHaveCount(0);
});

test('a reveal setup canceled at the swap boundary cannot resume after fonts load', async ({
  page,
}) => {
  let releaseFonts: (() => void) | undefined;
  let reportFontRequest: (() => void) | undefined;
  const fontsReleased = new Promise<void>((resolve) => {
    releaseFonts = resolve;
  });
  const fontRequested = new Promise<void>((resolve) => {
    reportFontRequest = resolve;
  });
  await page.route(/\.woff2(?:\?.*)?$/, async (route) => {
    reportFontRequest?.();
    await fontsReleased;
    await route.continue();
  });

  await page.goto('/en/', { waitUntil: 'domcontentloaded' });
  await fontRequested;
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'cold');
  await expect(page.locator('body')).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('body')).toHaveCSS('opacity', '0.12');

  await page.evaluate(() => document.dispatchEvent(new Event('site:before-swap')));
  releaseFonts?.();
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  await expect(page.locator('body')).toHaveCSS('pointer-events', 'auto');
  await page.waitForTimeout(100);
  await expect(page.locator('[data-reveal][style*="opacity"]')).toHaveCount(0);
});

test('the first document frame keeps content geometry stable with the site typefaces', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('wallpaper-enabled', 'false');
    Object.defineProperty(window, '__cumulativeLayoutShift', {
      configurable: true,
      value: 0,
      writable: true,
    });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
        if (!shift.hadRecentInput) {
          (window as typeof window & { __cumulativeLayoutShift: number }).__cumulativeLayoutShift +=
            shift.value ?? 0;
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });

  await page.goto('/en/blog/closed-loop-control-timing/');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  const initialBox = await heading.boundingBox();
  expect(initialBox).not.toBeNull();

  await page.waitForTimeout(300);
  expect(
    await page.evaluate(
      () => (window as typeof window & { __cumulativeLayoutShift: number }).__cumulativeLayoutShift,
    ),
  ).toBeLessThan(0.01);
  await expect(page.locator('body')).toHaveCSS('font-family', /Source Sans 3 Variable/);
  await expect(heading).toHaveCSS('font-family', /Manrope Variable/);

  await page.reload();
  await expect(heading).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  const reloadedBox = await heading.boundingBox();
  expect(reloadedBox).not.toBeNull();
  expect(Math.abs(reloadedBox!.x - initialBox!.x)).toBeLessThan(0.5);
  expect(Math.abs(reloadedBox!.y - initialBox!.y)).toBeLessThan(0.5);
  expect(Math.abs(reloadedBox!.width - initialBox!.width)).toBeLessThan(0.5);
  expect(Math.abs(reloadedBox!.height - initialBox!.height)).toBeLessThan(0.5);

  await page.waitForTimeout(300);
  expect(
    await page.evaluate(
      () => (window as typeof window & { __cumulativeLayoutShift: number }).__cumulativeLayoutShift,
    ),
  ).toBeLessThan(0.01);
});

test('code blocks use the Latin and Chinese code typefaces from the shared font contract', async ({
  page,
}) => {
  await page.goto('/zh/blog/git-operations-reference/');
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');

  const code = page.locator('.expressive-code code').first();
  await expect(code).toBeVisible();
  await expect(code).toHaveCSS('font-family', /JetBrains Mono Variable.*Noto Sans SC Variable/);

  expect(
    await page.evaluate(() => {
      const statuses = [...document.fonts].map(({ family, status }) => ({ family, status }));
      return {
        latin: statuses.some(
          ({ family, status }) => family === 'JetBrains Mono Variable' && status === 'loaded',
        ),
        cjk: statuses.some(
          ({ family, status }) => family === 'Noto Sans SC Variable' && status === 'loaded',
        ),
      };
    }),
  ).toEqual({ latin: true, cjk: true });
});

test('article information and both tables of contents are present without client JavaScript', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  await page.goto('/en/blog/closed-loop-control-timing/');

  const sidebar = page.locator('[data-article-sidebar-column]');
  const articleInformation = sidebar.locator('[aria-labelledby="article-info-heading"]');
  await expect(articleInformation).toContainText('Article information');
  await expect(articleInformation).toContainText('First published');
  await expect(articleInformation).toContainText('Last updated');
  await expect(sidebar.locator('.js-toc a')).toHaveCount(7);
  await expect(sidebar.locator('.js-toc a').first()).toHaveText('Interactive timing diagram');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#article-toc-mobile a')).toHaveCount(7);

  await context.close();
});

test('the article table of contents restores its active section without rebuilding SSR links', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const probe = new MutationObserver(() => {
      const link = document.querySelector<HTMLAnchorElement>(
        '[data-article-sidebar-column] [data-article-toc] a[href="#analysis"]',
      );
      if (!link) return;

      (
        window as typeof window & {
          __initialArticleTocLink?: HTMLAnchorElement;
        }
      ).__initialArticleTocLink = link;
      probe.disconnect();

      if (sessionStorage.getItem('capture-article-toc-first-frame') !== 'true') return;
      requestAnimationFrame(() => {
        const active = document.querySelector<HTMLAnchorElement>(
          '[data-article-sidebar-column] [data-article-toc] a.is-active-link',
        );
        sessionStorage.setItem('article-toc-first-frame-href', active?.getAttribute('href') ?? '');
      });
    });
    probe.observe(document, { childList: true, subtree: true });
  });

  await page.goto('/en/blog/closed-loop-control-timing/');
  const analysisLink = page.locator(
    '[data-article-sidebar-column] [data-article-toc] a[href="#analysis"]',
  );
  await analysisLink.click();
  await expect(analysisLink).toHaveClass(/is-active-link/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem('article-section:/en/blog/closed-loop-control-timing/'),
      ),
    )
    .toBe('analysis');
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __initialArticleTocLink?: HTMLAnchorElement;
          }
        ).__initialArticleTocLink ===
        document.querySelector(
          '[data-article-sidebar-column] [data-article-toc] a[href="#analysis"]',
        ),
    ),
  ).toBe(true);

  await page.evaluate(() => {
    sessionStorage.setItem('capture-article-toc-first-frame', 'true');
    sessionStorage.removeItem('article-toc-first-frame-href');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('article-toc-first-frame-href')))
    .toBe('#analysis');
  await expect(analysisLink).toHaveClass(/is-active-link/);
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & {
            __initialArticleTocLink?: HTMLAnchorElement;
          }
        ).__initialArticleTocLink ===
        document.querySelector(
          '[data-article-sidebar-column] [data-article-toc] a[href="#analysis"]',
        ),
    ),
  ).toBe(true);
  await page.evaluate(() => {
    sessionStorage.removeItem('capture-article-toc-first-frame');
    sessionStorage.removeItem('article-toc-first-frame-href');
  });
});

test('article table-of-contents clicks keep their target and selected section stable', async ({
  page,
}) => {
  await page.goto('/zh/blog/frenet-vehicle-kinematics/');
  const link = page.locator(
    '[data-article-sidebar-column] [data-article-toc] a[href="#时间域模型中的倒车"]',
  );
  await expect(link).toBeVisible();

  await link.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const point = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    const samples: Array<{ sameTarget: boolean; cursor: string | undefined }> = [];
    Object.defineProperty(window, '__articleTocHitTests', {
      configurable: true,
      value: samples,
    });
    const sample = () => {
      const target = document.elementFromPoint(point.x, point.y);
      const interactive = target?.closest<HTMLAnchorElement>(
        '[data-article-sidebar-column] [data-article-toc] a[href="#时间域模型中的倒车"]',
      );
      samples.push({
        sameTarget: interactive === element,
        cursor: interactive ? getComputedStyle(interactive).cursor : undefined,
      });
      if (samples.length < 20) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await link.click();

  await expect(page).toHaveURL(
    /#%E6%97%B6%E9%97%B4%E5%9F%9F%E6%A8%A1%E5%9E%8B%E4%B8%AD%E7%9A%84%E5%80%92%E8%BD%A6$/,
  );
  await expect(link).toHaveClass(/is-active-link/);
  await expect(link).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __articleTocHitTests?: Array<{ sameTarget: boolean; cursor?: string }>;
            }
          ).__articleTocHitTests?.length ?? 0,
      ),
    )
    .toBe(20);
  const hitTests = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __articleTocHitTests?: Array<{ sameTarget: boolean; cursor?: string }>;
        }
      ).__articleTocHitTests ?? [],
  );
  expect(hitTests.filter(({ sameTarget, cursor }) => !sameTarget || cursor !== 'pointer')).toEqual(
    [],
  );
});

test('the neutral entry honors saved preference before system language', async ({ browser }) => {
  const savedPreference = await browser.newContext({ locale: 'en-US' });
  const savedPreferencePage = await savedPreference.newPage();
  await savedPreferencePage.addInitScript(() => {
    localStorage.setItem('PARAGLIDE_LOCALE', 'zh');
  });
  await savedPreferencePage.goto('/');
  await expect(savedPreferencePage).toHaveURL(/\/zh\/$/);
  await savedPreference.close();

  const systemPreference = await browser.newContext({ locale: 'zh-CN' });
  const systemPreferencePage = await systemPreference.newPage();
  await systemPreferencePage.goto('/');
  await expect(systemPreferencePage).toHaveURL(/\/zh\/$/);
  await systemPreference.close();
});

test('theme choice survives client-side navigation', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('wallpaper-enabled', 'false');
  });
  await page.goto('/en/');
  const root = page.locator('html');
  await expect(root).toHaveClass(/dark/);
  const themeButton = page.locator('[data-theme-toggle]:visible').first();
  await expect(themeButton).toHaveAccessibleName('Switch to light mode');

  const { transitionProbe, hitTests } = await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
    if (!button) throw new Error('The theme button is missing.');
    const bounds = button.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    const hitTests: Array<{
      sameTarget: boolean;
      cursor: string | undefined;
      hitTag: string | undefined;
      hitClass: string | undefined;
      transitioning: boolean;
    }> = [];
    button.click();
    const transitionProbe = {
      documentTransition: document.documentElement.classList.contains('theme-transitioning'),
      outletTransition: document.querySelector('#swup')?.classList.contains('theme-transitioning'),
      oldAnimation: getComputedStyle(document.documentElement, '::view-transition-old(root)')
        .animationName,
      newAnimation: getComputedStyle(document.documentElement, '::view-transition-new(root)')
        .animationName,
    };
    for (let frame = 0; frame < 45; frame += 1) {
      await new Promise(requestAnimationFrame);
      const target = document.elementFromPoint(x, y);
      const interactive = target?.closest<HTMLButtonElement>('[data-theme-toggle]');
      hitTests.push({
        sameTarget: interactive === button,
        cursor: interactive ? getComputedStyle(interactive).cursor : undefined,
        hitTag: target?.tagName,
        hitClass:
          target instanceof Element ? (target.getAttribute('class') ?? undefined) : undefined,
        transitioning: document.documentElement.classList.contains('theme-transitioning'),
      });
    }
    return {
      transitionProbe,
      hitTests,
    };
  });
  expect(transitionProbe).toEqual({
    documentTransition: true,
    outletTransition: false,
    oldAnimation: 'none',
    newAnimation: 'theme-reveal',
  });
  expect(
    hitTests.filter(({ sameTarget, cursor, hitTag, transitioning }) => {
      if (sameTarget) return cursor !== 'pointer';
      return hitTag !== 'HTML' || !transitioning;
    }),
  ).toEqual([]);
  expect(hitTests.at(-1)).toMatchObject({
    sameTarget: true,
    cursor: 'pointer',
    transitioning: false,
  });
  await expect(root).not.toHaveClass(/dark/);
  await expect(root).not.toHaveClass(/theme-transitioning/);
  await expect(themeButton).toHaveAccessibleName('Switch to dark mode');

  await page.locator('header nav').first().locator('a[href="/en/blog/"]').click();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect(root).not.toHaveClass(/dark/);
});

test('theme and wallpaper mode change independently without replacing the current photo', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'light');
    localStorage.setItem('wallpaper-enabled', 'true');
    localStorage.setItem('wallpaper-auto-rotation', 'false');
  });

  const photo = {
    id: 'four-mode-photo',
    createdAt: '2026-08-15T00:00:00.000Z',
    blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    rawUrl: 'https://images.unsplash.com/four-mode-photo',
    photographerName: 'Photographer',
    photographerUrl: 'https://unsplash.com/@photographer',
    photoUrl: 'https://unsplash.com/photos/four-mode-photo',
  };
  let manifestRequests = 0;
  let imageRequests = 0;
  await page.route('**/api/wallpapers', (route) => {
    manifestRequests += 1;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ version: 2, updatedAt: photo.createdAt, photos: [photo] }),
    });
  });
  await page.route('https://images.unsplash.com/**', (route) => {
    imageRequests += 1;
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"/>',
    });
  });

  await page.goto('/en/');
  const html = page.locator('html');
  const media = page.locator('[data-wallpaper-media]');
  const activeImage = page.locator('[data-wallpaper-image].is-active');
  await expect(html).not.toHaveClass(/dark/);
  await expect(html).toHaveAttribute('data-wallpaper-mode', 'scenic');
  await expect(activeImage).toHaveCount(1);
  const initialImageState = await activeImage.evaluate((image) => ({
    id: (image as HTMLElement).dataset.wallpaperPhotoId,
    src: (image as HTMLImageElement).currentSrc,
  }));
  const initialManifestRequests = manifestRequests;
  const initialImageRequests = imageRequests;

  await page.locator('[data-theme-toggle]:visible').first().click();
  await expect(html).toHaveClass(/dark/);
  await expect(html).toHaveAttribute('data-wallpaper-mode', 'scenic');
  await expect
    .poll(() =>
      activeImage.evaluate((image) => ({
        id: (image as HTMLElement).dataset.wallpaperPhotoId,
        src: (image as HTMLImageElement).currentSrc,
      })),
    )
    .toEqual(initialImageState);

  const wallpaperControl = page.locator('[data-wallpaper-control]:visible').first();
  await wallpaperControl.locator('[data-wallpaper-menu-trigger]').click();
  await wallpaperControl.locator('[data-wallpaper-enabled-control]').click();
  await expect(html).toHaveClass(/dark/);
  await expect(html).toHaveAttribute('data-wallpaper-mode', 'default');
  await expect(activeImage).toHaveCount(1);
  await expect.poll(() => media.evaluate((element) => getComputedStyle(element).opacity)).toBe('0');

  await page.locator('[data-theme-toggle]:visible').first().click();
  await expect(html).not.toHaveClass(/dark/);
  await expect(html).toHaveAttribute('data-wallpaper-mode', 'default');
  await expect(activeImage).toHaveCount(1);

  await wallpaperControl.locator('[data-wallpaper-menu-trigger]').click();
  await wallpaperControl.locator('[data-wallpaper-enabled-control]').click();
  await expect(html).not.toHaveClass(/dark/);
  await expect(html).toHaveAttribute('data-wallpaper-mode', 'scenic');
  await expect.poll(() => media.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
  await expect
    .poll(() =>
      activeImage.evaluate((image) => ({
        id: (image as HTMLElement).dataset.wallpaperPhotoId,
        src: (image as HTMLImageElement).currentSrc,
      })),
    )
    .toEqual(initialImageState);

  await page.locator('[data-site-header-sync="desktop-blog"]').click();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect
    .poll(() =>
      activeImage.evaluate((image) => ({
        id: (image as HTMLElement).dataset.wallpaperPhotoId,
        src: (image as HTMLImageElement).currentSrc,
      })),
    )
    .toEqual(initialImageState);
  expect(manifestRequests).toBe(initialManifestRequests);
  expect(imageRequests).toBe(initialImageRequests);
});

test('a hard refresh keeps the same clear wallpaper without replacing its background layer', async ({
  page,
}) => {
  const photo = {
    id: 'stored-photo',
    createdAt: '2026-08-15T00:00:00.000Z',
    blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    rawUrl: 'https://images.unsplash.com/stored-photo',
    photographerName: 'Photographer',
    photographerUrl: 'https://unsplash.com/@photographer',
    photoUrl: 'https://unsplash.com/photos/stored-photo',
  };
  await page.addInitScript(() => localStorage.setItem('wallpaper-enabled', 'true'));

  await page.route('**/api/wallpapers', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ version: 2, updatedAt: photo.createdAt, photos: [photo] }),
    }),
  );
  let imageRequests = 0;
  await page.route('https://images.unsplash.com/**', (route) => {
    imageRequests += 1;
    return route.fulfill({
      contentType: 'image/svg+xml',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><path fill="#5b7088" d="M0 0h1600v900H0z"/></svg>',
    });
  });

  await page.goto('/en/');
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = JSON.parse(sessionStorage.getItem('wallpaper-current-background') ?? 'null');
        return value?.kind;
      }),
    )
    .toBe('poster');
  const storedPoster = await page.evaluate(() =>
    sessionStorage.getItem('wallpaper-current-background'),
  );
  expect(storedPoster).toContain('data:image/');

  await page.addInitScript(() => {
    if (!sessionStorage.getItem('wallpaper-current-background')) return;
    sessionStorage.removeItem('wallpaper-first-frame-state');

    const captureFirstFrame = () => {
      const boot = document.querySelector<HTMLElement>('.wallpaper__boot');
      const bootImage = document.querySelector<HTMLElement>('.wallpaper__boot-image');
      const credit = document.querySelector<HTMLElement>('[data-wallpaper-credit]');
      if (!boot || !bootImage || !credit) return false;

      window.requestAnimationFrame(() => {
        const style = getComputedStyle(boot);
        const photographer = credit.querySelector<HTMLAnchorElement>(
          '[data-wallpaper-credit-photographer]',
        );
        sessionStorage.setItem(
          'wallpaper-first-frame-state',
          JSON.stringify({
            backgroundImage: getComputedStyle(bootImage).backgroundImage,
            opacity: Number.parseFloat(style.opacity),
            visibility: style.visibility,
            creditHidden: credit.hidden,
            creditText: credit.textContent?.replace(/\s+/g, ' ').trim(),
            photographerHref: photographer?.href,
          }),
        );
      });
      return true;
    };

    const observer = new MutationObserver(() => {
      if (captureFirstFrame()) observer.disconnect();
    });
    if (!captureFirstFrame()) observer.observe(document, { childList: true, subtree: true });
  });

  imageRequests = 0;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-background', photo.id);
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-background-kind', 'poster');
  await expect(page.locator('[data-wallpaper-media]')).not.toHaveAttribute(
    'data-wallpaper-ready',
    photo.id,
  );
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(sessionStorage.getItem('wallpaper-first-frame-state') ?? 'null'),
      ),
    )
    .toEqual(expect.any(Object));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = JSON.parse(sessionStorage.getItem('wallpaper-first-frame-state') ?? 'null');
        return value?.visibility !== 'hidden' && value?.opacity > 0
          ? value.backgroundImage
          : undefined;
      }),
    )
    .toContain('data:image/');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = JSON.parse(sessionStorage.getItem('wallpaper-first-frame-state') ?? 'null');
        return {
          hidden: value?.creditHidden,
          text: value?.creditText,
          photographerHref: value?.photographerHref,
        };
      }),
    )
    .toEqual({
      hidden: false,
      text: 'Photo by Photographer on Unsplash',
      photographerHref: photo.photographerUrl,
    });
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('wallpaper-current-background')))
    .toBe(storedPoster);
  await expect.poll(() => imageRequests).toBe(0);

  // The controls are restored to a ready state before hydration, so they must not
  // keep the inert state the server rendered them with.
  await page.locator('[data-wallpaper-menu-trigger]').click();
  const settings = page.locator('[data-wallpaper-menu]');
  await expect(settings.locator('[data-wallpaper-download]')).toBeEnabled();
  await expect(settings.locator('[data-wallpaper-auto-rotation]')).toBeEnabled();
  // This manifest holds a single photo, so advancing genuinely has no target.
  await expect(settings.locator('[data-wallpaper-refresh]')).toBeDisabled();
});

test('the wallpaper recovers from failure and cycles without repeats', async ({ page }) => {
  const manifest = {
    version: 2,
    updatedAt: '2026-08-14T00:00:00.000Z',
    photos: [1, 2, 3].map((index) => ({
      id: `photo-${index}`,
      createdAt: `2026-08-1${index}T00:00:00.000Z`,
      blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
      rawUrl: `https://images.unsplash.com/photo-${index}`,
      photographerName: `Photographer ${index}`,
      photographerUrl: `https://unsplash.com/@photographer-${index}`,
      photoUrl: `https://unsplash.com/photos/photo-${index}`,
    })),
  };
  const image = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"></svg>';
  let manifestRequests = 0;
  let downloadReports = 0;
  let imageGate: Promise<void> | undefined;
  let releaseImageGate: (() => void) | undefined;
  await page.route('**/api/wallpapers', (route) => {
    manifestRequests += 1;
    return manifestRequests === 1
      ? route.fulfill({ status: 503 })
      : route.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) });
  });
  await page.route('**/api/wallpapers/download', (route) => {
    downloadReports += 1;
    return route.fulfill({ status: 202 });
  });
  await page.route('https://images.unsplash.com/**', async (route) => {
    await imageGate;
    return route.fulfill({ contentType: 'image/svg+xml', body: image });
  });

  await page.goto('/en/');
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'scenic');
  await expect.poll(() => manifestRequests).toBe(1);
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(0);

  await page.locator('header nav').first().locator('a[href="/en/blog/"]').click();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect.poll(() => manifestRequests).toBe(2);
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(1);
  await expect(page.locator('[data-wallpaper-credit]')).toBeVisible();
  await expect(page.locator('[data-wallpaper-credit]')).toContainText('Photo by Photographer');
  const selectedId = await page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id'));
  expect(selectedId).toMatch(/^photo-[123]$/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = JSON.parse(sessionStorage.getItem('wallpaper-current-background') ?? 'null');
        return value?.photoId;
      }),
    )
    .toBe(selectedId);
  expect(downloadReports).toBe(0);
  await page.locator('.wallpaper__images').evaluate((element) => {
    (element as HTMLElement).dataset.persistenceMarker = 'original';
  });

  await page.locator('header nav').first().locator('a[href="/en/projects/"]').click();
  await expect(page).toHaveURL(/\/en\/projects\/$/);
  await expect(page.locator('.wallpaper__images')).toHaveAttribute(
    'data-persistence-marker',
    'original',
  );
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id')))
    .toBe(selectedId);
  expect(downloadReports).toBe(0);

  const wallpaperControl = page.locator('[data-wallpaper-control]:visible').first();
  const wallpaperTrigger = wallpaperControl.locator('[data-wallpaper-menu-trigger]');
  const wallpaperPanel = wallpaperControl.locator('[data-wallpaper-menu]');
  await wallpaperTrigger.click();
  await expect(wallpaperControl.locator('[data-wallpaper-enabled]')).toBeChecked();
  await expect(wallpaperControl.locator('[data-wallpaper-auto-rotation]')).toBeChecked();

  const triggerBox = await wallpaperTrigger.boundingBox();
  const panelBox = await wallpaperPanel.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(
    Math.abs(panelBox!.x + panelBox!.width - (triggerBox!.x + triggerBox!.width)),
  ).toBeLessThan(2);
  expect(panelBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height);

  const autoRotationControl = wallpaperControl.locator('[data-wallpaper-auto-rotation]');
  const autoRotationRow = wallpaperControl.locator('[data-wallpaper-auto-rotation-control]');
  const refreshButton = wallpaperControl.locator('[data-wallpaper-refresh]');
  const downloadButton = wallpaperControl.locator('[data-wallpaper-download]');
  const autoRotationOpacity = await autoRotationRow.evaluate(
    (element) => getComputedStyle(element).opacity,
  );
  imageGate = new Promise((resolve) => {
    releaseImageGate = resolve;
  });
  await refreshButton.click();
  await expect(refreshButton).toHaveAttribute('aria-busy', 'true');
  await expect(refreshButton).toBeEnabled();
  await expect
    .poll(() => refreshButton.evaluate((element) => getComputedStyle(element).cursor))
    .toBe('pointer');
  await expect(autoRotationControl).not.toBeDisabled();
  await expect
    .poll(() => autoRotationRow.evaluate((element) => getComputedStyle(element).opacity))
    .toBe(autoRotationOpacity);
  releaseImageGate?.();
  imageGate = undefined;
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id')))
    .not.toBe(selectedId);
  expect(downloadReports).toBe(0);

  const secondId = await page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id'));
  await refreshButton.click();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id')))
    .not.toBe(secondId);
  const thirdId = await page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id'));
  expect(new Set([selectedId, secondId, thirdId]).size).toBe(3);
  expect(downloadReports).toBe(0);

  const fixedId = await page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id'));
  await autoRotationRow.click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wallpaper-auto-rotation')))
    .toBe('false');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wallpaper-fixed-photo-id')))
    .toBe(fixedId);

  await page.locator('header nav').first().locator('a[href="/en/about/"]').click();
  await expect(page).toHaveURL(/\/en\/about\/$/);
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id')))
    .toBe(fixedId);
  await wallpaperControl.locator('[data-wallpaper-menu-trigger]').click();
  await expect(autoRotationControl).not.toBeChecked();

  const fadeOut = await wallpaperControl
    .locator('[data-wallpaper-enabled-control]')
    .evaluate(async (control) => {
      const media = document.querySelector<HTMLElement>('[data-wallpaper-media]');
      if (!media) throw new Error('The wallpaper media layer is missing.');
      const start = Number.parseFloat(getComputedStyle(media).opacity);
      (control as HTMLElement).click();
      let middle = start;
      for (let frame = 0; frame < 12 && middle === start; frame += 1) {
        await new Promise(requestAnimationFrame);
        middle = Number.parseFloat(getComputedStyle(media).opacity);
      }
      return {
        start,
        middle,
        hasOpacityTransition: media
          .getAnimations()
          .some(
            (animation) =>
              animation instanceof CSSTransition &&
              animation.transitionProperty === 'opacity' &&
              animation.playState === 'running',
          ),
      };
    });
  expect(fadeOut.start).toBeGreaterThan(0.9);
  expect(fadeOut.middle).toBeGreaterThan(0);
  expect(fadeOut.middle).toBeLessThan(fadeOut.start);
  expect(fadeOut.hasOpacityTransition).toBe(true);
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(1);
  await expect(page.locator('[data-wallpaper-credit]')).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wallpaper-enabled')))
    .toBe('false');
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'default');
  await expect(autoRotationControl).toBeDisabled();
  await expect
    .poll(() => autoRotationRow.evaluate((element) => getComputedStyle(element).opacity))
    .toBe('0.4');
  await expect(refreshButton).toBeDisabled();
  await expect(downloadButton).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id')))
    .toBe(fixedId);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'default');
  await expect.poll(() => manifestRequests).toBe(2);
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(0);
  await wallpaperControl.locator('[data-wallpaper-menu-trigger]').click();
  await expect(wallpaperControl.locator('[data-wallpaper-enabled]')).not.toBeChecked();
  await expect(autoRotationControl).not.toBeChecked();

  const fadeIn = await wallpaperControl
    .locator('[data-wallpaper-enabled-control]')
    .evaluate(async (control) => {
      const boot = document.querySelector<HTMLElement>('.wallpaper__boot');
      if (!boot) throw new Error('The wallpaper boot layer is missing.');
      const start = Number.parseFloat(getComputedStyle(boot).opacity);
      (control as HTMLElement).click();
      let middle = start;
      for (let frame = 0; frame < 12 && middle === start; frame += 1) {
        await new Promise(requestAnimationFrame);
        middle = Number.parseFloat(getComputedStyle(boot).opacity);
      }
      return {
        start,
        middle,
        hasOpacityTransition: boot
          .getAnimations()
          .some(
            (animation) =>
              animation instanceof CSSTransition &&
              animation.transitionProperty === 'opacity' &&
              animation.playState === 'running',
          ),
      };
    });
  expect(fadeIn.start).toBe(0);
  expect(fadeIn.middle).toBeGreaterThan(fadeIn.start);
  expect(fadeIn.middle).toBeLessThan(1);
  expect(fadeIn.hasOpacityTransition).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'scenic');
  await expect.poll(() => manifestRequests).toBe(3);
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number.parseFloat(
          getComputedStyle(document.querySelector<HTMLElement>('.wallpaper__boot')!).opacity,
        ),
      ),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wallpaper-enabled')))
    .toBe('true');
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id')))
    .toBe(fixedId);
  await expect
    .poll(() => autoRotationRow.evaluate((element) => getComputedStyle(element).opacity))
    .toBe(autoRotationOpacity);

  const downloadStarted = page.waitForEvent('download');
  await downloadButton.click();
  const downloadedWallpaper = await downloadStarted;
  expect(downloadedWallpaper.suggestedFilename()).toBe(`unsplash-${fixedId}.jpg`);
  await expect.poll(() => downloadReports).toBe(1);

  await autoRotationRow.click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wallpaper-auto-rotation')))
    .toBe('true');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wallpaper-fixed-photo-id')))
    .toBeNull();
});

test('wallpaper manifest refresh preserves the current photo and reconciles the queue', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let now = Date.now();
    Date.now = () => now;
    Object.defineProperty(window, '__advanceWallpaperClock', {
      value: (milliseconds: number) => {
        now += milliseconds;
      },
    });
    localStorage.setItem('wallpaper-auto-rotation', 'false');
  });

  const photo = (index: number) => ({
    id: `photo-${index}`,
    createdAt: `2026-08-1${index}T00:00:00.000Z`,
    blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    rawUrl: `https://images.unsplash.com/photo-${index}`,
    photographerName: `Photographer ${index}`,
    photographerUrl: `https://unsplash.com/@photographer-${index}`,
    photoUrl: `https://unsplash.com/photos/photo-${index}`,
  });
  const initialManifest = {
    version: 2 as const,
    updatedAt: '2026-08-14T00:00:00.000Z',
    photos: [1, 2, 3, 4].map(photo),
  };
  let servedManifest = initialManifest;
  let manifestRequests = 0;
  const imageRequests: string[] = [];
  const image = '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"></svg>';

  await page.route('**/api/wallpapers', (route) => {
    manifestRequests += 1;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(servedManifest),
    });
  });
  await page.route('https://images.unsplash.com/**', (route) => {
    imageRequests.push(route.request().url());
    return route.fulfill({ contentType: 'image/svg+xml', body: image });
  });

  await page.goto('/en/');
  await expect.poll(() => manifestRequests).toBe(1);
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(1);

  const currentId = await page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id'));
  const queueBefore = await page.evaluate<string[]>(() =>
    JSON.parse(sessionStorage.getItem('wallpaper-photo-queue') ?? '[]'),
  );
  expect(currentId).toMatch(/^photo-[1-4]$/);
  expect(queueBefore).toHaveLength(3);

  const removedId = queueBefore[0]!;
  const retainedIds = queueBefore.slice(1);
  servedManifest = {
    version: 2,
    updatedAt: '2026-08-15T00:00:00.000Z',
    photos: [...initialManifest.photos.filter((entry) => entry.id !== removedId), photo(5)],
  };

  await page.evaluate(() => {
    const controlledWindow = window as typeof window & {
      __advanceWallpaperClock: (milliseconds: number) => void;
    };
    controlledWindow.__advanceWallpaperClock(30 * 60 * 1000);
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await expect.poll(() => manifestRequests).toBe(2);
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id')))
    .toBe(currentId);
  await expect
    .poll(() =>
      page.evaluate<string[]>(() =>
        JSON.parse(sessionStorage.getItem('wallpaper-photo-queue') ?? '[]'),
      ),
    )
    .toEqual(expect.arrayContaining([...retainedIds, 'photo-5']));

  const queueAfter = await page.evaluate<string[]>(() =>
    JSON.parse(sessionStorage.getItem('wallpaper-photo-queue') ?? '[]'),
  );
  expect(queueAfter).toHaveLength(retainedIds.length + 1);
  expect(queueAfter).not.toContain(removedId);
  expect(imageRequests.some((url) => url.includes('photo-5'))).toBe(false);
});

test('the motion-control project preview supports continuous two-dimensional dragging', async ({
  page,
}) => {
  await page.goto('/zh/projects/');

  const project = page.locator('article').filter({ hasText: '自动驾驶运动控制' });
  const visual = project.locator('.motion-control-project-visual');
  const handle = visual.locator('[data-vehicle-drag-handle]');
  await expect(visual.locator('svg')).toBeVisible();
  await expect(visual.locator('.vega-view')).toHaveCount(0);
  await expect(visual.locator('.motion-control-vehicle-body')).toHaveCount(1);
  await expect(visual.locator('.motion-control-vehicle-cabin')).toHaveCount(0);
  await expect(visual.locator('.motion-control-wheel')).toHaveCount(4);
  await expect(visual.locator('[data-wheel-axle="front"]')).toHaveCount(2);
  await expect(visual.locator('[data-motion-label]')).toHaveCount(0);
  await expect(visual.locator('.motion-control-steering-arc')).toHaveCount(0);

  const initial = await visual.evaluate((element) => ({
    x: Number(element.getAttribute('data-vehicle-x')),
    y: Number(element.getAttribute('data-vehicle-y')),
    heading: Number(element.getAttribute('data-heading-angle')),
  }));
  const initialFrontWheelAngles = await visual
    .locator('[data-wheel-axle="front"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-wheel-angle')));
  const handleBox = await handle.boundingBox();
  expect(handleBox).not.toBeNull();

  const startX = handleBox!.x + handleBox!.width / 2;
  const startY = handleBox!.y + handleBox!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 36, startY - 22, { steps: 3 });

  const duringDrag = await visual.evaluate((element) => ({
    x: Number(element.getAttribute('data-vehicle-x')),
    y: Number(element.getAttribute('data-vehicle-y')),
    heading: Number(element.getAttribute('data-heading-angle')),
    lateralError: Number(element.getAttribute('data-lateral-error')),
    steering: Number(element.getAttribute('data-steering-angle')),
  }));
  expect(duringDrag.x).not.toBe(initial.x);
  expect(duringDrag.y).not.toBe(initial.y);
  expect(duringDrag.heading).toBe(initial.heading);
  expect(Math.sign(duringDrag.steering)).toBe(-Math.sign(duringDrag.lateralError));
  await expect
    .poll(() =>
      visual
        .locator('[data-wheel-axle="front"]')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-wheel-angle')),
        ),
    )
    .not.toEqual(initialFrontWheelAngles);

  await page.mouse.move(startX + 70, startY - 46, { steps: 3 });
  await page.mouse.up();
  await expect(visual).not.toHaveAttribute('data-dragging', '');
  await expect(visual.locator('[data-motion-label]')).toHaveCount(0);
});

test('tag filtering keeps the complete facet list and fixed global counts', async ({ page }) => {
  await page.goto('/en/blog/');

  const filters = page.locator('[data-tag-filter]');
  const initialFilters = await filters.evaluateAll((elements) =>
    elements.map((element) => ({
      name: element.getAttribute('data-tag-filter'),
      slug: element.getAttribute('data-tag-slug'),
      count: Number(element.getAttribute('data-tag-count')),
    })),
  );
  const initialArticleCount = await page.locator('[data-blog-article]').count();
  const firstArticle = page.locator('[data-blog-article]').first();
  const articleMetadata = firstArticle.locator('article > footer');
  await expect(articleMetadata.locator('time')).toHaveCount(1);
  await expect(articleMetadata).not.toContainText('First published');
  await expect(articleMetadata.locator('[data-article-tag]').first()).toBeVisible();
  await expect(firstArticle.locator('article > div time')).toHaveCount(0);
  const candidateIndex = initialFilters.findIndex(
    ({ count }) => count > 0 && count < initialArticleCount,
  );
  expect(candidateIndex).toBeGreaterThanOrEqual(0);
  const candidate = initialFilters[candidateIndex];
  if (!candidate?.name) throw new Error('Expected a non-empty tag filter fixture.');

  await filters.nth(candidateIndex).click();

  await expect(filters.nth(candidateIndex)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-blog-article]')).toHaveCount(candidate.count);
  await expect(filters).toHaveCount(initialFilters.length);
  await expect
    .poll(() =>
      filters.evaluateAll((elements) =>
        elements.map((element) => ({
          name: element.getAttribute('data-tag-filter'),
          slug: element.getAttribute('data-tag-slug'),
          count: Number(element.getAttribute('data-tag-count')),
        })),
      ),
    )
    .toEqual(initialFilters);
  const visibleArticleTags = await page
    .locator('[data-blog-article]')
    .evaluateAll((elements) =>
      elements.map((element) => JSON.parse(element.getAttribute('data-article-tags') ?? '[]')),
    );
  expect(visibleArticleTags.every((tags: string[]) => tags.includes(candidate.name!))).toBe(true);
  expect(new URL(page.url()).searchParams.getAll('tag')).toContain(candidate.slug);
});

test('tag filter panel remains stable while result height changes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/blog/');

  const filters = page.locator('[data-tag-filter]');
  const panel = page.locator('[data-tag-filter-panel]');
  expect(await filters.count()).toBeGreaterThanOrEqual(3);

  const panelTop = () =>
    panel.evaluate((element) => Math.round(element.getBoundingClientRect().top * 100) / 100);
  const initialTop = await panelTop();

  for (let index = 0; index < 3; index += 1) {
    await filters.nth(index).click();
    await expect(filters.nth(index)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(panelTop).toBe(initialTop);
  }

  await filters.nth(2).click();
  await expect(filters.nth(2)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(panelTop).toBe(initialTop);
});

test('version comparison loads on demand and supports both layouts', async ({ page }) => {
  await page.goto('/zh/blog/my-personal-website/');
  const comparisonLink = page.locator('[data-version-compare-link]').first();
  await expect(comparisonLink).toHaveAttribute('href', /\/compare\//);
  const comparisonHref = await comparisonLink.getAttribute('href');
  await page.goto(comparisonHref!);

  await expect(page.locator('[data-version-comparison]')).toBeVisible();
  const unifiedDiff = page.locator('[data-diff-panel="unified"]');
  await expect(unifiedDiff).toBeVisible();
  await expect(unifiedDiff.locator('.d2h-diff-table')).toHaveCSS(
    'font-family',
    /JetBrains Mono Variable.*Noto Sans SC Variable/,
  );
  expect(
    await page.evaluate(() =>
      [...document.fonts].some(
        ({ family, status }) => family === 'Noto Sans SC Variable' && status === 'loaded',
      ),
    ),
  ).toBe(true);
  await page.locator('[data-diff-mode="split"]:visible').click();
  await expect(page.locator('[data-diff-panel="split"]')).toBeVisible();
});
