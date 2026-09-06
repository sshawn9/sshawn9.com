import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { BUILD_ID_META_NAME, normalizeBuildId } from '../../src/runtime/build-generation';

test('HTML, the live client, and search metadata share the built artifact identity', async ({
  page,
}) => {
  const builtHtml = await readFile(
    new URL('../../dist/en/blog/index.html', import.meta.url),
    'utf8',
  );
  const expectedId = builtHtml.match(/<meta name="site-build-id" content="([^"]+)"/)?.[1] ?? '';
  expect(normalizeBuildId(expectedId), 'Built HTML must contain a valid build identity').toBe(
    expectedId,
  );
  expect(expectedId, 'Built HTML must not use the development identity').not.toBe(
    'site-development',
  );

  for (const locale of ['en', 'zh']) {
    await page.goto(`/${locale}/blog/`);
    const documentIdentity = page.locator(`meta[name="${BUILD_ID_META_NAME}"]`);
    await expect(documentIdentity).toHaveAttribute('content', expectedId);
    await page.locator('[data-wallpaper-visual]').evaluate((element) => {
      element.setAttribute('data-build-identity-probe', 'original');
    });

    const [entryRequest] = await Promise.all([
      page.waitForRequest(
        (request) => new URL(request.url()).pathname === '/pagefind/pagefind-entry.json',
      ),
      page.locator(`.site-header a[href="/${locale}/search/"]`).first().click(),
    ]);
    await expect(page).toHaveURL(new RegExp(`/${locale}/search/$`));

    // A mismatched compiled client would force a new document and lose this node.
    await expect(page.locator('[data-wallpaper-visual]')).toHaveAttribute(
      'data-build-identity-probe',
      'original',
    );
    await expect(documentIdentity).toHaveAttribute('content', expectedId);
    await expect(page.locator('pagefind-config')).toHaveAttribute('meta-cache-tag', expectedId);
    expect(new URL(entryRequest.url()).searchParams.get('ts')).toBe(expectedId);
    await expect(page.locator('[data-site-search]')).toHaveAttribute('data-search-ready', '');
  }
});

test('a different target build hands navigation off to a new document', async ({ page }) => {
  await page.goto('/en/blog/');
  const currentId = await page
    .locator(`meta[name="${BUILD_ID_META_NAME}"]`)
    .getAttribute('content');
  const targetId = currentId === 'another-build' ? 'next-build' : 'another-build';
  await page.route('**/en/about/', async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    const body = html.replace(
      /(<meta name="site-build-id" content=")[^"]+("\s*\/?>)/,
      `$1${targetId}$2`,
    );
    expect(body).not.toBe(html);
    await route.fulfill({ response, body });
  });
  await page.locator('[data-wallpaper-visual]').evaluate((element) => {
    element.setAttribute('data-build-identity-probe', 'original');
  });

  await Promise.all([
    page.waitForRequest(
      (request) =>
        request.isNavigationRequest() && new URL(request.url()).pathname === '/en/about/',
    ),
    page.getByRole('link', { name: 'About', exact: true }).click(),
  ]);
  await expect(page).toHaveURL(/\/en\/about\/$/);
  await expect(page.locator(`meta[name="${BUILD_ID_META_NAME}"]`)).toHaveAttribute(
    'content',
    targetId,
  );
  await expect(page.locator('[data-wallpaper-visual]')).not.toHaveAttribute(
    'data-build-identity-probe',
    'original',
  );
  await expect(page.locator('.about-page')).toBeVisible();
});
