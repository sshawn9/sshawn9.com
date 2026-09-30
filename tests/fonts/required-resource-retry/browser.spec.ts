import { expect, test, type Page } from '@playwright/test';
import { installFontFrameProbe, readFontFrames } from '../font-probe';

const paths = [
  '/en/',
  '/zh/blog/',
  '/en/blog/git-operations-reference/',
  '/zh/blog/planar-frenet-frame/',
  '/missing-font-retry/',
];

async function expectCorrectFirstFrames(page: Page): Promise<void> {
  await expect
    .poll(async () => (await readFontFrames(page)).filter((frame) => frame.surfacePresent).length)
    .toBeGreaterThanOrEqual(8);
  for (const frame of await readFontFrames(page)) {
    if (!frame.surfacePresent) continue;
    expect(frame.visible, JSON.stringify(frame)).toBe(true);
    expect(frame.state, JSON.stringify(frame)).toBe('ready');
    expect(frame.sampleFontReady, JSON.stringify(frame)).toBe(true);
  }
}

for (const fault of ['abort', '503', 'invalid-font'] as const) {
  test(`required font ${fault} keeps initial content uncommitted until the original resource recovers`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await installFontFrameProbe(page);
    let fail = true;
    let retries = 0;
    await page.route(/\.(?:woff2?|ttf)(?:\?|$)/, (route) => {
      retries = Math.max(
        retries,
        Number(new URL(route.request().url()).searchParams.get('font-retry')),
      );
      if (!fail) return route.continue();
      if (fault === 'abort') return route.abort('failed');
      return route.fulfill({
        status: fault === '503' ? 503 : 200,
        contentType: 'font/woff2',
        body: fault === '503' ? '' : 'invalid font bytes',
      });
    });
    for (const path of paths) {
      fail = true;
      retries = 0;
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBe(path.startsWith('/missing-') ? 404 : 200);
      try {
        await expect.poll(() => retries).toBeGreaterThanOrEqual(2);
        await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
        await expect(page.locator('#initial-frame-ready')).toHaveCount(0);
        await expect(page.locator('main')).toHaveCount(0);
        await expect(page.locator('#initial-document-content')).toHaveCount(1);
        expect((await readFontFrames(page)).some((frame) => frame.surfacePresent)).toBe(false);
        fail = false;
        await expectCorrectFirstFrames(page);
      } finally {
        fail = false;
      }
    }
  });
}

test('failed target fonts retry while the outgoing document stays visible, then commit after recovery', async ({
  page,
}) => {
  await installFontFrameProbe(page);
  await page.goto('/en/tags/frenet/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-blog-listing]')).toBeVisible();
  const outgoing = await page.locator('main').elementHandle();
  let fail = true;
  let retries = 0;
  await page.route(/KaTeX_.*\.(?:woff2?|ttf)(?:\?|$)/, (route) => {
    retries = Math.max(
      retries,
      Number(new URL(route.request().url()).searchParams.get('font-retry')),
    );
    return fail ? route.abort('failed') : route.continue();
  });
  await page.evaluate(() => {
    const link = document.querySelector<HTMLAnchorElement>(
      'a[href="/en/blog/planar-frenet-frame/"]',
    )!;
    link.dataset.astroPrefetch = 'false';
    link.click();
  });
  await expect.poll(() => retries).toBeGreaterThanOrEqual(2);
  expect(await outgoing!.evaluate((main) => main === document.querySelector('main'))).toBe(true);
  await expect(page).toHaveURL(/\/en\/tags\/frenet\/$/);
  await expect(page.locator('[data-blog-listing]')).toBeVisible();
  await expect(page.locator('[data-article-page]')).toHaveCount(0);
  const pending = (await readFontFrames(page)).filter((frame) => frame.navigationPending);
  expect(pending.length).toBeGreaterThan(0);
  expect(pending.every((frame) => frame.visible && frame.sampleFontReady)).toBe(true);
  fail = false;
  await expect(page).toHaveURL(/\/en\/blog\/planar-frenet-frame\/$/);
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  expect(
    await page.evaluate(() => document.fonts.check('italic 400 16px "KaTeX_Math"', 'xyφκ')),
  ).toBe(true);
  await expect(page.locator('.katex').first()).toBeVisible();
});

test('replacing a waiting navigation stops its font retries', async ({ page }) => {
  await page.goto('/en/tags/frenet/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-blog-listing]')).toBeVisible();
  let requests = 0;
  let retries = 0;
  await page.route(/KaTeX_.*\.(?:woff2?|ttf)(?:\?|$)/, (route) => {
    requests++;
    retries = Math.max(
      retries,
      Number(new URL(route.request().url()).searchParams.get('font-retry')),
    );
    return route.abort('failed');
  });
  await page.evaluate(() =>
    document.querySelector<HTMLAnchorElement>('a[href="/en/blog/planar-frenet-frame/"]')!.click(),
  );
  await expect.poll(() => retries).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/en/about/';
    link.dataset.astroPrefetch = 'false';
    document.body.append(link);
    link.click();
  });
  await expect(page).toHaveURL(/\/en\/about\/$/);
  await expect(page.locator('.about-page')).toBeVisible();
  await page.waitForTimeout(100);
  const stopped = requests;
  await page.waitForTimeout(1_200);
  expect(requests).toBe(stopped);
  await expect(page).toHaveURL(/\/en\/about\/$/);
});

test('a failed Manrope file retries without showing fallback text or changing heading width', async ({
  page,
}) => {
  await page.goto('/en/blog/git-operations-reference/', { waitUntil: 'networkidle' });
  await expect(page.locator('main h1')).toBeVisible();
  const reference = await page.locator('main h1').evaluate((heading) => {
    const range = document.createRange();
    range.selectNodeContents(heading);
    return range.getBoundingClientRect().width;
  });
  const fontUrl = await page.locator('main h1').evaluate((heading) => {
    const family = getComputedStyle(heading)
      .fontFamily.split(',')[0]!
      .trim()
      .replace(/^["']|["']$/g, '');
    const find = (sheet: CSSStyleSheet | CSSGroupingRule, base: string): string | undefined => {
      for (const rule of sheet.cssRules) {
        if (
          rule instanceof CSSFontFaceRule &&
          rule.style.fontFamily.replace(/^["']|["']$/g, '') === family
        ) {
          const match = rule.style.getPropertyValue('src').match(/url\(["']?([^"')]+)["']?\)/);
          if (match) return new URL(match[1]!, base).href;
        } else if (rule instanceof CSSImportRule && rule.styleSheet) {
          const url = find(rule.styleSheet, rule.styleSheet.href || base);
          if (url) return url;
        } else if ('cssRules' in rule) {
          const url = find(rule as CSSGroupingRule, base);
          if (url) return url;
        }
      }
    };
    for (const sheet of document.styleSheets) {
      const url = find(sheet, sheet.href || document.baseURI);
      if (url) return url;
    }
  });
  expect(fontUrl).toBeDefined();
  await page.addInitScript(() => {
    const frames: { ready: boolean; width: number }[] = [];
    (window as Window & { __headingFrames?: typeof frames }).__headingFrames = frames;
    const sample = () => {
      const heading = document.querySelector('main h1');
      if (heading) {
        const family = getComputedStyle(heading)
          .fontFamily.split(',')[0]!
          .trim()
          .replace(/^["']|["']$/g, '');
        const range = document.createRange();
        range.selectNodeContents(heading);
        frames.push({
          ready: Array.from(document.fonts).some(
            (face) =>
              face.family.replace(/^["']|["']$/g, '') === family && face.status === 'loaded',
          ),
          width: range.getBoundingClientRect().width,
        });
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  let fail = true;
  let retries = 0;
  await page.route(
    (url) => url.pathname === new URL(fontUrl!).pathname,
    (route) => {
      retries = Math.max(
        retries,
        Number(new URL(route.request().url()).searchParams.get('font-retry')),
      );
      return fail ? route.abort('failed') : route.continue();
    },
  );
  const navigation = page.reload({ waitUntil: 'domcontentloaded' });
  void navigation.catch(() => undefined);
  await expect.poll(() => retries).toBeGreaterThanOrEqual(2);
  await expect(page.locator('main')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
  fail = false;
  await navigation;
  const readFrames = () =>
    page.evaluate(
      () =>
        (window as Window & { __headingFrames?: { ready: boolean; width: number }[] })
          .__headingFrames ?? [],
    );
  await expect.poll(async () => (await readFrames()).length).toBeGreaterThanOrEqual(8);
  for (const frame of await readFrames()) {
    expect(frame.ready).toBe(true);
    expect(frame.width).toBeCloseTo(reference, 2);
  }
});

test('a failed required stylesheet cannot release initial content even when fonts can download', async ({
  page,
}) => {
  await page.goto('/en/', { waitUntil: 'networkidle' });
  const stylesheet = await page.evaluate(
    () =>
      Array.from(document.styleSheets).find((sheet) =>
        Array.from(sheet.cssRules).some(
          (rule) =>
            rule instanceof CSSStyleRule &&
            rule.selectorText === 'body' &&
            Boolean(rule.style.fontFamily),
        ),
      )?.href,
  );
  expect(stylesheet).toBeTruthy();
  // Firefox can retain a parsed stylesheet across a failed revalidation.
  // A new URL models a genuinely unavailable required stylesheet.
  const coldStylesheet = new URL(stylesheet!);
  coldStylesheet.searchParams.set('stylesheet-case', String(Date.now()));
  await page.route('**/en/', async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    const original = `href="${new URL(stylesheet!).pathname}"`;
    expect(html).toContain(original);
    await route.fulfill({
      response,
      body: html.replace(original, `href="${coldStylesheet.pathname}${coldStylesheet.search}"`),
    });
  });
  let fail = true;
  let retries = 0;
  await page.route(
    (url) => url.pathname === new URL(stylesheet!).pathname,
    (route) => {
      retries = Math.max(
        retries,
        Number(new URL(route.request().url()).searchParams.get('style-retry')),
      );
      return fail ? route.abort('failed') : route.continue();
    },
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => retries).toBeGreaterThanOrEqual(2);
  await expect(page.locator('main')).toHaveCount(0);
  await expect(page.locator('#initial-frame-ready')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'loading');
  fail = false;
  await expect(page.locator('#home-heading')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  expect(
    await page.locator('#home-heading').evaluate((heading) => getComputedStyle(heading).fontFamily),
  ).toContain('Manrope');
});

for (const outcome of ['recover', 'cancel'] as const) {
  test(`a required target stylesheet keeps the current page until ${outcome}`, async ({ page }) => {
    await page.goto('/en/');
    await expect(page.locator('#home-heading')).toBeVisible();
    const outgoing = await page.locator('main').elementHandle();
    const resource = '/_astro/required-about-fixture.css';
    await page.route('**/en/about/', async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      await route.fulfill({
        response,
        body: html.replace('</head>', `<link rel="stylesheet" href="${resource}"></head>`),
      });
    });
    let fail = true;
    let retries = 0;
    let requests = 0;
    await page.route(
      (url) => url.pathname === resource,
      (route) => {
        requests++;
        retries = Math.max(
          retries,
          Number(new URL(route.request().url()).searchParams.get('style-retry')),
        );
        return fail
          ? route.abort('failed')
          : route.fulfill({
              contentType: 'text/css',
              body: 'html { --required-style-probe: ready; }',
            });
      },
    );
    await page.locator('.site-header__desktop a[href="/en/about/"]').click();
    await expect.poll(() => retries).toBeGreaterThanOrEqual(2);
    expect(await outgoing!.evaluate((main) => main === document.querySelector('main'))).toBe(true);
    await expect(page.locator('#home-heading')).toBeVisible();
    if (outcome === 'recover') {
      fail = false;
      await expect(page.locator('.about-page')).toBeVisible();
      await expect(page).toHaveURL(/\/en\/about\/$/);
      expect(
        await page.evaluate(() =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--required-style-probe')
            .trim(),
        ),
      ).toBe('ready');
    } else {
      await page.locator('.site-header__desktop a[href="/en/blog/"]').click();
      await expect(page.locator('[data-blog-listing]')).toBeVisible();
      await page.waitForTimeout(100);
      const stopped = requests;
      await page.waitForTimeout(1_100);
      expect(requests).toBe(stopped);
      await expect(page).toHaveURL(/\/en\/blog\/$/);
    }
  });
}

test('recovered stylesheets retain their repaired Chinese font rules across client navigation', async ({
  page,
}) => {
  let recoveredStylesheet = false;
  await page.route(/typography-vendor\.[^/]+\.css(?:\?|$)/, (route) => {
    const url = new URL(route.request().url());
    // Firefox can issue the original URL twice. Keep it unavailable until the
    // application's stylesheet retry, then allow the original URL on navigation.
    if (url.searchParams.has('style-retry')) recoveredStylesheet = true;
    return recoveredStylesheet ? route.continue() : route.abort('failed');
  });
  let fontRetries = 0;
  await page.route(/noto-sans-sc.*\.woff2(?:\?|$)/, (route) => {
    if (new URL(route.request().url()).searchParams.has('font-retry')) {
      fontRetries++;
      return route.continue();
    }
    return route.abort('failed');
  });
  await page.goto('/zh/blog/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-blog-listing]')).toBeVisible();
  expect(fontRetries).toBeGreaterThan(0);
  const retained = await page
    .locator('link[rel="stylesheet"][href*="typography-vendor"]')
    .elementHandle();
  const href = await retained!.getAttribute('href');
  expect(href).toContain('style-retry=');
  const repairedRules = await retained!.evaluate(
    (link) =>
      Array.from((link as HTMLLinkElement).sheet!.cssRules).filter(
        (rule) => rule instanceof CSSFontFaceRule && rule.cssText.includes('font-retry'),
      ).length,
  );
  expect(repairedRules).toBeGreaterThan(0);
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);

  const assertRecoveredFonts = async () => {
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    expect(
      await retained!.evaluate(
        (link) =>
          link.isConnected &&
          link === document.querySelector('link[rel="stylesheet"][href*="typography-vendor"]'),
      ),
    ).toBe(true);
    expect(await retained!.getAttribute('href')).toBe(href);
    const available = await page.evaluate(() => {
      const text = [
        ...new Set(document.querySelector('main')!.textContent!.match(/\p{Script=Han}/gu)),
      ].join('');
      return (
        text.length > 0 &&
        Array.from(document.fonts).some(
          (face) => face.family.includes('Noto Sans SC') && face.status === 'loaded',
        ) &&
        document.fonts.check('400 16px "Noto Sans SC Variable"', text)
      );
    });
    expect(available).toBe(true);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  };

  await assertRecoveredFonts();
  await page.locator('.site-header__desktop a[href="/zh/about/"]').click();
  await expect(page.locator('.about-page')).toBeVisible();
  await assertRecoveredFonts();
  await page.goBack();
  await expect(page.locator('[data-blog-listing]')).toBeVisible();
  await assertRecoveredFonts();
  await page.goForward();
  await expect(page.locator('.about-page')).toBeVisible();
  await assertRecoveredFonts();
});

for (const difference of ['path', 'query'] as const) {
  test(`a recovered stylesheet does not mask a target resource with a different ${difference}`, async ({
    page,
  }) => {
    const original = '/_astro/style-identity-a.css?revision=1';
    const target =
      difference === 'path'
        ? '/_astro/style-identity-b.css?revision=1'
        : '/_astro/style-identity-a.css?revision=2';
    await page.route(/\/style-identity-[ab]\.css\?/, (route) => {
      const url = new URL(route.request().url());
      const isOriginal =
        url.pathname.endsWith('-a.css') && url.searchParams.get('revision') === '1';
      if (isOriginal && !url.searchParams.has('style-retry')) return route.abort('failed');
      return route.fulfill({
        contentType: 'text/css',
        body: `html { --style-identity-probe: ${isOriginal ? 'original' : 'target'}; }`,
      });
    });
    await page.route(/\/en\/(?:about\/)?$/, async (route) => {
      const response = await route.fetch();
      const resource = new URL(route.request().url()).pathname === '/en/' ? original : target;
      await route.fulfill({
        response,
        body: (await response.text()).replace(
          '</head>',
          `<link rel="stylesheet" href="${resource}"></head>`,
        ),
      });
    });
    const appliedResource = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--style-identity-probe')
          .trim(),
      );
    await page.goto('/en/');
    await expect(page.locator('#home-heading')).toBeVisible();
    expect(await appliedResource()).toBe('original');
    const oldLink = await page
      .locator('link[rel="stylesheet"][href*="style-identity"]')
      .elementHandle();
    expect(await oldLink!.getAttribute('href')).toContain('style-retry=');
    await page.locator('.site-header__desktop a[href="/en/about/"]').click();
    await expect(page.locator('.about-page')).toBeVisible();
    expect(await appliedResource()).toBe('target');
    expect(await oldLink!.evaluate((link) => link.isConnected)).toBe(false);
  });
}
