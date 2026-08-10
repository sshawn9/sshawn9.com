import { expect, test } from '@playwright/test';

test('language switching keeps the route and stores the preference', async ({ page }) => {
  await page.goto('/en/blog/');
  await page.locator('a[data-locale-switch="zh"]').first().click();

  await expect(page).toHaveURL(/\/zh\/blog\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('PARAGLIDE_LOCALE'))).toBe('zh');
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
  await page.goto('/en/');
  const root = page.locator('html');
  const wasDark = await root.evaluate((element) => element.classList.contains('dark'));

  await page.locator('[data-theme-toggle]').first().click();
  await expect
    .poll(() => root.evaluate((element) => element.classList.contains('dark')))
    .toBe(!wasDark);

  await page.locator('header nav').first().locator('a[href="/en/blog/"]').click();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect
    .poll(() => root.evaluate((element) => element.classList.contains('dark')))
    .toBe(!wasDark);
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

test('version comparison loads on demand and supports both layouts', async ({ page }) => {
  await page.goto('/en/blog/');
  const articleHrefs = await page
    .locator('[data-blog-article] h2 a')
    .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href));
  let comparisonHref: string | null = null;

  for (const href of articleHrefs) {
    await page.goto(href);
    const link = page.locator('[data-version-compare-link]').first();
    if ((await link.count()) > 0) {
      comparisonHref = await link.getAttribute('href');
      break;
    }
  }

  expect(comparisonHref).not.toBeNull();
  await page.goto(comparisonHref!);

  await expect(page.locator('[data-version-comparison]')).toBeVisible();
  await expect(page.locator('[data-diff-panel="unified"]')).toBeVisible();
  await page.locator('[data-diff-mode="split"]:visible').click();
  await expect(page.locator('[data-diff-panel="split"]')).toBeVisible();
});
