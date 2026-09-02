import { expect, test } from '@playwright/test';

const mediaArticlePath = '/en/blog/self-hosting-tools-and-services/';

test('the server-rendered project preview gains its existing two-dimensional drag behavior', async ({
  page,
}) => {
  await page.goto('/en/projects/');
  const preview = page.locator('[data-project-preview="motion-control"]');
  const figure = preview.locator('.motion-control-project-visual');
  const handle = preview.locator('[data-vehicle-drag-handle]');
  const initialX = await figure.getAttribute('data-vehicle-x');
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 48, box!.y + box!.height / 2 + 24, {
    steps: 4,
  });
  await page.mouse.up();

  await expect.poll(() => figure.getAttribute('data-vehicle-x')).not.toBe(initialX);
});

test('explicit image attachments keep a no-script link and gain an accessible viewer', async ({
  browser,
  page,
}) => {
  const noScriptContext = await browser.newContext({ javaScriptEnabled: false });
  const noScriptPage = await noScriptContext.newPage();
  await noScriptPage.goto(mediaArticlePath);
  const fallback = noScriptPage.locator('a[data-article-media-item]');
  await expect(fallback).toHaveAttribute('target', '_blank');
  await expect(fallback).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(fallback.locator('img')).toHaveAttribute('width', '512');
  await noScriptContext.close();

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
