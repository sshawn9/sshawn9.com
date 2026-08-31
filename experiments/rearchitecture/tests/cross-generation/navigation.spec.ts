import { expect, test, type Page, type Response } from '@playwright/test';

const buildId = (page: Page) => page.locator('meta[name="poc-build-id"]').getAttribute('content');

const responseGeneration = async (response: Response) => ({
  asset: (await response.headerValue('x-poc-asset-generation')) ?? undefined,
  document: (await response.headerValue('x-poc-document-generation')) ?? undefined,
  resourceType: response.request().resourceType(),
  url: response.url(),
});

test('a deployment boundary performs one native commit, then resumes same-generation navigation', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/zh/blog/');
  await expect.poll(() => buildId(page)).toBe('generation-a');

  await page.getByRole('button', { name: '切换主题' }).click();
  await page.getByRole('button', { name: '切换壁纸' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'off');

  const expectedPageY = await page.evaluate(() => {
    window.scrollTo(0, 180);
    document.querySelector<HTMLElement>('[data-scroll-region="tag-rail"]')?.scrollTo(0, 240);
    document
      .querySelector('[data-site-shell]')
      ?.setAttribute('data-test-shell-instance', 'generation-a');
    sessionStorage.setItem('test:old-runtime-swaps', '0');
    document.addEventListener('astro:before-swap', () => {
      const count = Number(sessionStorage.getItem('test:old-runtime-swaps') ?? '0');
      sessionStorage.setItem('test:old-runtime-swaps', String(count + 1));
    });
    return Math.round(window.scrollY);
  });
  await expect
    .poll(() => page.evaluate(() => history.state?.rearchitecturePoc?.regions?.['tag-rail']?.y))
    .toBe(240);

  const responses: ReturnType<typeof responseGeneration>[] = [];
  page.on('response', (response) => {
    responses.push(responseGeneration(response));
  });

  await page.locator('[data-article-link="primary"]').click();
  await expect(page).toHaveURL(/\/zh\/blog\/frenet-poc\//);
  await expect(page.locator('[data-article-page]')).toBeVisible();
  await expect.poll(() => buildId(page)).toBe('generation-b');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper', 'off');
  await expect(page.locator('[data-test-shell-instance="generation-a"]')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('test:old-runtime-swaps'))).toBe('0');

  const afterBoundary = await Promise.all(responses);
  const targetResponses = afterBoundary.filter(({ url }) =>
    new URL(url).pathname.startsWith('/zh/blog/frenet-poc/'),
  );
  expect(targetResponses.map(({ resourceType }) => resourceType)).toContain('fetch');
  expect(targetResponses.map(({ resourceType }) => resourceType)).toContain('document');
  expect(targetResponses.every(({ document }) => document === 'b')).toBe(true);
  const boundaryAssets = afterBoundary.filter(({ asset }) => asset !== undefined);
  expect(boundaryAssets.length).toBeGreaterThan(0);
  expect(boundaryAssets.every(({ asset }) => asset === 'b')).toBe(true);

  await page
    .locator('[data-site-shell]')
    .evaluate((element) => element.setAttribute('data-test-shell-instance', 'generation-b'));
  responses.length = 0;
  await page.locator('a.brand').click();
  await expect(page).toHaveURL(/\/zh\/blog\/$/);
  await expect(page.locator('[data-blog-page]')).toBeVisible();
  await expect.poll(() => buildId(page)).toBe('generation-b');
  await expect(page.locator('[data-test-shell-instance="generation-b"]')).toHaveCount(1);

  const sameGeneration = await Promise.all(responses);
  expect(sameGeneration.some(({ resourceType }) => resourceType === 'document')).toBe(false);
  expect(
    sameGeneration.filter(({ asset }) => asset !== undefined).every(({ asset }) => asset === 'b'),
  ).toBe(true);

  responses.length = 0;
  await page.goBack();
  await expect(page).toHaveURL(/\/zh\/blog\/frenet-poc\//);
  await expect(page.locator('[data-article-page]')).toBeVisible();
  await expect(page.locator('[data-test-shell-instance="generation-b"]')).toHaveCount(1);
  expect(
    (await Promise.all(responses)).some(({ resourceType }) => resourceType === 'document'),
  ).toBe(false);

  responses.length = 0;
  await page.goBack();
  await expect(page).toHaveURL(/\/zh\/blog\/$/);
  await expect(page.locator('[data-blog-page]')).toBeVisible();
  await expect.poll(() => buildId(page)).toBe('generation-b');
  await expect(page.locator('[data-test-shell-instance="generation-b"]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.locator('[data-scroll-region="tag-rail"]').evaluate((element) => element.scrollTop),
    )
    .toBe(240);
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(expectedPageY);

  const afterReturn = await Promise.all(responses);
  expect(afterReturn.some(({ resourceType }) => resourceType === 'document')).toBe(true);
  expect(
    afterReturn.filter(({ asset }) => asset !== undefined).every(({ asset }) => asset === 'b'),
  ).toBe(true);
});

test('missing target identity degrades to a complete native document without an old-runtime swap', async ({
  page,
}) => {
  await page.goto('/zh/blog/');
  await expect.poll(() => buildId(page)).toBe('generation-a');
  await page.locator('[data-site-shell]').evaluate((element) => {
    element.setAttribute('data-test-shell-instance', 'generation-a');
    sessionStorage.setItem('test:old-runtime-swaps', '0');
    document.addEventListener('astro:before-swap', () => {
      const count = Number(sessionStorage.getItem('test:old-runtime-swaps') ?? '0');
      sessionStorage.setItem('test:old-runtime-swaps', String(count + 1));
    });
  });

  const link = page.locator('[data-article-link="primary"]');
  await link.evaluate((element) => {
    const anchor = element as HTMLAnchorElement;
    const url = new URL(anchor.href);
    url.searchParams.set('generation-meta', 'missing');
    anchor.href = url.href;
  });
  await link.click();

  await expect(page).toHaveURL(/generation-meta=missing/);
  await expect(page.locator('[data-article-page]')).toBeVisible();
  await expect(page.locator('.article-section')).toHaveCount(72);
  await expect(page.locator('meta[name="poc-build-id"]')).toHaveCount(0);
  await expect(page.locator('[data-test-shell-instance="generation-a"]')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('test:old-runtime-swaps'))).toBe('0');
});
