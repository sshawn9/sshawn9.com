import { expect, test, type Page } from '@playwright/test';

const mediaArticlePath = '/en/blog/self-hosting-tools-and-services/';

async function viewportGeometry(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.site-header__inner');
    const box = header?.getBoundingClientRect();
    return { left: box?.left ?? -1, width: box?.width ?? -1, scrollY };
  });
}

test('explicit image attachments open a keyboard-dismissible viewer', async ({ page }) => {
  await page.goto(mediaArticlePath);
  const attachment = page.locator('a[data-article-media-item]');
  await expect(page.locator('.article-prose')).toHaveAttribute(
    'data-article-media-runtime',
    'ready',
  );
  await attachment.click();
  await expect(page.locator('.pswp')).toBeVisible();
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
  const after = await viewportGeometry(page);
  expect(after.left).toBeCloseTo(before.left, 1);
  expect(after.width).toBeCloseTo(before.width, 1);
  expect(after.scrollY).toBeCloseTo(before.scrollY, 1);
  await page.keyboard.press('Escape');
});
