import { expect, test, type Page } from '@playwright/test';

const photoOne = {
  id: 'photo-one',
  createdAt: '2026-08-28T00:00:00.000Z',
  blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
  rawUrl: 'https://images.unsplash.com/photo-one?ixid=one',
  photographerName: 'First Photographer',
  photographerUrl: 'https://unsplash.com/@first?utm_source=sshawn9.com',
  photoUrl: 'https://unsplash.com/photos/photo-one?utm_source=sshawn9.com',
};
const photoTwo = {
  ...photoOne,
  id: 'photo-two',
  createdAt: '2026-08-29T00:00:00.000Z',
  rawUrl: 'https://images.unsplash.com/photo-two?ixid=two',
  photographerName: 'Second Photographer',
  photographerUrl: 'https://unsplash.com/@second?utm_source=sshawn9.com',
  photoUrl: 'https://unsplash.com/photos/photo-two?utm_source=sshawn9.com',
};

const wallpaperPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWMISq8iCTGMakgfDKEEALF9rLGZ8m0AAAAAAElFTkSuQmCC',
  'base64',
);
const wallpaperDataUrl = `data:image/png;base64,${wallpaperPng.toString('base64')}`;

const imageUrl = (rawUrl: string) => {
  const url = new URL(rawUrl);
  url.searchParams.set('auto', 'format');
  url.searchParams.set('fit', 'max');
  url.searchParams.set('q', '80');
  url.searchParams.set('w', '1600');
  return url.toString();
};

const manifest = {
  version: 2,
  updatedAt: '2026-08-29T00:00:00.000Z',
  photos: [photoOne, photoTwo],
};

async function textPalette(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    probe.hidden = true;
    document.body.append(probe);
    const read = (property: string) => {
      probe.style.color = `var(${property})`;
      return getComputedStyle(probe).color;
    };
    const palette = {
      strong: read('--text-strong'),
      default: read('--text-default'),
      supporting: read('--text-supporting'),
      disabled: read('--text-disabled'),
      accent: read('--text-accent'),
      accentHover: read('--text-accent-hover'),
      onAccent: read('--text-on-accent'),
    };
    probe.remove();
    return palette;
  });
}

async function routeWallpaperApi(page: Page): Promise<{ downloadReports: string[] }> {
  const downloadReports: string[] = [];
  await page.route('**/api/wallpapers', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) }),
  );
  await page.route('**/api/wallpapers/download', async (route) => {
    downloadReports.push((await route.request().postDataJSON()).photoId as string);
    await route.fulfill({ status: 202 });
  });
  return { downloadReports };
}

async function routeWallpaperImages(page: Page, delayMs = 0): Promise<void> {
  await page.route('https://images.unsplash.com/**', async (route) => {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    await route.fulfill({
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: wallpaperPng,
    });
  });
}

test('theme is correct on the first frame and persists through the same shell', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('wallpaper-enabled', 'false');
    const observer = new PerformanceObserver((entries, paintObserver) => {
      if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      paintObserver.disconnect();
      document.documentElement.dataset.firstPaintTheme =
        document.documentElement.dataset.theme ?? 'missing';
    });
    observer.observe({ type: 'paint', buffered: true });
  });

  await page.goto('/en/blog/');
  await expect(page.locator('html')).toHaveAttribute('data-first-paint-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  await page.locator('[data-site-shell]').evaluate((shell) => {
    shell.dataset.identityProbe = 'persistent';
  });

  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('theme'))).toBe('light');
  await page.getByRole('link', { name: 'About' }).click();

  await expect(page.locator('[data-site-shell]')).toHaveAttribute(
    'data-identity-probe',
    'persistent',
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'default');
});

test('the current scenic wallpaper owns every repeated hard-refresh first frame', async ({
  page,
}) => {
  await routeWallpaperApi(page);
  await routeWallpaperImages(page);
  const refreshImageRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).hostname === 'images.unsplash.com') {
      refreshImageRequests.push(request.url());
    }
  });
  await page.addInitScript(() => {
    const observer = new PerformanceObserver((entries, paintObserver) => {
      if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      paintObserver.disconnect();
      const root = document.documentElement;
      const boot = document.querySelector<HTMLElement>('[data-wallpaper-boot]');
      const bootImage = document.querySelector<HTMLElement>('.wallpaper__boot-image');
      const media = document.querySelector<HTMLElement>('[data-wallpaper-media]');
      const activeImage = document.querySelector<HTMLElement>('[data-wallpaper-image].is-active');
      const bootVisible =
        Boolean(boot && bootImage) &&
        Number(getComputedStyle(boot!).opacity) > 0 &&
        getComputedStyle(bootImage!).backgroundImage !== 'none';
      const mediaVisible =
        Boolean(media && activeImage) &&
        Number(getComputedStyle(media!).opacity) > 0 &&
        Number(getComputedStyle(activeImage!).opacity) > 0;
      root.dataset.wallpaperFirstPaintVisible = String(bootVisible || mediaVisible);
      root.dataset.wallpaperFirstPaintPhotoId = root.dataset.wallpaperPhotoId ?? 'missing';
    });
    observer.observe({ type: 'paint', buffered: true });
    document.addEventListener('transitionrun', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-backdrop-surface]')) return;
      const root = document.documentElement;
      root.dataset.wallpaperRefreshTransitionRuns = String(
        Number(root.dataset.wallpaperRefreshTransitionRuns ?? '0') + 1,
      );
    });
  });

  await page.goto('/en/blog/');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = sessionStorage.getItem('wallpaper-session-v2');
        if (!value) return undefined;
        const snapshot = JSON.parse(value) as {
          version?: number;
          photo?: { id?: string };
          bootImageDataUrl?: string;
        };
        return {
          version: snapshot.version,
          photoId: snapshot.photo?.id,
          hasBootImage: snapshot.bootImageDataUrl?.startsWith('data:image/png;base64,') ?? false,
        };
      }),
    )
    .toEqual({ version: 2, photoId: expect.any(String), hasBootImage: true });
  const savedPhotoId = await page.evaluate(() => {
    const snapshot = JSON.parse(sessionStorage.getItem('wallpaper-session-v2')!) as {
      photo: { id: string };
    };
    return snapshot.photo.id;
  });
  const stableRenderedImage = await page
    .locator('[data-wallpaper-image].is-active')
    .evaluate((frame) => getComputedStyle(frame).backgroundImage);
  expect(stableRenderedImage).toContain('data:image/png;base64,');
  refreshImageRequests.length = 0;

  for (let refresh = 0; refresh < 6; refresh += 1) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute(
      'data-wallpaper-first-paint-visible',
      'true',
    );
    await expect(page.locator('html')).toHaveAttribute(
      'data-wallpaper-first-paint-photo-id',
      savedPhotoId,
    );
    await expect(page.locator('html')).not.toHaveAttribute('data-wallpaper-compositor', 'ready');
    await expect(page.locator('[data-wallpaper-media]')).toHaveAttribute(
      'data-wallpaper-owner',
      'boot',
    );
    await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(0);
    expect(
      await page
        .locator('.wallpaper__boot-image')
        .evaluate((frame) => getComputedStyle(frame).backgroundImage),
    ).toBe(stableRenderedImage);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
        ),
    );
    expect(
      await page.evaluate(() =>
        Number(document.documentElement.dataset.wallpaperRefreshTransitionRuns ?? '0'),
      ),
    ).toBe(0);
  }
  expect(refreshImageRequests).toEqual([]);
});

test('a saved wallpaper attribution is complete and stable from the first warm-refresh frame', async ({
  page,
}) => {
  await routeWallpaperApi(page);
  await routeWallpaperImages(page);
  await page.addInitScript(
    ({ photo, url, bootImageDataUrl }) => {
      localStorage.setItem('wallpaper-enabled', 'true');
      localStorage.setItem('wallpaper-auto-rotation', 'false');
      sessionStorage.setItem(
        'wallpaper-session-v2',
        JSON.stringify({
          version: 2,
          photo,
          imageUrl: url,
          bootImageDataUrl,
          queueIds: ['photo-two'],
        }),
      );

      const frames: Array<{
        hidden: boolean;
        visibility: string;
        text: string;
        photoId: string;
        photographerHref: string;
        photoHref: string;
        left: number;
        top: number;
        width: number;
        height: number;
      }> = [];
      Object.defineProperty(window, '__wallpaperCreditFrames', {
        configurable: true,
        value: frames,
      });
      let attempts = 0;
      const sample = () => {
        attempts += 1;
        const credit = document.querySelector<HTMLElement>('[data-wallpaper-credit]');
        const photographer = credit?.querySelector<HTMLAnchorElement>(
          '[data-wallpaper-credit-photographer]',
        );
        const source = credit?.querySelector<HTMLAnchorElement>('[data-wallpaper-credit-photo]');
        const frameReady = document.querySelector('[data-initial-frame-document-ready]');
        if (credit && photographer && source && frameReady) {
          const box = credit.getBoundingClientRect();
          frames.push({
            hidden: credit.hidden !== false,
            visibility: getComputedStyle(credit).visibility,
            text: credit.innerText,
            photoId: credit.dataset.wallpaperPhotoId ?? '',
            photographerHref: photographer.href,
            photoHref: source.href,
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
          });
        }
        if (frames.length < 12 && attempts < 120) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    },
    { photo: photoOne, url: imageUrl(photoOne.rawUrl), bootImageDataUrl: wallpaperDataUrl },
  );

  await page.goto('/zh/blog/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __wallpaperCreditFrames?: unknown[];
            }
          ).__wallpaperCreditFrames?.length ?? 0,
      ),
    )
    .toBeGreaterThanOrEqual(8);

  const frames = await page.evaluate(
    () =>
      (
        window as Window & {
          __wallpaperCreditFrames?: Array<{
            hidden: boolean;
            visibility: string;
            text: string;
            photoId: string;
            photographerHref: string;
            photoHref: string;
            left: number;
            top: number;
            width: number;
            height: number;
          }>;
        }
      ).__wallpaperCreditFrames ?? [],
  );
  expect(frames.length).toBeGreaterThanOrEqual(8);
  expect(
    frames.every(
      (frame) =>
        !frame.hidden &&
        frame.visibility === 'visible' &&
        frame.text === '摄影： First Photographer 来源： Unsplash' &&
        frame.photoId === photoOne.id &&
        frame.photographerHref === photoOne.photographerUrl &&
        frame.photoHref === photoOne.photoUrl,
    ),
    JSON.stringify(frames, null, 2),
  ).toBe(true);
  const first = frames[0]!;
  expect(
    frames.every(
      (frame) =>
        Math.abs(frame.left - first.left) < 0.25 &&
        Math.abs(frame.top - first.top) < 0.25 &&
        Math.abs(frame.width - first.width) < 0.25 &&
        Math.abs(frame.height - first.height) < 0.25,
    ),
    JSON.stringify(frames, null, 2),
  ).toBe(true);
});

test('a slow saved photo never blocks readable content and then fades once', async ({ page }) => {
  await routeWallpaperApi(page);
  await routeWallpaperImages(page, 2_200);
  await page.addInitScript(
    ({ photo, url }) => {
      sessionStorage.setItem(
        'wallpaper-session-v1',
        JSON.stringify({ version: 1, photo, imageUrl: url, queueIds: ['photo-two'] }),
      );
      const observer = new PerformanceObserver((entries, paintObserver) => {
        if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
        paintObserver.disconnect();
        document.documentElement.dataset.firstPaintWallpaperState =
          document.documentElement.dataset.wallpaperInitial ?? 'missing';
        document.documentElement.dataset.firstPaintActiveLayers = String(
          document.querySelectorAll('[data-wallpaper-image].is-active').length,
        );
        document.documentElement.dataset.firstPaintBodyVisibility = getComputedStyle(
          document.body,
        ).visibility;
        document.documentElement.dataset.firstPaintAt = String(
          entries.getEntries().find((entry) => entry.name === 'first-contentful-paint')
            ?.startTime ?? -1,
        );
      });
      observer.observe({ type: 'paint', buffered: true });
      document.addEventListener('transitionrun', (event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest('[data-backdrop-surface]')) return;
        const root = document.documentElement;
        root.dataset.lateWallpaperTransitions = String(
          Number(root.dataset.lateWallpaperTransitions ?? '0') + 1,
        );
      });
    },
    { photo: photoOne, url: imageUrl(photoOne.rawUrl) },
  );

  await page.goto('/en/blog/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute(
    'data-first-paint-wallpaper-state',
    'deferred',
  );
  await expect(page.locator('html')).toHaveAttribute('data-first-paint-active-layers', '0');
  await expect(page.locator('html')).toHaveAttribute('data-first-paint-body-visibility', 'visible');
  expect(await page.locator('html').getAttribute('data-first-paint-at').then(Number)).toBeLessThan(
    1_800,
  );
  await expect(page.locator('main')).toBeVisible();

  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-compositor', 'ready', {
    timeout: 5_000,
  });
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => Number(document.documentElement.dataset.lateWallpaperTransitions ?? '0')),
    )
    .toBeGreaterThan(0);
});

test('manual next remains browsing; only an explicit file download is reported', async ({
  page,
}) => {
  const { downloadReports } = await routeWallpaperApi(page);
  await routeWallpaperImages(page);
  await page.addInitScript(
    ({ photo, url }) => {
      sessionStorage.setItem(
        'wallpaper-session-v1',
        JSON.stringify({ version: 1, photo, imageUrl: url, queueIds: ['photo-two'] }),
      );
    },
    { photo: photoOne, url: imageUrl(photoOne.rawUrl) },
  );

  await page.goto('/en/blog/');
  await page.getByRole('button', { name: 'Wallpaper settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Wallpaper settings' });
  await settings.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  expect(downloadReports).toEqual([]);

  const download = page.waitForEvent('download');
  await settings.getByRole('button', { name: 'Download' }).click();
  await download;
  await expect.poll(() => downloadReports).toEqual(['photo-two']);
});

test('a pending next-photo request keeps its trigger stable and coalesces repeated clicks', async ({
  page,
}) => {
  await routeWallpaperApi(page);
  let releaseImage!: () => void;
  const imageGate = new Promise<void>((resolve) => {
    releaseImage = resolve;
  });
  let pendingImageRequests = 0;
  await page.route('https://images.unsplash.com/**', async (route) => {
    pendingImageRequests += 1;
    await imageGate;
    await route.fulfill({
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: wallpaperPng,
    });
  });
  await page.addInitScript(
    ({ photo, url, bootImageDataUrl }) => {
      localStorage.setItem('wallpaper-enabled', 'true');
      localStorage.setItem('wallpaper-auto-rotation', 'false');
      sessionStorage.setItem(
        'wallpaper-session-v2',
        JSON.stringify({
          version: 2,
          photo,
          imageUrl: url,
          bootImageDataUrl,
          queueIds: ['photo-two'],
        }),
      );
    },
    { photo: photoOne, url: imageUrl(photoOne.rawUrl), bootImageDataUrl: wallpaperDataUrl },
  );

  await page.goto('/en/blog/');
  await page.getByRole('button', { name: 'Wallpaper settings' }).click();
  const refresh = page.getByRole('dialog', { name: 'Wallpaper settings' }).getByRole('button', {
    name: 'Refresh',
  });
  const initialBox = await refresh.boundingBox();
  const initialOpacity = await refresh.evaluate((button) => getComputedStyle(button).opacity);

  await refresh.click();
  await expect.poll(() => pendingImageRequests).toBe(1);
  await expect(refresh).toHaveAttribute('aria-busy', 'true');
  await expect(refresh).toBeEnabled();
  await expect(refresh).toHaveCSS('cursor', 'pointer');
  await expect(refresh).toHaveCSS('opacity', initialOpacity);
  expect(await refresh.boundingBox()).toEqual(initialBox);
  await expect(refresh.locator('svg')).toHaveCSS('animation-name', 'wallpaper-next-spin');

  await refresh.click();
  await refresh.click();
  await expect.poll(() => pendingImageRequests).toBe(1);
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');

  releaseImage();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  await expect(refresh).toHaveAttribute('aria-busy', 'false');
  await expect(refresh).toBeEnabled();
});

test('a failed next-photo snapshot restores the current photo and its control', async ({
  page,
}) => {
  await routeWallpaperApi(page);
  await routeWallpaperImages(page);
  await page.addInitScript(
    ({ photo, url, bootImageDataUrl }) => {
      sessionStorage.setItem(
        'wallpaper-session-v2',
        JSON.stringify({
          version: 2,
          photo,
          imageUrl: url,
          bootImageDataUrl,
          queueIds: ['photo-two'],
        }),
      );
      const NativeFileReader = window.FileReader;
      class FailingFileReader extends NativeFileReader {
        override readAsDataURL(): void {
          throw new DOMException('Simulated snapshot failure', 'InvalidStateError');
        }
      }
      Object.defineProperty(window, 'FileReader', {
        configurable: true,
        value: FailingFileReader,
      });
    },
    { photo: photoOne, url: imageUrl(photoOne.rawUrl), bootImageDataUrl: wallpaperDataUrl },
  );

  await page.goto('/en/blog/');
  await page.getByRole('button', { name: 'Wallpaper settings' }).click();
  const refresh = page.getByRole('dialog', { name: 'Wallpaper settings' }).getByRole('button', {
    name: 'Refresh',
  });
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-boot-photo-id', 'photo-one');
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(0);
  await expect(page.locator('[data-wallpaper-boot]')).toHaveCSS('opacity', '1');
});

test('theme and wallpaper controls keep all four visual modes independent', async ({ page }) => {
  let manifestRequests = 0;
  let imageRequests = 0;
  await page.route('**/api/wallpapers', (route) => {
    manifestRequests += 1;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) });
  });
  await page.route('https://images.unsplash.com/**', (route) => {
    imageRequests += 1;
    return route.fulfill({
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: wallpaperPng,
    });
  });
  await page.addInitScript(
    ({ photo, url }) => {
      localStorage.setItem('theme', 'light');
      localStorage.setItem('wallpaper-enabled', 'true');
      localStorage.setItem('wallpaper-auto-rotation', 'false');
      sessionStorage.setItem(
        'wallpaper-session-v1',
        JSON.stringify({ version: 1, photo, imageUrl: url, queueIds: ['photo-two'] }),
      );
    },
    { photo: photoOne, url: imageUrl(photoOne.rawUrl) },
  );

  await page.goto('/en/blog/');
  const root = page.locator('html');
  const activeImage = page.locator('[data-wallpaper-image].is-active');
  const theme = page.getByRole('button', { name: 'Switch to dark mode' });
  const trigger = page.getByRole('button', { name: 'Wallpaper settings' });
  const settings = page.getByRole('dialog', { name: 'Wallpaper settings' });
  const enabled = settings.getByRole('checkbox', { name: 'Use random landscape wallpapers' });
  const autoRotation = settings.getByRole('checkbox', { name: 'Rotate automatically' });

  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).toHaveAttribute('data-wallpaper-mode', 'scenic');
  expect(await textPalette(page)).toEqual({
    strong: 'rgb(9, 13, 20)',
    default: 'rgb(11, 16, 23)',
    supporting: 'rgb(17, 23, 32)',
    disabled: 'rgb(100, 116, 139)',
    accent: 'rgb(91, 78, 114)',
    accentHover: 'rgb(68, 56, 87)',
    onAccent: 'rgb(248, 250, 252)',
  });
  const credit = page.locator('[data-wallpaper-credit]');
  await expect(credit).toBeVisible();
  await expect(credit).toHaveCSS('color', 'rgb(100, 116, 139)');
  await expect(credit.locator('a').first()).toHaveCSS('font-weight', '400');
  await expect(activeImage).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scrim = document.querySelector<HTMLElement>('.wallpaper__scrim');
        return scrim
          ? {
              light: getComputedStyle(scrim, '::before').opacity,
              dark: getComputedStyle(scrim, '::after').opacity,
            }
          : undefined;
      }),
    )
    .toEqual({ light: '1', dark: '0' });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = sessionStorage.getItem('wallpaper-session-v2');
        return value ? Boolean(JSON.parse(value).bootImageDataUrl) : false;
      }),
    )
    .toBe(true);
  const settledManifestRequests = manifestRequests;
  const settledImageRequests = imageRequests;

  await theme.click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => root.getAttribute('data-theme-transition')).toBeNull();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scrim = document.querySelector<HTMLElement>('.wallpaper__scrim');
        return scrim
          ? {
              light: getComputedStyle(scrim, '::before').opacity,
              dark: getComputedStyle(scrim, '::after').opacity,
            }
          : undefined;
      }),
    )
    .toEqual({ light: '0', dark: '1' });
  await expect(root).toHaveAttribute('data-wallpaper-mode', 'scenic');
  expect(await textPalette(page)).toEqual({
    strong: 'rgb(238, 242, 246)',
    default: 'rgb(229, 234, 240)',
    supporting: 'rgb(214, 221, 230)',
    disabled: 'rgb(139, 152, 170)',
    accent: 'rgb(185, 172, 200)',
    accentHover: 'rgb(208, 197, 220)',
    onAccent: 'rgb(9, 19, 26)',
  });
  await expect(activeImage).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');

  await trigger.click();
  await settings.getByText('Use random landscape wallpapers', { exact: true }).click();
  await expect(enabled).not.toBeChecked();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveAttribute('data-wallpaper-mode', 'default');
  expect(await textPalette(page)).toEqual({
    strong: 'rgb(241, 245, 249)',
    default: 'rgb(183, 192, 207)',
    supporting: 'rgb(152, 162, 179)',
    disabled: 'rgb(69, 85, 108)',
    accent: 'rgb(103, 232, 249)',
    accentHover: 'rgb(83, 234, 253)',
    onAccent: 'rgb(2, 6, 23)',
  });
  await expect(activeImage).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
  await expect(page.locator('[data-wallpaper-credit]')).toBeHidden();
  await expect(autoRotation).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wallpaper-enabled')))
    .toBe('false');

  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).toHaveAttribute('data-wallpaper-mode', 'default');
  await expect.poll(() => root.getAttribute('data-theme-transition')).toBeNull();
  expect(await textPalette(page)).toEqual({
    strong: 'rgb(9, 13, 20)',
    default: 'rgb(11, 16, 23)',
    supporting: 'rgb(17, 23, 32)',
    disabled: 'rgb(100, 116, 139)',
    accent: 'rgb(91, 78, 114)',
    accentHover: 'rgb(68, 56, 87)',
    onAccent: 'rgb(248, 250, 252)',
  });

  await trigger.click();
  await settings.getByText('Use random landscape wallpapers', { exact: true }).click();
  await expect(enabled).toBeChecked();
  await expect(root).toHaveAttribute('data-wallpaper-mode', 'scenic');
  await expect(activeImage).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
  await expect(page.locator('[data-wallpaper-credit]')).toBeVisible();
  await expect(autoRotation).toBeEnabled();
  await settings.getByText('Rotate automatically', { exact: true }).click();
  await expect(autoRotation).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wallpaper-auto-rotation')))
    .toBe('true');

  await page.locator('[data-wallpaper-media]').evaluate((media) => {
    media.dataset.identityProbe = 'persistent';
  });
  await page.getByRole('link', { name: 'About' }).click();
  await expect(page.locator('[data-wallpaper-media]')).toHaveAttribute(
    'data-identity-probe',
    'persistent',
  );
  await expect(activeImage).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
  expect(manifestRequests).toBe(settledManifestRequests);
  expect(imageRequests).toBe(settledImageRequests);
});

test('damaged preferences and failed decorative resources recover without blocking content', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  let manifestRequests = 0;
  await page.route('**/api/wallpapers', (route) => {
    manifestRequests += 1;
    if (manifestRequests === 1) return route.fulfill({ status: 503 });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) });
  });
  await page.route('https://images.unsplash.com/**', (route) => {
    if (route.request().url().includes('photo-one')) return route.abort('failed');
    return route.fulfill({
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: wallpaperPng,
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'damaged');
    localStorage.setItem('wallpaper-enabled', 'true');
    localStorage.setItem('wallpaper-auto-rotation', 'false');
    sessionStorage.setItem('wallpaper-session-v1', '{damaged');
    Math.random = () => 0.999;
  });

  await page.goto('/en/blog/');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(0);
  expect(manifestRequests).toBe(1);

  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveAttribute(
    'data-wallpaper-photo-id',
    'photo-two',
  );
  await expect(page.locator('[data-wallpaper-credit]')).toContainText('Second Photographer');
  expect(manifestRequests).toBe(2);
});

test('disabling wallpaper during a pending image leaves the controller recoverable', async ({
  page,
}) => {
  await routeWallpaperApi(page);
  let releaseImage: (() => void) | undefined;
  const imageGate = new Promise<void>((resolve) => {
    releaseImage = resolve;
  });
  let imageRequests = 0;
  await page.route('https://images.unsplash.com/**', async (route) => {
    imageRequests += 1;
    await imageGate;
    await route.fulfill({
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: wallpaperPng,
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem('wallpaper-enabled', 'true');
    localStorage.setItem('wallpaper-auto-rotation', 'false');
    Math.random = () => 0.999;
  });

  await page.goto('/en/blog/');
  await expect.poll(() => imageRequests).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Wallpaper settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Wallpaper settings' });
  await settings.getByText('Use random landscape wallpapers', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'default');

  releaseImage?.();
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Refresh' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wallpaper-enabled')))
    .toBe('false');

  await settings.getByText('Use random landscape wallpapers', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'scenic');
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(1);
  await expect(page.locator('[data-wallpaper-credit]')).toBeVisible();
});

test('reduced motion suppresses theme animation and automatic wallpaper timers', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await routeWallpaperApi(page);
  await routeWallpaperImages(page);
  await page.addInitScript(
    ({ photo, url }) => {
      const recordedTimeouts: number[] = [];
      const nativeSetTimeout = window.setTimeout.bind(window);
      window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (typeof timeout === 'number') recordedTimeouts.push(timeout);
        return nativeSetTimeout(handler, timeout, ...args);
      }) as typeof window.setTimeout;
      Object.defineProperty(window, '__wallpaperTestTimeouts', {
        value: recordedTimeouts,
        configurable: true,
      });
      localStorage.setItem('wallpaper-enabled', 'true');
      localStorage.setItem('wallpaper-auto-rotation', 'true');
      sessionStorage.setItem(
        'wallpaper-session-v1',
        JSON.stringify({ version: 1, photo, imageUrl: url, queueIds: ['photo-two'] }),
      );
    },
    { photo: photoOne, url: imageUrl(photoOne.rawUrl) },
  );

  await page.goto('/en/blog/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('[data-wallpaper-image].is-active')).toHaveCount(1);
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).not.toHaveClass(/theme-transitioning/);
  await expect(page.locator('html')).not.toHaveAttribute('data-theme-transition');
  expect(
    await page.evaluate(() =>
      (
        (window as Window & { __wallpaperTestTimeouts?: number[] }).__wallpaperTestTimeouts ?? []
      ).filter((delay) => delay >= 5 * 60 * 1000 && delay <= 9 * 60 * 1000),
    ),
  ).toEqual([]);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          (window as Window & { __wallpaperTestTimeouts?: number[] }).__wallpaperTestTimeouts ?? []
        ).some((delay) => delay >= 5 * 60 * 1000 && delay <= 9 * 60 * 1000),
      ),
    )
    .toBe(true);
});

test('without JavaScript, appearance enhancement stays absent and the document remains readable', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/en/blog/');

  await expect(page.locator('main')).toBeVisible();
  const appearanceControls = page.locator('[data-appearance-controls]');
  await expect(appearanceControls).toHaveCount(2);
  await expect(appearanceControls.first()).toBeHidden();
  await expect(appearanceControls.last()).toBeHidden();
  await expect(page.locator('[data-wallpaper-credit]')).toBeHidden();
  await expect
    .poll(() =>
      page
        .locator('[data-wallpaper-image]')
        .evaluateAll((images) => images.every((image) => !image.hasAttribute('src'))),
    )
    .toBe(true);

  await context.close();
});
