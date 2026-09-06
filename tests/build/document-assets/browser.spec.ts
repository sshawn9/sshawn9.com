import { expect, test } from '@playwright/test';

test('sampled document generations reference the shared site icon and localized manifest', async ({
  page,
  request,
}) => {
  for (const locale of ['en', 'zh'] as const) {
    await page.goto(`/${locale}/`);
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      `/site.${locale}.webmanifest`,
    );
  }

  const fallbackResponse = await page.goto('/missing-page/');
  expect(fallbackResponse?.status()).toBe(404);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg');

  for (const asset of ['/favicon.svg', '/site.en.webmanifest', '/site.zh.webmanifest']) {
    const response = await request.get(asset);
    expect(response.ok(), `${asset} must be emitted by the site build`).toBe(true);
  }
});
