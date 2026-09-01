import { expect, test } from '@playwright/test';

const projectPath = '/en/projects/autonomous-driving-motion-control/';
const mediaArticlePath = '/en/blog/self-hosting-tools-and-services/';

test('project routes remain complete static documents without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/en/projects/');
  await expect(page.getByRole('heading', { name: '自动驾驶运动控制' })).toBeVisible();
  await expect(page.locator('[data-project-preview="motion-control"]')).toBeVisible();
  await expect(page.locator('[data-project-preview="motion-control"] svg')).toBeVisible();
  const previewBox = await page.locator('[data-project-preview="motion-control"]').boundingBox();
  const figureBox = await page.locator('.motion-control-project-visual').boundingBox();
  expect(previewBox).not.toBeNull();
  expect(figureBox).not.toBeNull();
  expect(figureBox!.x).toBeCloseTo(previewBox!.x, 1);
  expect(figureBox!.width).toBeCloseTo(previewBox!.width, 1);

  await page.getByRole('link', { name: '自动驾驶运动控制' }).click();
  await expect(page).toHaveURL(new RegExp(`${projectPath}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('自动驾驶运动控制');
  await expect(page.locator('.project-detail-page')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('heading', { name: 'Related articles' })).toBeVisible();
  await expect(page.locator('.project-related > ol > li')).toHaveCount(5);
  await expect(page.locator('.project-prose')).toHaveCount(0);

  await context.close();
});

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

test('project navigation participates in the persistent localized shell', async ({ page }) => {
  await page.goto('/en/projects/');
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-site-shell]')!.dataset.identityProbe = 'original';
  });

  const projectsLink = page.locator('[data-shell-sync-key="projects"]');
  await expect(projectsLink).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: '中文' }).click();

  await expect(page).toHaveURL(/\/zh\/projects\/$/);
  await expect(page.locator('[data-site-shell]')).toHaveAttribute(
    'data-identity-probe',
    'original',
  );
  await expect(page.locator('[data-shell-sync-key="projects"]')).toHaveText('项目');
  await expect(page.locator('[data-shell-sync-key="projects"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
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
