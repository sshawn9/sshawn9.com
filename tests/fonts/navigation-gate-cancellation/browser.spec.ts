import { expect, test } from '@playwright/test';
import { holdFontRequests } from '../font-probe';

test('client navigation keeps the outgoing page visible until target fonts are ready', async ({
  page,
}) => {
  await page.goto('/en/tags/frenet/', { waitUntil: 'networkidle' });
  const heldFonts = await holdFontRequests(page);

  try {
    await page.evaluate(() => {
      document.querySelector<HTMLAnchorElement>(
        'a[href="/en/blog/planar-frenet-frame/"]',
      )!.dataset.astroPrefetch = 'false';
    });
    const navigation = page.locator('a[href="/en/blog/planar-frenet-frame/"]').first().click();
    await expect.poll(() => heldFonts.urls.length, { timeout: 1_000 }).toBeGreaterThan(0);

    await expect(page.locator('[data-blog-listing]')).toBeVisible();
    await expect(page.locator('.page-outlet')).toHaveCSS('opacity', '1');
    await expect(page.locator('[data-article-page]')).toHaveCount(0);
    expect(heldFonts.urls.some((url) => url.includes('KaTeX_'))).toBe(true);

    heldFonts.release();
    await navigation;
    await expect(page).toHaveURL(/\/en\/blog\/planar-frenet-frame\/$/);
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
    await expect(page.locator('.katex').first()).toBeVisible();
  } finally {
    heldFonts.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('superseding navigation releases the UI from an indefinitely waiting font transaction', async ({
  page,
}) => {
  await page.goto('/en/blog/', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/en/tags/frenet/';
    document.body.append(link);
    link.click();
  });
  await expect(page).toHaveURL(/\/en\/tags\/frenet\/$/);
  const heldFonts = await holdFontRequests(page);

  try {
    await page.evaluate(() => {
      const link = document.querySelector<HTMLAnchorElement>(
        'a[href="/en/blog/planar-frenet-frame/"]',
      )!;
      link.dataset.astroPrefetch = 'false';
      link.click();
    });
    await expect.poll(() => heldFonts.urls.length, { timeout: 1_000 }).toBeGreaterThan(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/en\/blog\/$/);
    await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  } finally {
    heldFonts.release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
