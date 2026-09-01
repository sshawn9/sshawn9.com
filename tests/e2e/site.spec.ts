import { expect, test, type Page } from '@playwright/test';

const NESTED_SCROLL_POSITION_PREFIX = 'nested-scroll-position:';

async function readSavedNestedScrollTop(page: Page, restorationKey: string) {
  return page.evaluate(
    ({ prefix, restorationKey }) => {
      try {
        const storageKey = `${prefix}${location.pathname}:${restorationKey}`;
        const position = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
        return position?.top ?? 0;
      } catch {
        return 0;
      }
    },
    { prefix: NESTED_SCROLL_POSITION_PREFIX, restorationKey },
  );
}

type NestedScrollFrameProbe = {
  done: boolean;
  values: number[];
};

async function installNestedScrollFrameProbe(page: Page, restorationKey: string) {
  await page.addInitScript((key) => {
    const probe: NestedScrollFrameProbe = { done: false, values: [] };
    Object.defineProperty(window, '__nestedScrollFrameProbe', {
      configurable: true,
      value: probe,
    });

    let frame = 0;
    const sample = () => {
      const element = document.querySelector<HTMLElement>(
        `[data-scroll-restoration-key="${CSS.escape(key)}"]`,
      );
      const bodyVisible = document.body && getComputedStyle(document.body).visibility !== 'hidden';
      if (element && bodyVisible) probe.values.push(element.scrollTop);

      frame += 1;
      if (frame < 60) requestAnimationFrame(sample);
      else probe.done = true;
    };
    requestAnimationFrame(sample);
  }, restorationKey);
}

async function readNestedScrollFrameProbe(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __nestedScrollFrameProbe?: NestedScrollFrameProbe;
            }
          ).__nestedScrollFrameProbe?.done ?? false,
      ),
    )
    .toBe(true);

  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __nestedScrollFrameProbe?: NestedScrollFrameProbe;
        }
      ).__nestedScrollFrameProbe?.values ?? [],
  );
}

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

test('the article sidebar owns its modules and keeps its right edge and control stable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('wallpaper-enabled', 'false'));
  await page.goto('/en/blog/my-personal-website/');

  const layout = page.locator('[data-article-sidebar-layout]');
  const main = page.locator('[data-article-main]');
  const sidebar = page.locator('#article-sidebar');
  const sidebarScroll = page.locator('[data-article-sidebar-scroll]');
  const boundary = page.locator('[data-article-sidebar-boundary]');
  const resizer = page.getByRole('separator', { name: 'Resize article sidebar' });
  const collapseButton = page.getByRole('button', { name: 'Collapse article sidebar' });

  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveAccessibleName('Article information and navigation');
  await expect(
    sidebar.getByRole('heading', { level: 2, name: 'Article information' }),
  ).toBeVisible();
  await expect(sidebar.getByRole('heading', { level: 2, name: 'On this page' })).toBeVisible();
  await expect(sidebar.getByRole('heading', { level: 2, name: 'Versions' })).toBeVisible();
  await expect(sidebar.getByRole('heading', { level: 2, name: 'Article overview' })).toHaveCount(0);
  await expect(boundary).toBeVisible();
  await expect(resizer).toHaveAttribute('aria-valuemin', '208');
  await expect(resizer).toHaveAttribute('aria-valuemax', '352');
  await expect(resizer).toHaveAttribute('aria-valuenow', '224');

  const initialLayoutBox = await layout.boundingBox();
  const initialMainBox = await main.boundingBox();
  const initialSidebarBox = await sidebar.boundingBox();
  const initialSidebarScrollBox = await sidebarScroll.boundingBox();
  const initialToggleBox = await collapseButton.boundingBox();
  const initialResizerBox = await resizer.boundingBox();
  expect(initialLayoutBox).not.toBeNull();
  expect(initialMainBox).not.toBeNull();
  expect(initialSidebarBox).not.toBeNull();
  expect(initialSidebarScrollBox).not.toBeNull();
  expect(initialToggleBox).not.toBeNull();
  expect(initialResizerBox).not.toBeNull();
  expect(initialSidebarBox!.width).toBeCloseTo(224, 0);
  expect(initialSidebarBox!.x - (initialMainBox!.x + initialMainBox!.width)).toBeCloseTo(40, 0);
  expect(initialSidebarBox!.x + initialSidebarBox!.width).toBeCloseTo(
    initialLayoutBox!.x + initialLayoutBox!.width,
    1,
  );
  expect(initialToggleBox!.x + initialToggleBox!.width).toBeCloseTo(
    initialLayoutBox!.x + initialLayoutBox!.width,
    1,
  );
  expect(initialToggleBox!.y + initialToggleBox!.height).toBeLessThan(initialSidebarScrollBox!.y);
  expect(initialResizerBox!.x + initialResizerBox!.width / 2).toBeCloseTo(initialSidebarBox!.x, 1);

  const dragX = initialResizerBox!.x + initialResizerBox!.width / 2;
  const dragY = initialResizerBox!.y + Math.min(initialResizerBox!.height / 2, 240);
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX - 64, dragY, { steps: 6 });
  await expect(resizer).toHaveAttribute('aria-valuenow', '288');
  expect(
    await layout.evaluate((element) =>
      element.style.getPropertyValue('--article-sidebar-current-width'),
    ),
  ).toBe('288px');
  expect(
    await page
      .locator('html')
      .evaluate((element) => element.style.getPropertyValue('--article-sidebar-boot-width')),
  ).toBe('224px');
  await page.mouse.up();
  await expect(resizer).toHaveAttribute('aria-valuenow', '288');
  expect(
    await page
      .locator('html')
      .evaluate((element) => element.style.getPropertyValue('--article-sidebar-boot-width')),
  ).toBe('288px');

  const resizedMainBox = await main.boundingBox();
  const resizedSidebarBox = await sidebar.boundingBox();
  const resizedToggleBox = await collapseButton.boundingBox();
  expect(resizedMainBox).not.toBeNull();
  expect(resizedSidebarBox).not.toBeNull();
  expect(resizedToggleBox).not.toBeNull();
  expect(resizedMainBox!.x).toBeCloseTo(initialMainBox!.x, 1);
  expect(resizedMainBox!.width).toBeCloseTo(initialMainBox!.width - 64, 1);
  expect(resizedSidebarBox!.width).toBeCloseTo(288, 0);
  expect(resizedSidebarBox!.x + resizedSidebarBox!.width).toBeCloseTo(
    initialSidebarBox!.x + initialSidebarBox!.width,
    1,
  );
  expect(resizedToggleBox!.x).toBeCloseTo(initialToggleBox!.x, 1);
  expect(resizedToggleBox!.y).toBeCloseTo(initialToggleBox!.y, 1);

  await resizer.focus();
  await resizer.press('ArrowRight');
  await expect(resizer).toHaveAttribute('aria-valuenow', '272');

  await collapseButton.click();
  await expect(layout).toHaveAttribute('data-sidebar-collapsed', '');
  await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
  await expect(sidebar).toHaveAttribute('inert', '');
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThanOrEqual(0.5);

  const expandButton = page.getByRole('button', { name: 'Expand article sidebar' });
  const collapsedToggleBox = await expandButton.boundingBox();
  expect(collapsedToggleBox).not.toBeNull();
  expect(collapsedToggleBox!.x).toBeCloseTo(initialToggleBox!.x, 1);
  expect(collapsedToggleBox!.y).toBeCloseTo(initialToggleBox!.y, 1);
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('article-sidebar-layout') ?? 'null')),
    )
    .toEqual({ collapsed: true, width: 272 });

  await expandButton.click();
  await expect(sidebar).not.toHaveAttribute('aria-hidden');
  await expect(sidebar).not.toHaveAttribute('inert');
  await expect(resizer).toHaveAttribute('aria-valuenow', '272');
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeCloseTo(272, 0);
  const restoredToggleBox = await collapseButton.boundingBox();
  expect(restoredToggleBox).not.toBeNull();
  expect(restoredToggleBox!.x).toBeCloseTo(initialToggleBox!.x, 1);
  expect(restoredToggleBox!.y).toBeCloseTo(initialToggleBox!.y, 1);

  await page.evaluate(() => window.swup?.navigate('/en/blog/closed-loop-control-timing/'));
  await expect(page).toHaveURL(/\/en\/blog\/closed-loop-control-timing\/$/);
  await expect(sidebar.getByRole('heading', { level: 2, name: 'On this page' })).toBeVisible();
  await expect(resizer).toHaveAttribute('aria-valuenow', '272');
  await expect(collapseButton).toBeVisible();
});

test('the collapsed article sidebar and its saved width are correct from the first frame', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/ArticleSidebarLayout*.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem('wallpaper-enabled', 'false');
    localStorage.setItem('article-sidebar-layout', JSON.stringify({ collapsed: true, width: 288 }));
    const state = {
      done: false,
      frames: [] as Array<{
        sidebarWidth: number;
        mainX: number;
        mainWidth: number;
        toggleX: number;
        layoutRight: number;
        controllerApplied: boolean;
      }>,
    };
    Object.defineProperty(window, '__articleSidebarFrameState', {
      configurable: true,
      value: state,
    });

    let frame = 0;
    const sample = () => {
      const layout = document.querySelector('[data-article-sidebar-layout]');
      const main = document.querySelector('[data-article-main]');
      const sidebar = document.querySelector('#article-sidebar');
      const toggle = document.querySelector('[data-article-sidebar-controls] button');
      if (layout && main && sidebar && toggle) {
        const layoutBox = layout.getBoundingClientRect();
        const mainBox = main.getBoundingClientRect();
        const sidebarBox = sidebar.getBoundingClientRect();
        const toggleBox = toggle.getBoundingClientRect();
        const round = (value: number) => Math.round(value * 100) / 100;
        state.frames.push({
          sidebarWidth: round(sidebarBox.width),
          mainX: round(mainBox.x),
          mainWidth: round(mainBox.width),
          toggleX: round(toggleBox.x),
          layoutRight: round(layoutBox.right),
          controllerApplied: toggle.hasAttribute('data-article-sidebar-expand'),
        });
      }

      frame += 1;
      if (frame < 90) requestAnimationFrame(sample);
      else state.done = true;
    };
    requestAnimationFrame(sample);
  });

  await page.goto('/en/blog/my-personal-website/');
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __articleSidebarFrameState: { done: boolean };
            }
          ).__articleSidebarFrameState.done,
      ),
    )
    .toBe(true);

  const frames = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __articleSidebarFrameState: {
            frames: Array<{
              sidebarWidth: number;
              mainX: number;
              mainWidth: number;
              toggleX: number;
              layoutRight: number;
              controllerApplied: boolean;
            }>;
          };
        }
      ).__articleSidebarFrameState.frames,
  );
  expect(frames.length).toBeGreaterThan(0);
  expect(new Set(frames.map(({ sidebarWidth }) => sidebarWidth))).toEqual(new Set([0]));
  expect(new Set(frames.map(({ mainX }) => mainX)).size).toBe(1);
  expect(new Set(frames.map(({ mainWidth }) => mainWidth)).size).toBe(1);
  expect(new Set(frames.map(({ toggleX }) => toggleX)).size).toBe(1);
  expect(new Set(frames.map(({ layoutRight }) => layoutRight)).size).toBe(1);
  expect(frames.some(({ controllerApplied }) => !controllerApplied)).toBe(true);
  expect(frames.some(({ controllerApplied }) => controllerApplied)).toBe(true);

  const expandButton = page.getByRole('button', { name: 'Expand article sidebar' });
  const toggleBox = await expandButton.boundingBox();
  expect(toggleBox).not.toBeNull();
  expect(toggleBox!.x + toggleBox!.width).toBeCloseTo(frames[0]!.layoutRight, 1);
  await expandButton.click();
  await expect(page.getByRole('separator', { name: 'Resize article sidebar' })).toHaveAttribute(
    'aria-valuenow',
    '288',
  );
});

test('the article body and article sidebar keep independent scroll positions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('wallpaper-enabled', 'false'));
  await page.goto('/en/blog/persistent-navigation-shell-and-client-lifecycle-for-my-website/');

  const main = page.locator('[data-article-main]');
  const shell = page.locator('[data-article-sidebar-shell]');
  const sidebarScroll = page.locator('[data-article-sidebar-scroll]');
  expect(
    await sidebarScroll.evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true);

  const initialShellBox = await shell.boundingBox();
  const mainBox = await main.boundingBox();
  expect(initialShellBox).not.toBeNull();
  expect(mainBox).not.toBeNull();
  await page.mouse.move(mainBox!.x + Math.min(mainBox!.width / 2, 320), 500);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(sidebarScroll).toHaveJSProperty('scrollTop', 0);

  const stickyShellBox = await shell.boundingBox();
  expect(stickyShellBox).not.toBeNull();
  expect(stickyShellBox!.y).toBeCloseTo(initialShellBox!.y, 1);
  const pageScrollBeforeSidebar = await page.evaluate(() => window.scrollY);
  const sidebarScrollBox = await sidebarScroll.boundingBox();
  expect(sidebarScrollBox).not.toBeNull();
  expect(sidebarScrollBox!.height).toBeLessThanOrEqual(900 * 0.75 + 1);
  expect(sidebarScrollBox!.y + sidebarScrollBox!.height).toBeLessThanOrEqual(900 - 32 + 1);
  await page.mouse.move(
    sidebarScrollBox!.x + sidebarScrollBox!.width / 2,
    sidebarScrollBox!.y + sidebarScrollBox!.height / 2,
  );
  await page.mouse.wheel(0, 320);
  await expect
    .poll(() => sidebarScroll.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBeforeSidebar);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(() => page.evaluate(() => window.scrollY + window.innerHeight))
    .toBe(await page.evaluate(() => document.documentElement.scrollHeight));
  const footerBox = await page.locator('#swup > footer').boundingBox();
  const finalShellBox = await shell.boundingBox();
  expect(footerBox).not.toBeNull();
  expect(finalShellBox).not.toBeNull();
  expect(finalShellBox!.y).toBeCloseTo(initialShellBox!.y, 1);
  expect(finalShellBox!.y + finalShellBox!.height).toBeLessThanOrEqual(footerBox!.y + 1);
});

test('the article sidebar follows the non-sticky header contract in a short desktop viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 500 });
  await page.addInitScript(() => localStorage.setItem('wallpaper-enabled', 'false'));
  await page.goto('/en/blog/persistent-navigation-shell-and-client-lifecycle-for-my-website/');

  const header = page.locator('[data-site-header]');
  const shell = page.locator('[data-article-sidebar-shell]');
  await expect(header).toHaveCSS('position', 'relative');
  await expect(shell).toHaveCSS('top', '83px');

  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect.poll(async () => (await shell.boundingBox())?.y ?? Number.NaN).toBeCloseTo(83, 1);
});

test('the article sidebar keeps its page-owned position when a TOC anchor is clicked and refreshed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('wallpaper-enabled', 'false'));
  await page.goto('/en/blog/persistent-navigation-shell-and-client-lifecycle-for-my-website/');
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');

  const restorationKey = 'article-sidebar';
  const sidebarScroll = page.locator(`[data-scroll-restoration-key="${restorationKey}"]`);
  const deepTocLink = sidebarScroll.locator('[data-article-toc] a[href^="#"]').last();
  await deepTocLink.scrollIntoViewIfNeeded();
  const savedTop = await sidebarScroll.evaluate((element) => element.scrollTop);
  expect(savedTop).toBeGreaterThan(0);
  await expect.poll(() => readSavedNestedScrollTop(page, restorationKey)).toBe(savedTop);

  const targetHash = await deepTocLink.getAttribute('href');
  expect(targetHash).toMatch(/^#./);
  await deepTocLink.click();
  await expect.poll(() => new URL(page.url()).hash).toBe(targetHash);
  await expect(sidebarScroll).toHaveJSProperty('scrollTop', savedTop);
  await expect.poll(() => readSavedNestedScrollTop(page, restorationKey)).toBe(savedTop);

  await installNestedScrollFrameProbe(page, restorationKey);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const frames = await readNestedScrollFrameProbe(page);
  expect(frames.length).toBeGreaterThan(0);
  expect(new Set(frames)).toEqual(new Set([savedTop]));
  await expect(sidebarScroll).toHaveJSProperty('scrollTop', savedTop);
  await expect(deepTocLink).toHaveAttribute('aria-current', 'location');

  await page.evaluate(() => window.swup?.navigate('/en/blog/closed-loop-control-timing/'));
  await expect(page).toHaveURL(/\/en\/blog\/closed-loop-control-timing\/$/);
  await expect(sidebarScroll).toHaveJSProperty('scrollTop', 0);

  await page.goBack();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe('/en/blog/persistent-navigation-shell-and-client-lifecycle-for-my-website/');
  await expect.poll(() => new URL(page.url()).hash).toBe(targetHash);
  await expect(sidebarScroll).toHaveJSProperty('scrollTop', savedTop);
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

      if (sessionStorage.getItem('capture-article-toc-visible-frames') !== 'true') return;
      const frameProbe = { done: false, hrefs: [] as string[] };
      Object.defineProperty(window, '__articleTocVisibleFrameProbe', {
        configurable: true,
        value: frameProbe,
      });

      const sample = () => {
        const bodyVisible =
          document.body && getComputedStyle(document.body).visibility !== 'hidden';
        const active = document.querySelector<HTMLAnchorElement>(
          '[data-article-sidebar-column] [data-article-toc] a.is-active-link',
        );
        if (bodyVisible) frameProbe.hrefs.push(active?.getAttribute('href') ?? '');

        if (frameProbe.hrefs.length < 60) requestAnimationFrame(sample);
        else frameProbe.done = true;
      };
      requestAnimationFrame(sample);
    });
    probe.observe(document, { childList: true, subtree: true });
  });

  await page.goto('/en/blog/closed-loop-control-timing/');
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  const analysisLink = page.locator(
    '[data-article-sidebar-column] [data-article-toc] a[href="#analysis"]',
  );
  await analysisLink.click();
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

  const articleMain = page.locator('[data-article-main]');
  const articleMainBox = await articleMain.boundingBox();
  expect(articleMainBox).not.toBeNull();
  await page.mouse.move(
    articleMainBox!.x + Math.min(articleMainBox!.width / 2, 320),
    Math.min(articleMainBox!.y + 300, 700),
  );
  await page.mouse.wheel(0, 750);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document
          .querySelector('[data-article-sidebar-column] [data-article-toc] a.is-active-link')
          ?.getAttribute('href'),
      ),
    )
    .not.toBe('#analysis');
  await expect.poll(() => new URL(page.url()).hash).toBe('#analysis');
  const savedScrollY = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let previous = scrollY;
        let stableFrames = 0;
        const sample = () => {
          const current = scrollY;
          stableFrames = current === previous ? stableFrames + 1 : 0;
          previous = current;
          if (stableFrames >= 3) resolve(current);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  await expect.poll(() => page.evaluate(() => history.state?.scrollY)).toBe(savedScrollY);

  await page.evaluate(() => {
    sessionStorage.setItem('capture-article-toc-visible-frames', 'true');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __articleTocVisibleFrameProbe?: { done: boolean };
            }
          ).__articleTocVisibleFrameProbe?.done ?? false,
      ),
    )
    .toBe(true);
  const visibleFrameHrefs = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __articleTocVisibleFrameProbe?: { hrefs: string[] };
        }
      ).__articleTocVisibleFrameProbe?.hrefs ?? [],
  );
  const expectedHref = await page.evaluate(() => {
    const headings = [
      ...document.querySelectorAll<HTMLElement>('.js-toc-content :is(h2[id], h3[id])'),
    ];
    const headingOffset = Number.parseFloat(getComputedStyle(headings[0]!).scrollMarginTop) || 0;
    const tolerance = 1 / Math.max(devicePixelRatio, 1);
    let current = headings[0]!;
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top - headingOffset > tolerance) break;
      current = heading;
    }
    return `#${current.id}`;
  });
  expect(visibleFrameHrefs.length).toBe(60);
  expect(new Set(visibleFrameHrefs)).toEqual(new Set([expectedHref]));
  expect(expectedHref).not.toBe('#analysis');
  await expect.poll(() => new URL(page.url()).hash).toBe('#analysis');
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
    sessionStorage.removeItem('capture-article-toc-visible-frames');
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

test('a selected tag is applied before the refreshed blog becomes visible', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/BlogBrowser*.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('wallpaper-enabled', 'false');
  });
  await page.goto('/en/blog/');
  await expect(page.locator('astro-island[component-url*="BlogBrowser"]')).not.toHaveAttribute(
    'ssr',
    '',
  );

  const initialArticleCount = await page.locator('[data-blog-article]').count();
  const candidate = await page
    .locator('[data-tag-filter]')
    .evaluateAll((elements, unfilteredCount) => {
      const index = elements.findIndex((element) => {
        const count = Number(element.getAttribute('data-tag-count'));
        return count > 0 && count < unfilteredCount;
      });
      if (index < 0) return null;
      const element = elements[index]!;
      return {
        index,
        count: Number(element.getAttribute('data-tag-count')),
        name: element.getAttribute('data-tag-filter'),
        slug: element.getAttribute('data-tag-slug'),
      };
    }, initialArticleCount);
  if (!candidate?.name || !candidate.slug) {
    throw new Error('Expected a tag with fewer results than the first page.');
  }

  await page.locator('[data-tag-filter]').nth(candidate.index).click();
  await expect(page.locator('[data-blog-article]')).toHaveCount(candidate.count);
  expect(new URL(page.url()).searchParams.getAll('tag')).toContain(candidate.slug);

  await page.addInitScript(
    ({ tagName, tagSlug }) => {
      const probe = {
        done: false,
        frames: [] as Array<{
          visible: boolean;
          articleCount: number;
          tagPressed: boolean;
          tagStyle: string;
          tagAnimations: number;
          articleTagPressed: boolean;
          articleTagStyle: string;
          articleTagAnimations: number;
          hydrated: boolean;
          pending: boolean;
          outerPageVisible: boolean;
          browserVisible: boolean;
        }>,
      };
      Object.defineProperty(window, '__blogFilterRefreshFrameState', {
        configurable: true,
        value: probe,
      });

      let frame = 0;
      const sample = () => {
        const island = document.querySelector<HTMLElement>(
          'astro-island[component-url*="BlogBrowser"]',
        );
        const browser = document.querySelector<HTMLElement>('[data-blog-browser]');
        const listing = document.querySelector<HTMLElement>('[data-blog-listing]');
        const header = document.querySelector<HTMLElement>('[data-site-header]');
        const footer = document.querySelector<HTMLElement>('#swup > footer');
        const tag = document.querySelector<HTMLElement>(`[data-tag-slug="${CSS.escape(tagSlug)}"]`);
        const articleTag = document.querySelector<HTMLElement>(
          `[data-article-tag="${CSS.escape(tagName)}"]`,
        );
        const articles = document.querySelectorAll('[data-blog-article]');
        if (
          island &&
          browser &&
          listing &&
          header &&
          footer &&
          tag &&
          articleTag &&
          articles.length > 0
        ) {
          const tagStyle = getComputedStyle(tag);
          const articleTagStyle = getComputedStyle(articleTag);
          const outerPageVisible =
            getComputedStyle(document.body).visibility !== 'hidden' &&
            getComputedStyle(header).visibility !== 'hidden' &&
            getComputedStyle(footer).visibility !== 'hidden';
          const browserVisible = getComputedStyle(browser).visibility !== 'hidden';
          probe.frames.push({
            visible: outerPageVisible && browserVisible && tagStyle.visibility !== 'hidden',
            articleCount: articles.length,
            tagPressed: tag.getAttribute('aria-pressed') === 'true',
            tagStyle: [
              tagStyle.backgroundColor,
              tagStyle.borderLeftColor,
              tagStyle.color,
              tagStyle.fontWeight,
            ].join('|'),
            tagAnimations: tag.getAnimations().length,
            articleTagPressed: articleTag.getAttribute('aria-pressed') === 'true',
            articleTagStyle: [
              articleTagStyle.backgroundColor,
              articleTagStyle.borderColor,
              articleTagStyle.color,
            ].join('|'),
            articleTagAnimations: articleTag.getAnimations().length,
            hydrated: !island.hasAttribute('ssr'),
            pending: listing.hasAttribute('data-blog-browser-pending'),
            outerPageVisible,
            browserVisible,
          });
        }

        frame += 1;
        if (frame < 90) requestAnimationFrame(sample);
        else probe.done = true;
      };
      requestAnimationFrame(sample);
    },
    { tagName: candidate.name, tagSlug: candidate.slug },
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __blogFilterRefreshFrameState: { done: boolean };
            }
          ).__blogFilterRefreshFrameState.done,
      ),
    )
    .toBe(true);

  const frames = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __blogFilterRefreshFrameState: {
            frames: Array<{
              visible: boolean;
              articleCount: number;
              tagPressed: boolean;
              tagStyle: string;
              tagAnimations: number;
              articleTagPressed: boolean;
              articleTagStyle: string;
              articleTagAnimations: number;
              hydrated: boolean;
              pending: boolean;
              outerPageVisible: boolean;
              browserVisible: boolean;
            }>;
          };
        }
      ).__blogFilterRefreshFrameState.frames,
  );
  expect(frames.length).toBeGreaterThan(0);

  const staleFrames = frames.filter(
    ({ articleCount, tagPressed }) => articleCount !== candidate.count || !tagPressed,
  );
  // Hydration can finish before the first observable animation frame. If a stale
  // frame is observed, the prepaint guard must keep both the listing and shell hidden.
  expect(staleFrames.every(({ visible }) => !visible)).toBe(true);
  expect(staleFrames.every(({ outerPageVisible }) => !outerPageVisible)).toBe(true);

  const visibleFrames = frames.filter(({ visible }) => visible);
  expect(visibleFrames.length).toBeGreaterThan(0);
  expect(
    visibleFrames.every(
      ({ articleCount, tagPressed, articleTagPressed, pending }) =>
        articleCount === candidate.count && tagPressed && articleTagPressed && !pending,
    ),
  ).toBe(true);
  expect(new Set(visibleFrames.map(({ tagStyle }) => tagStyle)).size).toBe(1);
  expect(new Set(visibleFrames.map(({ articleTagStyle }) => articleTagStyle)).size).toBe(1);
  expect(visibleFrames.every(({ tagAnimations }) => tagAnimations === 0)).toBe(true);
  expect(visibleFrames.every(({ articleTagAnimations }) => articleTagAnimations === 0)).toBe(true);
  expect(visibleFrames.some(({ hydrated }) => hydrated)).toBe(true);
});

test('a failed blog island reveals its complete static fallback', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let failedRequests = 0;
  let releaseRequest = () => {};
  const heldRequest = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(/\/BlogBrowser[^/]*\.js(?:\?.*)?$/, async (route) => {
    failedRequests += 1;
    await heldRequest;
    await route.abort('failed');
  });

  try {
    await page.goto('/en/blog/?tag=astro', { waitUntil: 'domcontentloaded' });

    const listing = page.locator('[data-blog-listing]');
    const browser = page.locator('[data-blog-browser]');
    await expect(listing).toHaveAttribute('data-blog-browser-pending', '');
    await expect(browser).toBeHidden();
    await expect(page.locator('[data-site-header]')).toBeHidden();

    releaseRequest();
    await expect(listing).not.toHaveAttribute('data-blog-browser-pending', '', { timeout: 3_000 });
    await expect(browser).toBeVisible();
    await expect(page.locator('[data-site-header]')).toBeVisible();
    await expect(page.locator('#swup > footer')).toBeVisible();
    await expect(page.locator('astro-island[component-url*="BlogBrowser"]')).toHaveAttribute(
      'ssr',
      '',
    );
    expect(failedRequests).toBeGreaterThanOrEqual(2);
  } finally {
    releaseRequest();
    await page.unrouteAll({ behavior: 'wait' });
  }
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

test('document and sidebar scrolling remain independent on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/blog/');

  const shell = page.locator('[data-blog-sidebar-shell]');
  const viewport = page.locator('[data-blog-sidebar-viewport]');
  const panel = page.locator('[data-tag-filter-panel]');
  const results = page.locator('[data-blog-results]');

  await expect(shell).toHaveCSS('position', 'sticky');
  await expect(viewport).toHaveCSS('overflow', 'clip');

  const initialGeometry = await page.evaluate(() => {
    const shell = document.querySelector('[data-blog-sidebar-shell]');
    const panel = document.querySelector('[data-tag-filter-panel]');
    const results = document.querySelector('[data-blog-results]');
    if (!(shell instanceof HTMLElement) || !(panel instanceof HTMLElement) || !results) {
      throw new Error('Expected the desktop blog layout');
    }
    return {
      shellTop: shell.getBoundingClientRect().top,
      panelScrollTop: panel.scrollTop,
      resultsTop: results.getBoundingClientRect().top,
    };
  });

  const documentScrollTop = await page.evaluate(() => {
    const maximum = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, Math.min(360, maximum));
    return window.scrollY;
  });
  expect(documentScrollTop).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(documentScrollTop);

  const afterDocumentScroll = await page.evaluate(() => {
    const shell = document.querySelector('[data-blog-sidebar-shell]');
    const panel = document.querySelector('[data-tag-filter-panel]');
    const results = document.querySelector('[data-blog-results]');
    if (!(shell instanceof HTMLElement) || !(panel instanceof HTMLElement) || !results) {
      throw new Error('Expected the desktop blog layout');
    }
    return {
      shellTop: shell.getBoundingClientRect().top,
      panelScrollTop: panel.scrollTop,
      resultsTop: results.getBoundingClientRect().top,
    };
  });
  expect(afterDocumentScroll.shellTop).toBeCloseTo(initialGeometry.shellTop, 1);
  expect(afterDocumentScroll.panelScrollTop).toBe(initialGeometry.panelScrollTop);
  expect(afterDocumentScroll.resultsTop).toBeLessThan(initialGeometry.resultsTop);

  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  const windowScrollBeforePanel = await page.evaluate(() => window.scrollY);
  await page.mouse.move(panelBox!.x + panelBox!.width / 2, panelBox!.y + panelBox!.height / 2);
  await page.mouse.wheel(0, 320);
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(windowScrollBeforePanel);

  const resultsBox = await results.boundingBox();
  expect(resultsBox).not.toBeNull();
  const panelScrollBeforeResults = await panel.evaluate((element) => element.scrollTop);
  const windowScrollBeforeResults = await page.evaluate(() => window.scrollY);
  await page.mouse.move(resultsBox!.x + Math.min(resultsBox!.width / 2, 200), 450);
  await page.mouse.wheel(0, 320);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(windowScrollBeforeResults);
  expect(await panel.evaluate((element) => element.scrollTop)).toBe(panelScrollBeforeResults);
  expect(
    await shell.evaluate((element) => Math.round(element.getBoundingClientRect().top * 100) / 100),
  ).toBeCloseTo(Math.round(initialGeometry.shellTop * 100) / 100, 1);
});

test('the tall desktop sidebar ends with the article list and stays clear of the footer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1253 });
  await page.goto('/zh/blog/');

  const initialShellTop = await page
    .locator('[data-blog-sidebar-shell]')
    .evaluate((element) => element.getBoundingClientRect().top);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing layout element: ${selector}`);
      return element.getBoundingClientRect();
    };
    const shell = rect('[data-blog-sidebar-shell]');
    const articleList = rect('[data-blog-results] > ol');
    const pagination = rect('[data-blog-results] > nav');
    const footer = rect('#swup > footer');

    return {
      shellTop: shell.top,
      shellBottom: shell.bottom,
      articleListBottom: articleList.bottom,
      paginationTop: pagination.top,
      footerTop: footer.top,
    };
  });

  expect(geometry.shellTop).toBeCloseTo(initialShellTop, 1);
  expect(Math.abs(geometry.shellBottom - geometry.articleListBottom)).toBeLessThanOrEqual(24);
  expect(geometry.shellBottom).toBeLessThan(geometry.paginationTop);
  expect(geometry.shellBottom).toBeLessThan(geometry.footerTop);
});

test('the blog sidebar owns its controls and preserves the content gutter while resizing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/blog/');

  const layout = page.locator('[data-blog-sidebar-layout]');
  const shell = page.locator('[data-blog-sidebar-shell]');
  const viewport = page.locator('[data-blog-sidebar-viewport]');
  const sidebar = page.locator('#blog-sidebar');
  const tagSection = sidebar.locator('[data-blog-sidebar-section="article-tags"]');
  const tagPanel = sidebar.locator('[data-tag-filter-panel]');
  const results = page.locator('[data-blog-results]');
  const resizer = page.getByRole('separator', { name: 'Resize blog sidebar' });
  const boundary = resizer.locator('[data-blog-sidebar-boundary]');
  const collapseButton = page.getByRole('button', { name: 'Collapse blog sidebar' });
  const sidebarTitle = sidebar.getByRole('heading', { level: 2, name: 'Article tags' });

  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveAccessibleName('Article tags');
  await expect(sidebarTitle).toBeVisible();
  await expect(tagSection).toBeVisible();
  await expect(tagSection.locator('h3')).toHaveCount(0);
  await expect(tagSection.locator('[data-blog-sidebar-collapse]')).toHaveCount(0);
  await expect(collapseButton).toBeVisible();
  await expect(boundary).toBeVisible();
  expect(await boundary.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
  await expect(resizer).toHaveAttribute('aria-orientation', 'vertical');
  await expect(resizer).toHaveAttribute('aria-valuemin', '208');
  await expect(resizer).toHaveAttribute('aria-valuemax', '400');
  await expect(resizer).toHaveAttribute('aria-valuenow', '272');

  const initialSidebarBox = await sidebar.boundingBox();
  const initialTagPanelBox = await tagPanel.boundingBox();
  const initialResultsBox = await results.boundingBox();
  const resizerBox = await resizer.boundingBox();
  const initialToggleBox = await collapseButton.boundingBox();
  const sidebarTitleBox = await sidebarTitle.boundingBox();
  const initialLayoutBox = await layout.boundingBox();
  const initialShellBox = await shell.boundingBox();
  expect(initialSidebarBox).not.toBeNull();
  expect(initialTagPanelBox).not.toBeNull();
  expect(initialResultsBox).not.toBeNull();
  expect(resizerBox).not.toBeNull();
  expect(initialToggleBox).not.toBeNull();
  expect(sidebarTitleBox).not.toBeNull();
  expect(initialLayoutBox).not.toBeNull();
  expect(initialShellBox).not.toBeNull();
  expect(initialSidebarBox!.width).toBeCloseTo(272, 0);
  expect(sidebarTitleBox!.x).toBeGreaterThan(initialToggleBox!.x + initialToggleBox!.width);
  expect(sidebarTitleBox!.y + sidebarTitleBox!.height / 2).toBeCloseTo(
    initialToggleBox!.y + initialToggleBox!.height / 2,
    1,
  );
  expect(
    initialSidebarBox!.x +
      initialSidebarBox!.width -
      (initialTagPanelBox!.x + initialTagPanelBox!.width),
  ).toBeCloseTo(16, 0);
  expect(resizerBox!.height).toBeCloseTo(initialShellBox!.height, 0);
  expect(initialResultsBox!.x - (initialSidebarBox!.x + initialSidebarBox!.width)).toBeCloseTo(
    40,
    0,
  );

  const dragStartX = resizerBox!.x + resizerBox!.width / 2;
  const dragStartY = resizerBox!.y + Math.min(resizerBox!.height / 2, 240);
  await page.mouse.move(dragStartX, dragStartY);
  await page.mouse.down();
  await page.mouse.move(dragStartX + 72, dragStartY, { steps: 6 });
  await page.mouse.up();
  await expect(resizer).toHaveAttribute('aria-valuenow', '344');

  const resizedSidebarBox = await sidebar.boundingBox();
  const resizedResultsBox = await results.boundingBox();
  expect(resizedSidebarBox).not.toBeNull();
  expect(resizedResultsBox).not.toBeNull();
  expect(resizedSidebarBox!.width).toBeCloseTo(344, 0);
  expect(resizedResultsBox!.x - (resizedSidebarBox!.x + resizedSidebarBox!.width)).toBeCloseTo(
    40,
    0,
  );
  expect(resizedResultsBox!.width).toBeLessThan(initialResultsBox!.width);

  await resizer.focus();
  await resizer.press('ArrowLeft');
  await expect(resizer).toHaveAttribute('aria-valuenow', '328');

  await collapseButton.click();
  await expect(layout).toHaveAttribute('data-sidebar-collapsed', '');
  await expect(sidebar).toHaveAttribute('aria-hidden', 'true');
  await expect(sidebar).toHaveAttribute('inert', '');
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThanOrEqual(0.5);

  const expandButton = page.getByRole('button', { name: 'Expand blog sidebar' });
  await expect(expandButton).toBeVisible();
  const collapsedToggleBox = await expandButton.boundingBox();
  expect(collapsedToggleBox).not.toBeNull();
  expect(collapsedToggleBox!.x).toBeCloseTo(initialToggleBox!.x, 1);
  expect(collapsedToggleBox!.y).toBeCloseTo(initialToggleBox!.y, 1);
  await expect(viewport).toHaveCSS('overflow', 'clip');
  expect(
    await tagSection.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const hitTarget = document.elementFromPoint(
        bounds.left + Math.min(bounds.width / 2, 80),
        bounds.top + 20,
      );
      return hitTarget !== null && element.contains(hitTarget);
    }),
  ).toBe(false);
  const collapsedLayoutBox = await layout.boundingBox();
  const expandedResultsBox = await results.boundingBox();
  expect(collapsedLayoutBox).not.toBeNull();
  expect(expandedResultsBox).not.toBeNull();
  expect(expandedResultsBox!.x - collapsedLayoutBox!.x).toBeCloseTo(40, 0);

  const expansionFrames = await page.evaluate(async () => {
    const sidebar = document.querySelector('#blog-sidebar');
    const expand = document.querySelector<HTMLButtonElement>('[data-blog-sidebar-expand]');
    if (!sidebar || !expand) throw new Error('Expected the collapsed blog sidebar');

    const frames: Array<{ sidebarWidth: number; boundaryVisible: boolean }> = [];
    expand.click();

    await new Promise<void>((resolve) => {
      let frame = 0;
      const sample = () => {
        frames.push({
          sidebarWidth: sidebar.getBoundingClientRect().width,
          boundaryVisible:
            (document.querySelector('[data-blog-sidebar-boundary]')?.getClientRects().length ?? 0) >
            0,
        });
        frame += 1;
        if (frame < 20) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });

    return frames;
  });
  expect(
    expansionFrames.every(
      ({ sidebarWidth, boundaryVisible }) => sidebarWidth >= 327.5 || !boundaryVisible,
    ),
  ).toBe(true);
  expect(expansionFrames.at(-1)?.boundaryVisible).toBe(true);
  await expect(layout).not.toHaveAttribute('data-sidebar-collapsed', '');
  await expect(resizer).toHaveAttribute('aria-valuenow', '328');
  await expect(collapseButton).toBeFocused();
  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeCloseTo(328, 0);
  const restoredToggleBox = await collapseButton.boundingBox();
  expect(restoredToggleBox).not.toBeNull();
  expect(restoredToggleBox!.x).toBeCloseTo(initialToggleBox!.x, 1);
  expect(restoredToggleBox!.y).toBeCloseTo(initialToggleBox!.y, 1);
});

test('blog sidebar width and collapsed state persist without a first-frame layout change', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/blog/');
  await expect(page.locator('astro-island[component-url*="BlogBrowser"]')).not.toHaveAttribute(
    'ssr',
    '',
  );

  const resizer = page.getByRole('separator', { name: 'Resize blog sidebar' });
  const resizerBox = await resizer.boundingBox();
  expect(resizerBox).not.toBeNull();
  const dragX = resizerBox!.x + resizerBox!.width / 2;
  const dragY = resizerBox!.y + Math.min(resizerBox!.height / 2, 240);
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX + 48, dragY, { steps: 4 });
  await page.mouse.up();
  await expect(resizer).toHaveAttribute('aria-valuenow', '320');
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('blog-sidebar-layout') ?? 'null')),
    )
    .toEqual({ collapsed: false, width: 320 });

  await page.addInitScript(() => {
    const state = {
      done: false,
      frames: [] as Array<{
        sidebarWidth: number;
        contentWidth: number;
        resultsOffset: number;
        boundaryVisible: boolean;
        collapseIconVisible: boolean;
        expandIconVisible: boolean;
      }>,
    };
    Object.defineProperty(window, '__blogSidebarPreferenceFrameState', {
      configurable: true,
      value: state,
    });

    let frame = 0;
    const sample = () => {
      const layout = document.querySelector('[data-blog-sidebar-layout]');
      const sidebar = document.querySelector('#blog-sidebar');
      const content = sidebar?.firstElementChild;
      const results = document.querySelector('[data-blog-results]');
      const boundary = document.querySelector('[data-blog-sidebar-boundary]');
      const collapseIcon = document.querySelector('[data-blog-sidebar-collapse-icon]');
      const expandIcon = document.querySelector('[data-blog-sidebar-expand-icon]');
      if (layout && sidebar && content && results && collapseIcon && expandIcon) {
        const layoutBox = layout.getBoundingClientRect();
        const sidebarBox = sidebar.getBoundingClientRect();
        const contentBox = content.getBoundingClientRect();
        const resultsBox = results.getBoundingClientRect();
        const round = (value: number) => Math.round(value * 100) / 100;
        state.frames.push({
          sidebarWidth: round(sidebarBox.width),
          contentWidth: round(contentBox.width),
          resultsOffset: round(resultsBox.x - layoutBox.x),
          boundaryVisible: boundary !== null && boundary.getClientRects().length !== 0,
          collapseIconVisible: getComputedStyle(collapseIcon).display !== 'none',
          expandIconVisible: getComputedStyle(expandIcon).display !== 'none',
        });
      }

      frame += 1;
      if (frame < 60) requestAnimationFrame(sample);
      else state.done = true;
    };
    requestAnimationFrame(sample);
  });

  const readFrames = async () => {
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __blogSidebarPreferenceFrameState: { done: boolean };
              }
            ).__blogSidebarPreferenceFrameState.done,
        ),
      )
      .toBe(true);
    return page.evaluate(
      () =>
        (
          window as typeof window & {
            __blogSidebarPreferenceFrameState: {
              frames: Array<{
                sidebarWidth: number;
                contentWidth: number;
                resultsOffset: number;
                boundaryVisible: boolean;
                collapseIconVisible: boolean;
                expandIconVisible: boolean;
              }>;
            };
          }
        ).__blogSidebarPreferenceFrameState.frames,
    );
  };

  await page.reload();
  const expandedFrames = await readFrames();
  expect(expandedFrames.length).toBeGreaterThan(0);
  expect(new Set(expandedFrames.map(({ sidebarWidth }) => sidebarWidth))).toEqual(new Set([320]));
  expect(new Set(expandedFrames.map(({ contentWidth }) => contentWidth))).toEqual(new Set([320]));
  expect(new Set(expandedFrames.map(({ resultsOffset }) => resultsOffset))).toEqual(new Set([360]));
  expect(expandedFrames.every(({ boundaryVisible }) => boundaryVisible)).toBe(true);
  expect(expandedFrames.every(({ collapseIconVisible }) => collapseIconVisible)).toBe(true);
  expect(expandedFrames.some(({ expandIconVisible }) => expandIconVisible)).toBe(false);

  await page.getByRole('button', { name: 'Collapse blog sidebar' }).click();
  await expect(page.locator('[data-blog-sidebar-layout]')).toHaveAttribute(
    'data-sidebar-collapsed',
    '',
  );
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('blog-sidebar-layout') ?? 'null')),
    )
    .toEqual({ collapsed: true, width: 320 });

  await page.reload();
  const collapsedFrames = await readFrames();
  expect(collapsedFrames.length).toBeGreaterThan(0);
  expect(new Set(collapsedFrames.map(({ sidebarWidth }) => sidebarWidth))).toEqual(new Set([0]));
  expect(new Set(collapsedFrames.map(({ contentWidth }) => contentWidth))).toEqual(new Set([320]));
  expect(new Set(collapsedFrames.map(({ resultsOffset }) => resultsOffset))).toEqual(new Set([40]));
  expect(collapsedFrames.some(({ boundaryVisible }) => boundaryVisible)).toBe(false);
  expect(collapsedFrames.some(({ collapseIconVisible }) => collapseIconVisible)).toBe(false);
  expect(collapsedFrames.every(({ expandIconVisible }) => expandIconVisible)).toBe(true);

  await page.getByRole('button', { name: 'Expand blog sidebar' }).click();
  await expect
    .poll(async () => (await page.locator('#blog-sidebar').boundingBox())?.width)
    .toBe(320);
});

test('the blog sidebar becomes a mobile tag disclosure without desktop controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.goto('/en/blog/');

  const sidebar = page.getByRole('complementary', { name: 'Article tags' });
  const results = page.locator('[data-blog-results]');
  const tagTrigger = page.getByRole('button', { name: 'Article tags' });
  const filters = page.locator('[data-tag-filter]');

  await expect(sidebar).toBeVisible();
  await expect(page.locator('[data-blog-sidebar-collapse]')).toBeHidden();
  await expect(page.locator('[data-blog-sidebar-resizer]')).toBeHidden();
  await expect(tagTrigger).toBeVisible();
  await expect(filters.first()).toBeVisible();

  await tagTrigger.click();
  await expect(tagTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(filters.first()).toBeHidden();
  await tagTrigger.click();
  await expect(tagTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(filters.first()).toBeVisible();

  const sidebarBox = await sidebar.boundingBox();
  const resultsBox = await results.boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(resultsBox).not.toBeNull();
  expect(resultsBox!.y - (sidebarBox!.y + sidebarBox!.height)).toBeCloseTo(40, 0);
});

test('leaving the desktop breakpoint cannot strand the blog sidebar collapsed', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/zh/blog/');

  const layout = page.locator('[data-blog-sidebar-layout]');
  const sidebar = page.getByRole('complementary', { name: '文章标签' });
  await page.getByRole('button', { name: '收起博客侧栏' }).click();
  await expect(layout).toHaveAttribute('data-sidebar-collapsed', '');

  await page.setViewportSize({ width: 760, height: 900 });
  await expect(layout).not.toHaveAttribute('data-sidebar-collapsed', '');
  await expect(sidebar).not.toHaveAttribute('aria-hidden', 'true');
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole('button', { name: '文章标签' })).toBeVisible();
});

test('version comparison loads on demand and supports both layouts', async ({ page }) => {
  await page.goto('/zh/blog/my-personal-website/');
  const comparisonLink = page.locator('[data-version-compare-link]').first();
  await expect(comparisonLink).toHaveAttribute('href', /\/compare\//);
  const comparisonHref = await comparisonLink.getAttribute('href');
  await page.goto(comparisonHref!);

  await expect(page.locator('[data-version-comparison]')).toBeVisible();
  const desktopSidebar = page.locator('[data-version-comparison] > aside > div');
  await expect(desktopSidebar).toHaveCSS('top', '140px');
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

  await page.setViewportSize({ width: 1024, height: 500 });
  await expect(page.locator('[data-site-header]')).toHaveCSS('position', 'relative');
  await expect(desktopSidebar).toHaveCSS('top', '83px');
  await page.locator('[data-diff-mode="split"]:visible').click();
  await expect(page.locator('[data-diff-panel="split"]')).toBeVisible();
});
