import { expect, test, type Locator, type Page } from '@playwright/test';
import type PhotoSwipe from 'photoswipe';

const mediaArticlePath = '/en/blog/self-hosting-tools-and-services/';
const photoSwipeStylesheet = /\/photoswipe\.[^/]+\.css(?:\?|$)/;
const photoSwipeCore = /\/photoswipe\.esm\.[^/]+\.js(?:\?|$)/;

async function expectOriginalImagePopup(page: Page, attachment: Locator) {
  const originalUrl = await attachment.evaluate((element) => (element as HTMLAnchorElement).href);
  const articleUrl = page.url();
  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 5000 }),
    attachment.click(),
  ]);
  try {
    await expect(popup).toHaveURL(originalUrl);
    await expect(popup.locator('img')).toBeVisible();
    await expect(page).toHaveURL(articleUrl);
    await expect(page.locator('.pswp')).toHaveCount(0);
  } finally {
    await popup.close();
  }
}

async function viewportGeometry(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.site-header__inner');
    const box = header?.getBoundingClientRect();
    return { left: box?.left ?? -1, width: box?.width ?? -1, scrollY };
  });
}

test('explicit image attachments open a keyboard-dismissible viewer', async ({ page }) => {
  const imageRequests = new Set<string>();
  page.on('request', (request) => {
    if (request.resourceType() === 'image') imageRequests.add(request.url());
  });
  await page.goto(mediaArticlePath);
  const attachment = page.locator('a[data-article-media-item]').first();
  await expect(page.locator('.article-prose')).toHaveAttribute(
    'data-article-media-runtime',
    'ready',
  );
  await attachment.scrollIntoViewIfNeeded();
  const image = attachment.locator('img');
  await expect
    .poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  const resources = await attachment.evaluate((element) => {
    const preview = element.querySelector('img');
    if (!(preview instanceof HTMLImageElement)) throw new Error('Missing attachment preview.');
    return {
      preview: preview.currentSrc,
      full: (element as HTMLAnchorElement).href,
      previewWidth: preview.naturalWidth,
      fullWidth: Number((element as HTMLElement).dataset.pswpWidth),
    };
  });
  expect(resources.preview).not.toBe(resources.full);
  expect(resources.previewWidth).toBeLessThan(resources.fullWidth);
  expect(imageRequests).toContain(resources.preview);
  expect(imageRequests).not.toContain(resources.full);

  const fullRequest = page.waitForRequest((request) => request.url() === resources.full);
  await attachment.click();
  await fullRequest;
  await expect(page.locator('.pswp')).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('.pswp__img:not(.pswp__img--placeholder)')
        .evaluate((element) => (element as HTMLImageElement).currentSrc),
    )
    .toBe(resources.full);
  await expect(page.locator('.article-prose')).toHaveAttribute('data-article-media-viewer', 'open');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pswp')).toBeHidden();
  await expect(attachment).toBeFocused();
});

test('opening the image viewer preserves shell geometry and page scroll', async ({ page }) => {
  await page.goto('/en/blog/self-hosting-tools-and-services/');
  await expect(page.locator('.article-prose')).toHaveAttribute(
    'data-article-media-runtime',
    'ready',
  );
  const item = page.locator('a[data-article-media-item]').first();
  await item.scrollIntoViewIfNeeded();
  const before = await viewportGeometry(page);
  await item.click();
  await expect(page.locator('.pswp')).toBeVisible();
  await expect(page.locator('.article-prose')).toHaveAttribute('data-article-media-viewer', 'open');
  const after = await viewportGeometry(page);
  expect(after.left).toBeCloseTo(before.left, 1);
  expect(after.width).toBeCloseTo(before.width, 1);
  expect(after.scrollY).toBeCloseTo(before.scrollY, 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.pswp')).toBeHidden();
  await expect(page.locator('.article-prose')).not.toHaveAttribute(
    'data-article-media-viewer',
    /.+/,
  );
  const restored = await viewportGeometry(page);
  expect(restored.left).toBeCloseTo(before.left, 1);
  expect(restored.width).toBeCloseTo(before.width, 1);
  expect(restored.scrollY).toBeCloseTo(before.scrollY, 1);
  await expect(item).toBeFocused();
});

test('media enhancement retries its stylesheet after a failed client entry', async ({ page }) => {
  let stylesheetRequests = 0;
  await page.route(photoSwipeStylesheet, async (route) => {
    stylesheetRequests += 1;
    if (stylesheetRequests === 1) await route.abort();
    else await route.continue();
  });

  await page.goto(mediaArticlePath);
  await expect(page.locator('.article-prose')).toHaveAttribute(
    'data-article-media-runtime',
    'fallback',
  );
  await expectOriginalImagePopup(page, page.locator('a[data-article-media-item]').first());

  await page.locator('.site-header__nav-link[href="/en/blog/"]').click();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await page
    .locator(`a[href="${mediaArticlePath}"]`)
    .first()
    .evaluate((element) => (element as HTMLAnchorElement).click());
  await expect(page).toHaveURL(new RegExp(`${mediaArticlePath.replaceAll('/', '\\/')}$`));
  await expect(page.locator('.article-prose')).toHaveAttribute(
    'data-article-media-runtime',
    'ready',
  );
  expect(stylesheetRequests).toBe(2);
  await expect(page.locator('link[data-article-media-stylesheet]')).toHaveCount(1);
});

test('a successful stylesheet is reacquired after leaving and returning to the article', async ({
  page,
}) => {
  let stylesheetRequests = 0;
  page.on('request', (request) => {
    if (photoSwipeStylesheet.test(request.url())) stylesheetRequests += 1;
  });

  await page.goto(mediaArticlePath);
  await expect(page.locator('.article-prose')).toHaveAttribute(
    'data-article-media-runtime',
    'ready',
  );
  expect(stylesheetRequests).toBe(1);

  await page.locator('.site-header__nav-link[href="/en/blog/"]').click();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect(page.locator('link[data-article-media-stylesheet]')).toHaveCount(0);
  await page
    .locator(`a[href="${mediaArticlePath}"]`)
    .first()
    .evaluate((element) => (element as HTMLAnchorElement).click());
  await expect(page).toHaveURL(/\/en\/blog\/self-hosting-tools-and-services\/$/);
  await expect(page.locator('.article-prose')).toHaveAttribute(
    'data-article-media-runtime',
    'ready',
  );
  expect(stylesheetRequests).toBe(2);

  const stylesheet = page.locator('link[data-article-media-stylesheet]');
  await expect(stylesheet).toHaveCount(1);
  await expect
    .poll(() => stylesheet.evaluate((element) => Boolean((element as HTMLLinkElement).sheet)))
    .toBe(true);
  const item = page.locator('a[data-article-media-item]').first();
  await item.click();
  await expect(page.locator('.pswp')).toBeVisible();
  await expect(page.locator('.article-prose')).toHaveAttribute('data-article-media-viewer', 'open');
  await expect(page.locator('.pswp')).toHaveCSS('position', 'fixed');
  await page.keyboard.press('Escape');
  await expect(page.locator('.pswp')).toBeHidden();
});

test('a failed PhotoSwipe core preserves the real original-image popup', async ({ page }) => {
  let coreRequests = 0;
  await page.route(photoSwipeCore, async (route) => {
    coreRequests += 1;
    await route.abort();
  });
  await page.goto(mediaArticlePath);
  await expect(page.locator('.article-prose')).toHaveAttribute(
    'data-article-media-runtime',
    /ready|fallback/,
  );
  await expectOriginalImagePopup(page, page.locator('a[data-article-media-item]').first());
  expect(coreRequests).toBeGreaterThan(0);
  await expect(page.locator('.article-prose')).toHaveAttribute(
    'data-article-media-runtime',
    'fallback',
  );
});

test('an attachment opens its original image while core preparation is pending', async ({
  page,
}) => {
  let releaseCore = () => {};
  const coreGate = new Promise<void>((resolve) => {
    releaseCore = resolve;
  });
  let coreRequests = 0;
  await page.route(photoSwipeCore, async (route) => {
    coreRequests += 1;
    await coreGate;
    await route.continue().catch(() => undefined);
  });
  try {
    // The gated module may delay load; DOMContentLoaded is sufficient to click
    // the real anchor while enhancement is still preparing.
    await page.goto(mediaArticlePath, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => coreRequests).toBeGreaterThan(0);
    await expect(page.locator('.article-prose')).toHaveAttribute(
      'data-article-media-runtime',
      'loading',
    );
    const attachment = page.locator('a[data-article-media-item]').first();
    await expectOriginalImagePopup(page, attachment);
    releaseCore();
    await expect(page.locator('.article-prose')).toHaveAttribute(
      'data-article-media-runtime',
      'ready',
    );
    await attachment.click();
    await expect(page.locator('.pswp')).toBeVisible();
    await expect(page.locator('.article-prose')).toHaveAttribute(
      'data-article-media-viewer',
      'open',
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('.pswp')).toHaveCount(0);
  } finally {
    releaseCore();
  }
});

test('the first image click stays open after a TOC intent cancels pending navigation', async ({
  page,
}) => {
  let releaseAbout = () => {};
  const aboutGate = new Promise<void>((resolve) => {
    releaseAbout = resolve;
  });
  let aboutRequests = 0;
  await page.route('**/en/about/', async (route) => {
    if (route.request().resourceType() === 'fetch') {
      aboutRequests += 1;
      await aboutGate;
    }
    await route.continue().catch(() => undefined);
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(mediaArticlePath);
    await expect(page.locator('.article-prose')).toHaveAttribute(
      'data-article-media-runtime',
      'ready',
    );
    const about = page.locator('.site-header__nav-link[href="/en/about/"]');
    await about.evaluate((element) => {
      (element as HTMLElement).dataset.astroPrefetch = 'false';
    });
    await about.click();
    await expect.poll(() => aboutRequests).toBeGreaterThan(0);
    await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
    const tocLink = page.locator('#article-sidebar a[data-toc-slug]').first();
    const slug = await tocLink.getAttribute('data-toc-slug');
    expect(slug).toBeTruthy();
    await tocLink.click();
    await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending');
    await expect
      .poll(() => page.evaluate(() => decodeURIComponent(location.hash.slice(1))))
      .toBe(slug);
    releaseAbout();

    const attachment = page.locator('a[data-article-media-item]').first();
    await attachment.click();
    // The open marker is set after openingAnimationEnd: seeing only .pswp
    // during its animation would miss the old closeRequested regression.
    await expect(page.locator('.article-prose')).toHaveAttribute(
      'data-article-media-viewer',
      'open',
    );
    await expect(page.locator('.pswp')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(mediaArticlePath);
    await page.keyboard.press('Escape');
    await expect(page.locator('.pswp')).toHaveCount(0);
    await expect(attachment).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    releaseAbout();
  }
});

test('leaving during keyboard opening destroys the old viewer without stealing new-page focus', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Warm the destination document's assets, so the navigation can swap during
  // the deliberately extended, real PhotoSwipe opening animation.
  await page.goto('/en/about/');
  await page.goto(mediaArticlePath);
  await expect(page.locator('.article-prose')).toHaveAttribute(
    'data-article-media-runtime',
    'ready',
  );
  await page.evaluate(() => {
    const probe = { startedWhileOpening: false, swappedWhileOpening: false, destroyed: 0 };
    Object.assign(window, { mediaOpeningProbe: probe });
    Object.defineProperty(window, 'pswp', {
      configurable: true,
      get: () => undefined,
      set: (viewer: PhotoSwipe) => {
        // Preserve the library's ordinary writable property and deletion
        // semantics, then observe only its public events and options.
        Object.defineProperty(window, 'pswp', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: viewer,
        });
        viewer.options.showAnimationDuration = 3000;
        viewer.on('destroy', () => {
          probe.destroyed += 1;
        });
        document.addEventListener(
          'astro:before-swap',
          () => {
            probe.swappedWhileOpening = viewer.opener.isOpening;
          },
          { once: true },
        );
        viewer.on('openingAnimationStart', () => {
          probe.startedWhileOpening = viewer.opener.isOpening;
          const about = document.querySelector<HTMLAnchorElement>(
            '.site-header__nav-link[href="/en/about/"]',
          );
          if (!about) throw new Error('Missing About navigation link.');
          about.dataset.astroPrefetch = 'false';
          about.click();
        });
      },
    });
  });
  const attachment = page.locator('a[data-article-media-item]').first();
  await attachment.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      attachment.locator('img').evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await attachment.press('Enter');
  await expect(page).toHaveURL('/en/about/');
  await expect(page.locator('.about-page')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending');
  const nextPageFocus = page.locator('.site-header__nav-link[href="/en/about/"]');
  await nextPageFocus.focus();
  await expect(page.locator('.pswp')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => 'pswp' in window)).toBe(false);
  await expect(nextPageFocus).toBeFocused();
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & {
            mediaOpeningProbe?: {
              startedWhileOpening: boolean;
              swappedWhileOpening: boolean;
              destroyed: number;
            };
          }
        ).mediaOpeningProbe,
    ),
  ).toEqual({ startedWhileOpening: true, swappedWhileOpening: true, destroyed: 1 });
  expect(errors).toEqual([]);
});
