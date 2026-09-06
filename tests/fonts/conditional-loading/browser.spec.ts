import { expect, test } from '@playwright/test';

const blogPath = '/zh/blog/';

test('content analysis loads only the conditional font resources in use', async ({ page }) => {
  await page.goto('/en/blog/git-operations-reference/', { waitUntil: 'networkidle' });
  const unusedItalicStates = await page.evaluate(() =>
    Array.from(document.fonts)
      .filter((font) => font.family.includes('Source Sans 3') && font.style === 'italic')
      .map((font) => font.status),
  );
  expect(unusedItalicStates).toEqual(['unloaded']);

  await page.goto('/en/blog/intent-cannot-be-fully-specified-upfront/', {
    waitUntil: 'networkidle',
  });
  const usedItalicStates = await page.evaluate(() =>
    Array.from(document.fonts)
      .filter((font) => font.family.includes('Source Sans 3') && font.style === 'italic')
      .map((font) => font.status),
  );
  expect(usedItalicStates).toEqual(['loaded']);

  await page.goto(blogPath, { waitUntil: 'networkidle' });
  const fontResources = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.endsWith('.woff2')),
  );
  expect(fontResources.some((url) => url.includes('noto-sans-sc-latin-wght-normal'))).toBe(false);
});
