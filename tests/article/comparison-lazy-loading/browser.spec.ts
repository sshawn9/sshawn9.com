import { expect, test } from '@playwright/test';

const versionedArticlePath = '/en/blog/my-personal-website/';
const comparisonPath = `${versionedArticlePath}compare/?base=1&compare=2`;

test('comparison data loads only after entering the comparison route', async ({ page }) => {
  const requestedSources: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/compare/data/')) requestedSources.push(request.url());
  });

  await page.goto(versionedArticlePath);
  expect(requestedSources).toEqual([]);

  await page.goto(comparisonPath);
  await expect(page.locator('[data-version-comparison]')).toBeVisible();
  expect(requestedSources).toHaveLength(2);
});
