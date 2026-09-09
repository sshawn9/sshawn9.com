import { expect, test } from '@playwright/test';
import { Miniflare } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = new URL('../../../apps/site/dist/', import.meta.url);
const directory = fileURLToPath(output);
const htmlPolicy = 'public, max-age=400, must-revalidate';
const immutablePolicy = 'public, max-age=31536000, immutable';
let server: Miniflare;

test.beforeAll(async () => {
  server = new Miniflare({
    cf: false,
    logRequests: false,
    workers: [
      {
        config: {
          name: 'html-cache',
          type: 'worker',
          compatibilityDate: '2026-08-10',
          // Static Assets handles these requests, not this unused Worker.
          manifest: {
            mainModule: 'unused.js',
            modules: {
              'unused.js': {
                type: 'esm',
                contents:
                  'export default { fetch() { return new Response(null, { status: 404 }); } };',
              },
            },
          },
          assets: {
            directory,
            hasUserWorker: false,
            htmlHandling: 'auto-trailing-slash',
            notFoundHandling: '404-page',
          },
        },
      },
    ],
  });
  await server.ready;
});

test.afterAll(async () => {
  await server?.dispose();
});

test('Cloudflare applies URL-scoped HTML caching without overriding asset policies', async () => {
  expect(await readFile(new URL('_headers', output), 'utf8')).toBe(
    await readFile(new URL('../../../apps/site/public/_headers', import.meta.url), 'utf8'),
  );
  const files = await readdir(directory, { recursive: true });
  for (const file of files.filter((name) => name.endsWith('.html'))) {
    const pathname = `/${file.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '')}`;
    const response = await server.dispatchFetch(`https://site.test${pathname}`, {
      method: 'HEAD',
      redirect: 'manual',
    });
    expect(response.status, pathname).toBe(200);
    expect(response.headers.get('cache-control'), pathname).toBe(htmlPolicy);
  }

  const typography = files.find((name) => /^_astro\/typography-vendor\.[\w-]+\.css$/.test(name));
  expect(typography).toBeTruthy();
  for (const pathname of [`/${typography}`, '/pagefind/pagefind-entry.json?ts=cache-probe']) {
    const response = await server.dispatchFetch(`https://site.test${pathname}`, { method: 'HEAD' });
    expect(response.status, pathname).toBe(200);
    expect(response.headers.get('cache-control'), pathname).toBe(immutablePolicy);
  }

  for (const pathname of [
    '/favicon.svg',
    '/robots.txt',
    '/site.en.webmanifest',
    '/pagefind/pagefind.js',
    '/en/blog/my-personal-website/compare/data/1.json',
  ]) {
    const response = await server.dispatchFetch(`https://site.test${pathname}`, { method: 'HEAD' });
    expect(response.status, pathname).toBe(200);
    expect(response.headers.get('cache-control'), pathname).toBe(
      'public, max-age=0, must-revalidate',
    );
  }

  // Trailing-slash URL rules intentionally apply to missing pages in any language or directory.
  for (const [pathname, policy] of [
    ['/en/cache-probe-missing/', htmlPolicy],
    ['/zh/cache-probe-missing/', htmlPolicy],
    ['/missing/', htmlPolicy],
    ['/missing.txt', 'public, max-age=0, must-revalidate'],
  ]) {
    const response = await server.dispatchFetch(`https://site.test${pathname}`, { method: 'HEAD' });
    expect(response.status, pathname).toBe(404);
    expect(response.headers.get('cache-control'), pathname).toBe(policy);
  }

  const redirect = await server.dispatchFetch('https://site.test/en/about', { redirect: 'manual' });
  expect(redirect.status).toBe(307);
  expect(redirect.headers.get('location')).toBe('/en/about/');
  const preview = await server.dispatchFetch('https://version.preview.workers.dev/en/about/', {
    method: 'HEAD',
  });
  expect(preview.headers.get('cache-control')).toBe(htmlPolicy);
  expect(preview.headers.get('x-robots-tag')).toBe('noindex');
});

test('prefetched HTML is reused on client navigation while reload still revalidates', async ({
  page,
}) => {
  const origin = await server.ready;
  const target = new URL('/en/about/', origin).href;
  await page.goto(new URL('/en/blog/', origin).href, { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');

  const link = page.locator('.site-header__desktop a[href="/en/about/"]');
  const prefetched = page.waitForResponse((response) => response.url() === target);
  await link.hover();
  const response = await prefetched;
  expect(response.headers()['cache-control']).toBe(htmlPolicy);
  await response.finished();
  await page.evaluate(() => performance.clearResourceTimings());

  await link.click();
  await expect(page).toHaveURL(target);
  await expect(page.locator('.about-page')).toBeVisible();
  const cachedFetch = await page.evaluate((url) => {
    const entries = performance.getEntriesByName(url, 'resource') as PerformanceResourceTiming[];
    const entry = entries.find((item) => item.initiatorType === 'fetch');
    return entry && { transferred: entry.transferSize, body: entry.decodedBodySize };
  }, target);
  expect(cachedFetch?.transferred).toBe(0);
  expect(cachedFetch?.body).toBeGreaterThan(0);

  const reloading = page.waitForRequest(
    (request) => request.isNavigationRequest() && request.url() === target,
  );
  await page.reload({ waitUntil: 'networkidle' });
  const headers = await (await reloading).allHeaders();
  expect(headers['cache-control']).toMatch(/max-age=0|no-cache/);
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  expect(
    await page.evaluate(
      () =>
        (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).transferSize,
    ),
  ).toBeGreaterThan(0);
});
