import { expect, test } from '@playwright/test';

const siteMode = process.env.SITE_MODE ?? 'production';
const isPreview = siteMode === 'preview';

test('the built site obeys its deployment-mode contract', async ({ page, request }) => {
  const draftResponse = await request.get('/zh/blog/simulation-work-with-carla/');
  expect(draftResponse.status()).toBe(isPreview ? 200 : 404);

  const sitemapResponse = await request.get('/sitemap-index.xml');
  expect(sitemapResponse.status()).toBe(isPreview ? 404 : 200);

  await page.goto('/zh/');
  const robots = page.locator('meta[name="robots"]');
  if (isPreview) {
    await expect(robots).toHaveAttribute('content', /noindex/);
  } else {
    await expect(robots).toHaveAttribute('content', /\bindex\b/);
    expect(await robots.getAttribute('content')).not.toContain('noindex');
  }
});
