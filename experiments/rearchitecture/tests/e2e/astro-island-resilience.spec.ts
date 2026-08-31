import { expect, test } from '@playwright/test';

const componentChunk = /\/_astro\/InteractiveDiagram\..*\.js(?:\?.*)?$/;
const heavyChunk = /\/_astro\/heavy-placeholder\..*\.js(?:\?.*)?$/;

function skipNonAstro(projectName: string) {
  test.skip(projectName !== 'astro', 'This suite exercises Astro islands.');
}

test('delayed hydration preserves the server-rendered diagram nodes and geometry', async ({
  page,
}, testInfo) => {
  skipNonAstro(testInfo.project.name);

  let releaseComponent = () => {};
  let componentRequestStarted = () => {};
  const componentGate = new Promise<void>((resolve) => {
    releaseComponent = resolve;
  });
  const requestStarted = new Promise<void>((resolve) => {
    componentRequestStarted = resolve;
  });
  await page.route(componentChunk, async (route) => {
    componentRequestStarted();
    await componentGate;
    await route.continue();
  });

  await page.goto('/zh/blog/frenet-poc/?source=delayed-island');
  await page.evaluate(() => document.fonts.ready);
  const figure = page.locator('[data-interactive-diagram]');
  const figureHandle = await figure.elementHandle();
  expect(figureHandle).not.toBeNull();

  await figure.scrollIntoViewIfNeeded();
  await requestStarted;
  const before = await page.evaluate(() => ({
    figureHeight: document
      .querySelector<HTMLElement>('[data-interactive-diagram]')!
      .getBoundingClientRect().height,
    nextSectionTop: document.querySelector<HTMLElement>('#analysis-04')!.getBoundingClientRect()
      .top,
  }));

  releaseComponent();
  await expect(
    page.locator('astro-island[component-url*="InteractiveDiagram"]'),
  ).not.toHaveAttribute('ssr');
  const after = await page.evaluate(() => ({
    figureHeight: document
      .querySelector<HTMLElement>('[data-interactive-diagram]')!
      .getBoundingClientRect().height,
    nextSectionTop: document.querySelector<HTMLElement>('#analysis-04')!.getBoundingClientRect()
      .top,
  }));

  expect(
    await figureHandle?.evaluate(
      (node) => node === document.querySelector('[data-interactive-diagram]'),
    ),
  ).toBe(true);
  expect(Math.abs(after.figureHeight - before.figureHeight)).toBeLessThan(1);
  expect(Math.abs(after.nextSectionTop - before.nextSectionTop)).toBeLessThan(1);
});

test('the heavyweight module is requested only after explicit use', async ({ page }, testInfo) => {
  skipNonAstro(testInfo.project.name);

  let heavyRequests = 0;
  page.on('request', (request) => {
    if (heavyChunk.test(request.url())) {
      heavyRequests += 1;
    }
  });

  await page.goto('/zh/blog/frenet-poc/?source=on-demand-heavy');
  const figure = page.locator('[data-interactive-diagram]');
  await figure.scrollIntoViewIfNeeded();
  await expect(
    page.locator('astro-island[component-url*="InteractiveDiagram"]'),
  ).not.toHaveAttribute('ssr');
  expect(heavyRequests).toBe(0);

  await page.getByRole('button', { name: '加载重型图形占位' }).click();
  await expect(page.locator('[data-heavy-status]')).toHaveText('重型依赖已按需加载');
  expect(heavyRequests).toBe(1);
  await expect(page.getByRole('button', { name: '交互增强已加载' })).toBeDisabled();
});

test('a failed heavyweight import keeps a meaningful static fallback', async ({
  page,
}, testInfo) => {
  skipNonAstro(testInfo.project.name);

  await page.route(heavyChunk, (route) => route.abort('failed'));
  await page.goto('/zh/blog/frenet-poc/?source=failed-heavy');
  const figure = page.locator('[data-interactive-diagram]');
  await figure.scrollIntoViewIfNeeded();
  await expect(
    page.locator('astro-island[component-url*="InteractiveDiagram"]'),
  ).not.toHaveAttribute('ssr');

  await page.getByRole('button', { name: '加载重型图形占位' }).click();
  await expect(page.locator('[data-heavy-status]')).toHaveText(
    '交互增强加载失败；静态示意图仍可阅读。',
  );
  await expect(page.locator('.diagram-stage')).toBeVisible();
  await expect(figure).toContainText('局部弧长换算交互图（静态回退始终保留）');
  await expect(page.getByRole('button', { name: '交互增强不可用' })).toBeDisabled();
});

test('a failed island bundle leaves the server-rendered fallback intact', async ({
  page,
}, testInfo) => {
  skipNonAstro(testInfo.project.name);

  let blockedRequests = 0;
  await page.route(componentChunk, (route) => {
    blockedRequests += 1;
    return route.abort('failed');
  });
  await page.goto('/zh/blog/frenet-poc/?source=failed-island');
  const figure = page.locator('[data-interactive-diagram]');
  const figureHandle = await figure.elementHandle();
  await figure.scrollIntoViewIfNeeded();
  await expect.poll(() => blockedRequests).toBeGreaterThanOrEqual(2);

  await expect(figure).toContainText('交互增强尚未加载；静态示意图仍可阅读。');
  await expect(page.locator('.diagram-stage')).toBeVisible();
  expect(
    await figureHandle?.evaluate(
      (node) => node === document.querySelector('[data-interactive-diagram]'),
    ),
  ).toBe(true);
});

test('a late heavyweight import cannot write after its island leaves the page', async ({
  page,
}, testInfo) => {
  skipNonAstro(testInfo.project.name);

  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let releaseHeavy = () => {};
  let heavyRequestStarted = () => {};
  let heavyRequestFinished = () => {};
  const heavyGate = new Promise<void>((resolve) => {
    releaseHeavy = resolve;
  });
  const requestStarted = new Promise<void>((resolve) => {
    heavyRequestStarted = resolve;
  });
  const requestFinished = new Promise<void>((resolve) => {
    heavyRequestFinished = resolve;
  });
  await page.route(heavyChunk, async (route) => {
    heavyRequestStarted();
    await heavyGate;
    await route.continue().catch(() => {});
    heavyRequestFinished();
  });

  await page.goto('/zh/blog/frenet-poc/?source=late-heavy');
  const figure = page.locator('[data-interactive-diagram]');
  await figure.scrollIntoViewIfNeeded();
  await expect(
    page.locator('astro-island[component-url*="InteractiveDiagram"]'),
  ).not.toHaveAttribute('ssr');
  const oldStatus = await page.locator('[data-heavy-status]').elementHandle();

  await page.getByRole('button', { name: '加载重型图形占位' }).click();
  await requestStarted;
  await page.locator('a.brand').dispatchEvent('click');
  await expect(page.locator('[data-blog-page]')).toBeVisible();
  expect(await oldStatus?.evaluate((node) => node.isConnected)).toBe(false);

  releaseHeavy();
  await requestFinished;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expect(page.locator('[data-blog-page]')).toBeVisible();
  expect(await oldStatus?.evaluate((node) => node.textContent)).toBe(
    '正在加载交互增强；静态示意图仍可阅读。',
  );
  expect(pageErrors).toEqual([]);
});
