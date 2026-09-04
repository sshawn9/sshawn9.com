import { expect, test, type Page } from '@playwright/test';

const photos = [
  {
    id: 'photo-one',
    createdAt: '2026-08-28T00:00:00.000Z',
    blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    rawUrl: 'https://images.unsplash.com/photo-one?ixid=one',
    photographerName: 'First Photographer',
    photographerUrl: 'https://unsplash.com/@first?utm_source=sshawn9.com',
    photoUrl: 'https://unsplash.com/photos/photo-one?utm_source=sshawn9.com',
  },
  {
    id: 'photo-two',
    createdAt: '2026-08-29T00:00:00.000Z',
    blurHash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    rawUrl: 'https://images.unsplash.com/photo-two?ixid=two',
    photographerName: 'Second Photographer',
    photographerUrl: 'https://unsplash.com/@second?utm_source=sshawn9.com',
    photoUrl: 'https://unsplash.com/photos/photo-two?utm_source=sshawn9.com',
  },
] as const;

const manifest = {
  version: 2,
  updatedAt: '2026-08-29T00:00:00.000Z',
  photos,
};

const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWMISq8iCTGMakgfDKEEALF9rLGZ8m0AAAAAAElFTkSuQmCC',
  'base64',
);
const dataUrl = `data:image/png;base64,${image.toString('base64')}`;

function imageUrl(rawUrl: string, width: number): string {
  const url = new URL(rawUrl);
  url.searchParams.set('auto', 'format');
  url.searchParams.set('fit', 'max');
  url.searchParams.set('q', '80');
  url.searchParams.set('w', String(width));
  return url.toString();
}

function policyKey(width: number): string {
  return `v1-w${width}-q80-auto`;
}

async function routeWallpaperResources(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route('**/api/wallpapers', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) }),
  );
  await page.route('https://images.unsplash.com/**', (route) => {
    requests.push(route.request().url());
    return route.fulfill({
      contentType: 'image/png',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: image,
    });
  });
  return requests;
}

async function seedTwoSlots(page: Page, width: number, enabled = true): Promise<void> {
  await page.addInitScript(
    ({ photos, dataUrl, width, enabled }) => {
      if (sessionStorage.getItem('__wallpaper-test-seeded')) return;
      sessionStorage.setItem('__wallpaper-test-seeded', 'true');
      localStorage.setItem('wallpaper-enabled', String(enabled));
      localStorage.setItem('wallpaper-auto-rotation', 'false');
      const policyKey = `v1-w${width}-q80-auto`;
      const url = (rawUrl: string) => {
        const value = new URL(rawUrl);
        value.searchParams.set('auto', 'format');
        value.searchParams.set('fit', 'max');
        value.searchParams.set('q', '80');
        value.searchParams.set('w', String(width));
        return value.toString();
      };
      sessionStorage.setItem(
        'wallpaper-tab-state-v3',
        JSON.stringify({ version: 3, currentSlot: 'a', queueIds: [] }),
      );
      for (const [slot, photo] of [
        ['a', photos[0]],
        ['b', photos[1]],
      ] as const) {
        sessionStorage.setItem(
          `wallpaper-slot-${slot}-meta-v3`,
          JSON.stringify({
            version: 1,
            photo,
            policyKey,
            imageUrl: url(photo.rawUrl),
            byteSize: 128,
          }),
        );
        sessionStorage.setItem(`wallpaper-slot-${slot}-data-v3`, dataUrl);
      }
    },
    { photos, dataUrl, width, enabled },
  );
}

test('a saved photo and attribution own every warm-refresh first frame without replay', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const imageRequests = await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await page.addInitScript(() => {
    document.addEventListener('transitionrun', (event) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('[data-backdrop-surface]')) return;
      document.documentElement.dataset.wallpaperTransitionRuns = String(
        Number(document.documentElement.dataset.wallpaperTransitionRuns ?? '0') + 1,
      );
    });
    const observer = new PerformanceObserver((entries, self) => {
      if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      self.disconnect();
      const root = document.documentElement;
      const active = document.querySelector<HTMLElement>(
        '.wallpaper__image[data-wallpaper-slot="a"]',
      );
      const credit = document.querySelector<HTMLElement>('[data-wallpaper-credit]');
      root.dataset.wallpaperFirstPaint = JSON.stringify({
        id: root.dataset.wallpaperPhotoId,
        image: active ? getComputedStyle(active).backgroundImage !== 'none' : false,
        credit: credit?.textContent?.includes('First Photographer') ?? false,
      });
    });
    observer.observe({ type: 'paint', buffered: true });
  });

  await page.goto('/en/blog/');
  imageRequests.length = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
    await expect(page.locator('html')).toHaveAttribute(
      'data-wallpaper-first-paint',
      JSON.stringify({ id: 'photo-one', image: true, credit: true }),
    );
    expect(
      await page.evaluate(() =>
        Number(document.documentElement.dataset.wallpaperTransitionRuns ?? '0'),
      ),
    ).toBe(0);
  }
  expect(imageRequests).toEqual([]);
});

test('each tab prepares exactly current and next even while scenic mode is off', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await page.addInitScript(() => {
    localStorage.setItem('wallpaper-enabled', 'false');
    localStorage.setItem('wallpaper-auto-rotation', 'false');
  });
  await page.goto('/en/blog/');

  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(sessionStorage.getItem('wallpaper-tab-state-v3') ?? '{}') as {
          currentSlot?: 'a' | 'b';
        };
        if (!state.currentSlot) return undefined;
        const nextSlot = state.currentSlot === 'a' ? 'b' : 'a';
        return {
          currentData: sessionStorage.getItem(`wallpaper-slot-${state.currentSlot}-data-v3`),
          nextData: sessionStorage.getItem(`wallpaper-slot-${nextSlot}-data-v3`),
        };
      }),
    )
    .toEqual({ currentData: dataUrl, nextData: dataUrl });

  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-mode', 'default');
  await expect(page.locator('.wallpaper__stage')).toHaveCSS('opacity', '0');
  expect(
    await page.evaluate(() =>
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith('wallpaper-slot-'))
        .sort(),
    ),
  ).toEqual([
    'wallpaper-slot-a-data-v3',
    'wallpaper-slot-a-meta-v3',
    'wallpaper-slot-b-data-v3',
    'wallpaper-slot-b-meta-v3',
  ]);
});

test('a new document policy replaces only next and leaves the visible current untouched', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 700 });
  const requests = await routeWallpaperResources(page);
  await seedTwoSlots(page, 960);
  await page.goto('/en/blog/');
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');

  requests.length = 0;
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const current = JSON.parse(sessionStorage.getItem('wallpaper-slot-a-meta-v3') ?? '{}') as {
          policyKey?: string;
        };
        const next = JSON.parse(sessionStorage.getItem('wallpaper-slot-b-meta-v3') ?? '{}') as {
          policyKey?: string;
        };
        return { current: current.policyKey, next: next.policyKey };
      }),
    )
    .toEqual({ current: policyKey(960), next: policyKey(2400) });
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
  expect(requests).toContain(imageUrl(photos[1].rawUrl, 2400));
  expect(requests.some((request) => request.includes('photo-one'))).toBe(false);
});

test('manual advance keeps its control busy and disabled through the complete transition', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  await page.goto('/en/blog/');
  await page.locator('[data-wallpaper-menu-trigger]').click();
  const next = page.locator('#wallpaper-settings [data-wallpaper-next]');
  await expect(next).toBeEnabled();

  await next.click();
  await expect(next).toHaveAttribute('aria-busy', 'true');
  await expect(next).toBeDisabled();

  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-two');
  await expect(next).toHaveAttribute('aria-busy', 'false');
  await expect(next).toBeEnabled();
  expect(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem('wallpaper-tab-state-v3') ?? '{}').currentSlot,
    ),
  ).toBe('b');
});
