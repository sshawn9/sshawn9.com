import { expect, test } from '@playwright/test';

test('the generated site obeys its production or preview publishing mode', async ({
  page,
  request,
}) => {
  const preview = process.env.SITE_MODE === 'preview';
  const draft = await request.get('/zh/blog/simulation-work-with-carla/');
  const sitemap = await request.get('/sitemap-index.xml');

  expect(draft.status()).toBe(preview ? 200 : 404);
  expect(sitemap.status()).toBe(preview ? 404 : 200);

  await page.goto('/zh/');
  const robots = page.locator('meta[name="robots"]');
  if (preview) {
    await expect(robots).toHaveAttribute('content', /\bnoindex\b/);
  } else {
    await expect(robots).toHaveCount(0);
  }
});
