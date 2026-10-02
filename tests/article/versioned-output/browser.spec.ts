import { expect, test } from '@playwright/test';

const versionedArticlePath = '/en/blog/my-personal-website/';
const comparisonPath = `${versionedArticlePath}compare/?base=1&compare=2`;

test('current articles, historical snapshots, and comparison fallback exist in generated documents', async ({
  request,
}) => {
  const currentHtml = await (await request.get(versionedArticlePath)).text();
  expect(currentHtml).toContain('From Jekyll to Astro: Rebuilding My Personal Website');
  expect(currentHtml).toContain('href="/en/blog/my-personal-website/v/1/"');

  const historicalHtml = await (await request.get('/en/blog/my-personal-website/v/1/')).text();
  expect(historicalHtml).toContain('content="noindex, follow"');
  expect(historicalHtml).toContain('My GitHub Pages');
  expect(historicalHtml).toContain('data-current-version');
  expect(historicalHtml).toContain('#Jekyll');
  expect(historicalHtml).toContain('#GitHub Pages');

  const comparisonHtml = await (await request.get(comparisonPath)).text();
  expect(comparisonHtml).toContain('version-comparison-static-fallback');
  expect(comparisonHtml).toContain('interactive diff needs JavaScript');
  expect(comparisonHtml).toContain('href="/en/blog/my-personal-website/v/1/"');
  expect(comparisonHtml).toContain('href="/en/blog/my-personal-website/"');
});
