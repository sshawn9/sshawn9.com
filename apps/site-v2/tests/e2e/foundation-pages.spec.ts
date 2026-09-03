import { expect, test } from '@playwright/test';

const articlePath = '/en/blog/git-operations-reference/';

test('the generated site obeys its production or preview publishing mode', async ({
  page,
  request,
}) => {
  const preview = process.env.SITE_MODE === 'preview';
  const draft = await request.get('/zh/blog/simulation-work-with-carla/');
  const sitemap = await request.get('/sitemap-index.xml');

  expect(draft.status()).toBe(preview ? 200 : 404);
  expect(sitemap.status()).toBe(preview ? 404 : 200);

  await page.goto('/zh/');
  const robots = page.locator('meta[name="robots"]');
  if (preview) {
    await expect(robots).toHaveAttribute('content', /\bnoindex\b/);
  } else {
    await expect(robots).toHaveCount(0);
  }
});

test('every document generation references the shared site icon and localized manifest', async ({
  page,
  request,
}) => {
  for (const locale of ['en', 'zh'] as const) {
    await page.goto(`/${locale}/`);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      `/site.${locale}.webmanifest`,
    );
  }

  const fallbackResponse = await page.goto('/missing-page/');
  expect(fallbackResponse?.status()).toBe(404);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');

  for (const asset of ['/favicon.svg', '/site.en.webmanifest', '/site.zh.webmanifest']) {
    const response = await request.get(asset);
    expect(response.ok(), `${asset} must be emitted by the v2 build`).toBe(true);
  }
});

test('homepage project and recent-article titles stay quiet until interaction', async ({
  page,
}) => {
  await page.goto('/en/');
  const projectTitle = page.getByRole('link', { name: '自动驾驶运动控制' });
  const recentArticleTitle = page.getByRole('link', {
    name: 'From Page Transitions to a Persistent Shell: Governing the Client Lifecycle of My Website',
  });
  await expect(projectTitle).toHaveCSS('text-decoration-line', 'none');
  await expect(recentArticleTitle).toHaveCSS('text-decoration-line', 'none');
  await projectTitle.hover();
  await expect(projectTitle).toHaveCSS('text-decoration-line', 'underline');
  await recentArticleTitle.hover();
  await expect(recentArticleTitle).toHaveCSS('text-decoration-line', 'underline');
});

test('the persistent header keeps the same destinations and quiet utility hierarchy', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/blog/');

  const header = page.locator('.site-header');
  const github = header.getByRole('link', { name: "View Shawn's GitHub profile" }).first();
  const locale = header.getByRole('link', { name: 'Switch to 中文' }).first();
  const theme = header.locator('[data-shell-sync-key="theme-toggle"]');
  await expect(github).toBeVisible();
  await expect(locale).toBeVisible();
  await expect(theme).toBeVisible();
  await expect(theme).toHaveAccessibleName('Switch to dark mode');
  await expect(theme).toHaveCSS('border-top-style', 'none');
  expect((await theme.boundingBox())?.width).toBe(40);
  await expect(theme.locator('.site-header__theme-light')).toBeVisible();
  await expect(theme.locator('.site-header__theme-dark')).toBeHidden();

  await theme.click();
  await expect(theme).toHaveAccessibleName('Switch to light mode');
  await expect(theme.locator('.site-header__theme-light')).toBeHidden();
  await expect(theme.locator('.site-header__theme-dark')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const menu = header.locator('[data-mobile-menu-trigger]');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAccessibleName('Open navigation');
  await menu.click();
  await expect(menu).toHaveAccessibleName('Close navigation');
  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNavigation.getByRole('link', { name: 'Projects' })).toBeVisible();
  await expect(
    page
      .locator('[data-shell-mobile-menu]')
      .getByRole('link', { name: "View Shawn's GitHub profile" }),
  ).toBeVisible();
});

test('the root fallback preserves the 404 status and resolves the route locale before paint', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('PARAGLIDE_LOCALE', 'en'));

  const response = await page.goto('/zh/does-not-exist/');

  expect(response?.status()).toBe(404);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page).toHaveTitle('页面未找到 · SHAWN');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('这里是 404 页面');
  await expect(page.getByRole('link', { name: '回到首页' })).toHaveAttribute('href', '/zh/');
  await expect(page.getByRole('link', { name: '搜索内容' })).toHaveAttribute('href', '/zh/search/');
});

test('prepaint theme and article geometry are stable from the first rendered frame', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'dark');
    const state = window as Window & {
      __foundationFrameProbe?: {
        frames: Array<{
          theme?: string;
          fontState?: string;
          fontFamily: string;
          width: number;
          height: number;
        }>;
        complete: boolean;
        attempts: number;
      };
    };
    state.__foundationFrameProbe = { frames: [], complete: false, attempts: 0 };

    const sample = () => {
      const probe = state.__foundationFrameProbe!;
      probe.attempts += 1;
      const heading = document.querySelector<HTMLElement>('.article-header h1');
      if (heading) {
        const box = heading.getBoundingClientRect();
        probe.frames.push({
          theme: document.documentElement.dataset.theme,
          fontState: document.documentElement.dataset.fontState,
          fontFamily: getComputedStyle(heading).fontFamily,
          width: box.width,
          height: box.height,
        });
      }
      if (probe.frames.length >= 8 || probe.attempts >= 120) {
        probe.complete = true;
        return;
      }
      requestAnimationFrame(sample);
    };
    const paintObserver = new PerformanceObserver((entries, observer) => {
      if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      observer.disconnect();
      requestAnimationFrame(sample);
    });
    paintObserver.observe({ type: 'paint', buffered: true });
  });

  await page.goto(articlePath);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(page.locator('#initial-frame-ready')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as Window & { __foundationFrameProbe?: { complete: boolean } })
            .__foundationFrameProbe?.complete,
        ),
      ),
    )
    .toBe(true);

  const frames = await page.evaluate(
    () =>
      (
        window as Window & {
          __foundationFrameProbe?: {
            frames: Array<{
              theme?: string;
              fontState?: string;
              fontFamily: string;
              width: number;
              height: number;
            }>;
          };
        }
      ).__foundationFrameProbe?.frames ?? [],
  );
  expect(frames).toHaveLength(8);
  expect(frames.every((frame) => frame.theme === 'dark')).toBe(true);
  expect(frames.every((frame) => frame.fontState === frames[0]?.fontState)).toBe(true);
  expect(frames.every((frame) => frame.fontFamily.includes('Manrope Variable'))).toBe(true);
  expect(
    Math.max(...frames.map((frame) => frame.width)) -
      Math.min(...frames.map((frame) => frame.width)),
  ).toBeLessThan(0.25);
  expect(
    Math.max(...frames.map((frame) => frame.height)) -
      Math.min(...frames.map((frame) => frame.height)),
  ).toBeLessThan(0.25);
});

test('a deep hard refresh restores the matching history entry before the first frame', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('capture-v2-reload-frame') !== 'true') return;
    const paintObserver = new PerformanceObserver((entries, observer) => {
      if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      observer.disconnect();
      sessionStorage.setItem('v2-reload-first-frame-y', String(scrollY));
    });
    paintObserver.observe({ type: 'paint', buffered: true });
  });
  await page.goto(articlePath);
  await page.evaluate(() => scrollTo(0, 3_200));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(3_200, 0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (history.state as { sshawn9?: { page?: { y?: number } } } | null)?.sshawn9?.page?.y ?? 0,
      ),
    )
    .toBeCloseTo(3_200, 0);
  const savedY = await page.evaluate(
    () => (history.state as { sshawn9: { page: { y: number } } }).sshawn9.page.y,
  );
  await page.evaluate(() => sessionStorage.setItem('capture-v2-reload-frame', 'true'));

  await page.reload();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('v2-reload-first-frame-y')))
    .not.toBeNull();
  const firstFrameY = Number(
    await page.evaluate(() => sessionStorage.getItem('v2-reload-first-frame-y')),
  );

  expect(Math.abs(firstFrameY - savedY)).toBeLessThan(2);
  await expect(page.locator('#initial-frame-ready')).toHaveCount(1);
});
