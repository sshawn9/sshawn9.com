import { expect, test, type Page } from '@playwright/test';

const mediaArticlePath = '/en/blog/self-hosting-tools-and-services/';
const photoSwipeStylesheet = /\/photoswipe\.[^/]+\.css(?:\?|$)/;

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
