import { expect, test } from '@playwright/test';

const articlePhrase = '车辆轨迹与参考路径的局部关系不能只用一个瞬时误差概括';

test('static HTML completes the first-frame region before any hydration island', async ({
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'astro',
    'The render boundary belongs to the Astro candidate.',
  );

  const [blogResponse, articleResponse] = await Promise.all([
    request.get('/zh/blog/'),
    request.get('/zh/blog/frenet-poc/'),
  ]);
  expect(blogResponse.ok()).toBe(true);
  expect(articleResponse.ok()).toBe(true);

  const blogHtml = await blogResponse.text();
  const articleHtml = await articleResponse.text();

  for (const html of [blogHtml, articleHtml]) {
    const shell = html.indexOf('data-site-shell');
    const shellController = html.indexOf('data-site-shell-controller');
    const boundary = html.indexOf('id="initial-frame-ready"');
    const coordinator = html.indexOf("boundary.removeAttribute('id')");

    expect(html).toContain('<link rel="expect" href="#initial-frame-ready" blocking="render">');
    expect(shell).toBeGreaterThan(-1);
    expect(shellController).toBeGreaterThan(shell);
    expect(shellController).toBeLessThan(boundary);
    expect(boundary).toBeGreaterThan(shell);
    expect(coordinator).toBeGreaterThan(boundary);
    expect(html).not.toContain('SiteShell.svelte');
  }

  expect(blogHtml).not.toContain('<astro-island');
  expect(articleHtml.indexOf('<astro-island')).toBeGreaterThan(
    articleHtml.indexOf("boundary.removeAttribute('id')"),
  );
});

test('early TOC parsing preserves the established mobile visual order', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'astro',
    'The parsed/visual ordering contract belongs to the Astro candidate.',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/zh/blog/frenet-poc/');

  const order = await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('.article-body');
    const toc = document.querySelector<HTMLElement>('.article-toc');
    if (!body || !toc) {
      return null;
    }
    const bodyRect = body.getBoundingClientRect();
    const tocRect = toc.getBoundingClientRect();
    return {
      bodyBeforeTocVisually: bodyRect.bottom <= tocRect.top,
      tocBeforeBodyInDocument: Boolean(
        toc.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    };
  });

  expect(order).toEqual({
    bodyBeforeTocVisually: true,
    tocBeforeBodyInDocument: true,
  });
});

test('direct document visits remain complete without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  await page.goto(baseURL + '/zh/blog/');
  await expect(page.locator('[data-blog-page]')).toBeVisible();
  await expect(page.locator('[data-site-shell]')).toBeVisible();

  await page.locator('[data-article-link="primary"]').click();
  await expect(page).toHaveURL(/\/zh\/blog\/frenet-poc\//);
  await expect(page.locator('[data-article-page]')).toBeVisible();
  await expect(page.locator('.article-section')).toHaveCount(72);
  await expect(page.locator('[data-interactive-diagram]')).toContainText('静态回退始终保留');

  await context.close();
});

test('slow navigation keeps one styled old page until one target commit', async ({ page }) => {
  await page.goto('/zh/blog/');
  const shell = page.locator('[data-site-shell]');
  const shellHandle = await shell.elementHandle();
  expect(shellHandle).not.toBeNull();

  let delayed = false;
  await page.route(/\/zh\/blog\/frenet-poc\//, async (route) => {
    const type = route.request().resourceType();
    if (!delayed && (type === 'document' || type === 'fetch')) {
      delayed = true;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    await route.continue();
  });

  await page.locator('[data-article-link="primary"]').click();
  await expect(page.locator('[data-navigation-progress]')).toHaveAttribute('data-active', 'true');
  await expect(page.locator('[data-blog-page]')).toBeVisible();
  await expect
    .poll(() =>
      page.locator('.blog-layout').evaluate((element) => getComputedStyle(element).display),
    )
    .toBe('grid');

  await expect(page.locator('[data-article-page]')).toBeVisible();
  expect(delayed).toBe(true);
  await expect(page.locator('[data-blog-page]')).toHaveCount(0);
  expect(
    await shellHandle?.evaluate((node) => node === document.querySelector('[data-site-shell]')),
  ).toBe(true);
  await expect(page.locator('[data-navigation-progress]')).toHaveAttribute('data-active', 'false');
});

test('theme, page scroll and nested scroll belong to the correct history entry', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/zh/blog/');
  const shell = page.locator('[data-site-shell]');
  const shellHandle = await shell.elementHandle();
  expect(shellHandle).not.toBeNull();

  await page.getByRole('button', { name: '切换主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  const expectedPageY = await page.evaluate(() => {
    const previousScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, 200);
    document.documentElement.style.scrollBehavior = previousScrollBehavior;
    const rail = document.querySelector<HTMLElement>('[data-scroll-region="tag-rail"]');
    rail?.scrollTo(0, 260);
    return Math.round(window.scrollY);
  });
  await expect
    .poll(() => page.evaluate(() => history.state?.rearchitecturePoc?.regions?.['tag-rail']?.y))
    .toBe(260);

  const historyLink = page.locator('[data-article-link="history"]');
  await expect(historyLink).toBeInViewport();
  await historyLink.click();
  await expect(page.locator('[data-article-page]')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.goBack();
  await expect(page.locator('[data-blog-page]')).toBeVisible();
  expect(
    await shellHandle?.evaluate((node) => node === document.querySelector('[data-site-shell]')),
  ).toBe(true);
  await expect
    .poll(() =>
      page.locator('[data-scroll-region="tag-rail"]').evaluate((element) => element.scrollTop),
    )
    .toBe(260);
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(expectedPageY);
});

test('article prose is not duplicated into JavaScript delivered for navigation', async ({
  page,
}, testInfo) => {
  test.fail(
    testInfo.project.name === 'qwik',
    'Qwik City SPA navigation downloads the route render chunk containing article prose.',
  );

  const scriptBodies: Promise<string>[] = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'script' || response.url().endsWith('.js')) {
      scriptBodies.push(response.text().catch(() => ''));
    }
  });

  await page.goto('/zh/blog/');
  await page.locator('[data-article-link="primary"]').click();
  await expect(page.locator('[data-article-page]')).toBeVisible();
  const scripts = (await Promise.all(scriptBodies)).join('\n');

  testInfo.annotations.push({
    type: 'navigation-script-bytes',
    description: String(new TextEncoder().encode(scripts).byteLength),
  });
  expect(scripts).not.toContain(articlePhrase);
});
