import { expect, test } from '@playwright/test';

test('the site header exposes desktop navigation and a mobile disclosure menu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/en/blog/');

  const header = page.locator('.site-header');
  const identity = header.locator('.site-header__identity');
  const desktopNavigation = header.locator('.site-header__primary-nav');
  const menuButton = header.locator('[popovertarget="site-navigation"]');

  await expect(identity).toHaveAttribute('href', '/en/');
  await expect(desktopNavigation).toBeVisible();
  await expect(desktopNavigation.locator('a')).toHaveCount(3);
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
  await expect(mobilePanel.locator('[data-wallpaper-menu-trigger]')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(mobilePanel).toBeHidden();
  await expect(menuButton).toHaveAccessibleName('Open navigation');
});

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
  await expect
    .poll(() => media.evaluate((element) => getComputedStyle(element).visibility))
    .toBe('hidden');
  await expect
    .poll(() => html.evaluate((element) => getComputedStyle(element, '::before').visibility))
    .toBe('hidden');

  await page.locator('[data-theme-toggle]:visible').first().click();
  await expect(html).not.toHaveClass(/dark/);
  await expect(html).toHaveAttribute('data-wallpaper-mode', 'default');
  await expect(activeImage).toHaveCount(1);

  await wallpaperControl.locator('[data-wallpaper-menu-trigger]').click();
  await wallpaperControl.locator('[data-wallpaper-enabled-control]').click();
  await expect(html).not.toHaveClass(/dark/);
  await expect(html).toHaveAttribute('data-wallpaper-mode', 'scenic');
  await expect
    .poll(() => media.evaluate((element) => getComputedStyle(element).visibility))
    .toBe('visible');
  await expect
    .poll(() => html.evaluate((element) => getComputedStyle(element, '::before').visibility))
    .toBe('visible');
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
    window.requestAnimationFrame(() => {
      const style = getComputedStyle(document.documentElement, '::before');
      sessionStorage.setItem(
        'wallpaper-first-frame-state',
        JSON.stringify({
          backgroundImage: style.backgroundImage,
          opacity: Number.parseFloat(style.opacity),
          visibility: style.visibility,
        }),
      );
    });
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
    .toEqual(
      expect.objectContaining({
        backgroundImage: expect.stringContaining('data:image/'),
        opacity: expect.any(Number),
        visibility: 'visible',
      }),
    );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = JSON.parse(sessionStorage.getItem('wallpaper-first-frame-state') ?? 'null');
        return value?.opacity;
      }),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('wallpaper-current-background')))
    .toBe(storedPoster);
  await expect.poll(() => imageRequests).toBe(0);
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
  const wallpaperPanel = wallpaperControl.locator('[popover]');
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

  await wallpaperControl.locator('[data-wallpaper-enabled-control]').click();
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

  await wallpaperControl.locator('[data-wallpaper-enabled-control]').click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'scenic');
  await expect.poll(() => manifestRequests).toBe(3);
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement, '::before').opacity),
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
