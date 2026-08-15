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

test('the wallpaper recovers from a transient failure and keeps one photo per session', async ({
  page,
}) => {
  const manifest = {
    version: 1,
    updatedAt: '2026-08-14T00:00:00.000Z',
    photos: [1, 2].map((index) => ({
      id: `photo-${index}`,
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
  await expect.poll(() => manifestRequests).toBe(1);
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(0);

  await page.locator('header nav').first().locator('a[href="/en/blog/"]').click();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect.poll(() => manifestRequests).toBe(2);
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(1);
  await expect(page.locator('[data-wallpaper-credit]')).toBeVisible();
  await expect(page.locator('[data-wallpaper-credit]')).toContainText('Photo by Photographer');
  const selectedId = await page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id'));
  expect(selectedId).toMatch(/^photo-[12]$/);
  await expect.poll(() => downloadReports).toBe(1);
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
  expect(downloadReports).toBe(1);

  const wallpaperControl = page.locator('[data-wallpaper-control]:visible').first();
  const wallpaperTrigger = wallpaperControl.locator('[data-wallpaper-menu-trigger]');
  const wallpaperPanel = wallpaperControl.locator('[popover]');
  await wallpaperTrigger.click();
  await expect(wallpaperControl.locator('[data-wallpaper-enabled]')).toBeChecked();
  await expect(wallpaperControl.locator('[data-wallpaper-mode="auto"]')).toBeChecked();

  const triggerBox = await wallpaperTrigger.boundingBox();
  const panelBox = await wallpaperPanel.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(
    Math.abs(panelBox!.x + panelBox!.width - (triggerBox!.x + triggerBox!.width)),
  ).toBeLessThan(2);
  expect(panelBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height);

  const rotationControl = wallpaperControl.locator('[data-wallpaper-rotation]');
  const nextButton = wallpaperControl.locator('[data-wallpaper-next]');
  const rotationOpacity = await rotationControl.evaluate(
    (element) => getComputedStyle(element).opacity,
  );
  imageGate = new Promise((resolve) => {
    releaseImageGate = resolve;
  });
  await nextButton.click();
  await expect(nextButton).toHaveAttribute('aria-busy', 'true');
  await expect(rotationControl).not.toHaveAttribute('disabled', '');
  await expect
    .poll(() => rotationControl.evaluate((element) => getComputedStyle(element).opacity))
    .toBe(rotationOpacity);
  releaseImageGate?.();
  imageGate = undefined;
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id')))
    .not.toBe(selectedId);
  await expect.poll(() => downloadReports).toBe(2);

  const fixedId = await page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id'));
  await wallpaperControl.locator('[data-wallpaper-mode-option="fixed"]').click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wallpaper-rotation-mode')))
    .toBe('fixed');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wallpaper-fixed-photo-id')))
    .toBe(fixedId);

  await page.locator('header nav').first().locator('a[href="/en/about/"]').click();
  await expect(page).toHaveURL(/\/en\/about\/$/);
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id')))
    .toBe(fixedId);
  await wallpaperControl.locator('[data-wallpaper-menu-trigger]').click();
  await expect(wallpaperControl.locator('[data-wallpaper-mode="fixed"]')).toBeChecked();

  await wallpaperControl.locator('[data-wallpaper-enabled-control]').click();
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(0);
  await expect(page.locator('[data-wallpaper-credit]')).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wallpaper-enabled')))
    .toBe('false');
  await expect(wallpaperControl.locator('[data-wallpaper-rotation]')).toHaveAttribute(
    'disabled',
    '',
  );
  await expect(wallpaperControl.locator('[data-wallpaper-next]')).toBeDisabled();

  await page.reload();
  await expect.poll(() => manifestRequests).toBe(2);
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(0);
  await wallpaperControl.locator('[data-wallpaper-menu-trigger]').click();
  await expect(wallpaperControl.locator('[data-wallpaper-enabled]')).not.toBeChecked();
  await expect(wallpaperControl.locator('[data-wallpaper-mode="fixed"]')).toBeChecked();

  await wallpaperControl.locator('[data-wallpaper-enabled-control]').click();
  await expect.poll(() => manifestRequests).toBe(3);
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wallpaper-enabled')))
    .toBe('true');
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('wallpaper-photo-id')))
    .toBe(fixedId);

  await wallpaperControl.locator('[data-wallpaper-mode-option="auto"]').click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wallpaper-rotation-mode')))
    .toBe('auto');
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

test('version comparison loads on demand and supports both layouts', async ({ page }) => {
  await page.goto('/en/blog/my-personal-website/');
  const comparisonLink = page.locator('[data-version-compare-link]').first();
  await expect(comparisonLink).toHaveAttribute('href', /\/compare\//);
  const comparisonHref = await comparisonLink.getAttribute('href');
  await page.goto(comparisonHref!);

  await expect(page.locator('[data-version-comparison]')).toBeVisible();
  await expect(page.locator('[data-diff-panel="unified"]')).toBeVisible();
  await page.locator('[data-diff-mode="split"]:visible').click();
  await expect(page.locator('[data-diff-panel="split"]')).toBeVisible();
});
