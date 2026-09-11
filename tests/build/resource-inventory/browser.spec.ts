import { expect, test, type Page, type Request } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createResourceInventory } from '../../../apps/site/tools/resource-inventory/inventory.mjs';
import { builtSiteDirectory } from '../../support/static-assets';

type Inventory = Awaited<ReturnType<typeof createResourceInventory>>;

let inventory: Inventory;

test.beforeAll(async () => {
  const buildInfo = JSON.parse(
    await readFile(
      new URL('../../../apps/site/.astro/resource-inventory-build.json', import.meta.url),
      'utf8',
    ),
  );
  inventory = await createResourceInventory({ directory: builtSiteDirectory, buildInfo });
});

function inventoryPage(path: string) {
  const url = new URL(path, inventory.site);
  return new URL(url.pathname, inventory.site).href;
}

function inventoryRequest(request: Request, page: Page) {
  const url = new URL(request.url());
  if (request.method() !== 'GET') return null;
  if (url.origin !== new URL(page.url()).origin) return null;
  if (
    !url.pathname.startsWith('/_astro/') &&
    !url.pathname.startsWith('/_fonts/') &&
    !url.pathname.startsWith('/pagefind/') &&
    !url.pathname.includes('/compare/data/')
  )
    return null;
  return new URL(url.pathname + url.search, inventory.site).href;
}

async function expectRequestsAreAssociated(page: Page, path: string, ready: () => Promise<void>) {
  const requests = new Set<string>();
  const collect = (request: Request) => {
    const url = inventoryRequest(request, page);
    if (url) requests.add(url);
  };
  page.on('request', collect);
  await page.goto(path);
  await ready();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  page.off('request', collect);

  const associatedResources = inventory.pageResources[inventoryPage(path)];
  expect(associatedResources, `The report must include ${path}`).toBeDefined();
  const known = new Set(associatedResources);
  expect(
    requests.size,
    `${path} should load at least one tracked same-origin asset`,
  ).toBeGreaterThan(0);
  for (const request of requests) {
    expect(
      known,
      `${path} requested an asset absent from its inventory associations: ${request}`,
    ).toContain(request);
  }
  return requests;
}

async function expectColdFontRequestsAreAssociated(
  page: Page,
  path: string,
  ready: () => Promise<void>,
) {
  const requests = new Set<string>();
  const collect = (request: Request) => {
    const url = new URL(request.url());
    if (
      request.method() === 'GET' &&
      url.origin === new URL(page.url()).origin &&
      request.resourceType() === 'font'
    ) {
      requests.add(new URL(url.pathname + url.search, inventory.site).href);
    }
  };
  page.on('request', collect);
  await page.goto(path);
  await ready();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  page.off('request', collect);

  const associatedResources = inventory.pageResources[inventoryPage(path)];
  expect(requests.size, `${path} should request fonts from a cold document`).toBeGreaterThan(0);
  for (const request of requests) expect(associatedResources).toContain(request);
}

test('inventory matches the built document identity and has complete local Pagefind output', async ({
  page,
}) => {
  await page.goto('/en/blog/git-identity-management/');
  await expect(page.locator('meta[name="site-build-id"]')).toHaveAttribute(
    'content',
    inventory.buildId,
  );

  expect(inventory.diagnostics.filter((diagnostic) => diagnostic.level === 'error')).toEqual([]);
  expect(
    inventory.resources
      .filter((resource) => !resource.external)
      .every((resource) => resource.file !== null),
  ).toBe(true);
  const search = inventory.pageResources[inventoryPage('/en/search/')];
  expect(search).toContain(
    new URL(`/pagefind/pagefind-entry.json?ts=${inventory.buildId}`, inventory.site).href,
  );
  expect(
    inventory.resources.some((resource) => resource.file?.startsWith('pagefind/fragment/')),
  ).toBe(true);
});

test('a cold Chinese About document requests only associated fonts', async ({ context }) => {
  const chineseAbout = await context.newPage();
  await expectColdFontRequestsAreAssociated(chineseAbout, '/zh/about/', async () => {
    await expect(chineseAbout.locator('main')).toBeVisible();
  });
  await chineseAbout.close();
});

test('a cold Chinese formula document requests only associated fonts', async ({ context }) => {
  const chineseMath = await context.newPage();
  await expectColdFontRequestsAreAssociated(
    chineseMath,
    '/zh/blog/planar-frenet-frame/',
    async () => {
      await expect(chineseMath.locator('.katex').first()).toBeVisible();
    },
  );
  await chineseMath.close();
});

test('a cold Chinese client-only figure requests only associated fonts', async ({ page }) => {
  await expectColdFontRequestsAreAssociated(
    page,
    '/zh/blog/closed-loop-control-timing/',
    async () => {
      await expect(page.locator('.closed-loop-control-timing-plot svg')).toBeVisible();
    },
  );
});

test('sampled runtime asset requests remain within inventory associations', async ({ context }) => {
  const article = await context.newPage();
  await expectRequestsAreAssociated(article, '/en/blog/git-identity-management/', async () => {
    await expect(article.locator('article')).toBeVisible();
  });
  await article.close();

  const about = await context.newPage();
  await expectRequestsAreAssociated(about, '/en/about/', async () => {
    await expect(about.locator('main')).toBeVisible();
  });
  const aboutResources = inventory.pageResources[inventoryPage('/en/about/')];
  expect(aboutResources.some((url) => /photoswipe|katex/i.test(url))).toBe(false);
  await about.close();

  const research = await context.newPage();
  await expectRequestsAreAssociated(research, '/en/blog/closed-loop-control-timing/', async () => {
    await expect(research.locator('.closed-loop-control-timing-plot svg')).toBeVisible();
  });
  await research.close();

  const comparison = await context.newPage();
  const comparisonRequests = await expectRequestsAreAssociated(
    comparison,
    '/en/blog/my-personal-website/compare/?base=1&compare=2',
    async () => {
      await expect(comparison.locator('[data-diff-panel]')).toBeVisible();
    },
  );
  expect([...comparisonRequests].filter((url) => url.includes('/compare/data/'))).toHaveLength(2);
  await comparison.close();

  const gallery = await context.newPage();
  const galleryRequests = new Set<string>();
  const collectGalleryRequest = (request: Request) => {
    const url = inventoryRequest(request, gallery);
    if (url) galleryRequests.add(url);
  };
  gallery.on('request', collectGalleryRequest);
  await gallery.goto('/en/blog/self-hosting-tools-and-services/');
  await expect(gallery.locator('.article-prose')).toHaveAttribute(
    'data-article-media-runtime',
    'ready',
  );
  const attachment = gallery.locator('a[data-article-media-item]').first();
  const fullImage = await attachment.getAttribute('href');
  expect(fullImage).toBeTruthy();
  const fullRequest = gallery.waitForRequest(
    (request) => request.url() === new URL(fullImage!, gallery.url()).href,
  );
  await attachment.click();
  await fullRequest;
  await expect(gallery.locator('.pswp')).toBeVisible();
  gallery.off('request', collectGalleryRequest);
  const galleryResources =
    inventory.pageResources[inventoryPage('/en/blog/self-hosting-tools-and-services/')];
  expect(galleryResources).toContain(new URL(fullImage!, inventory.site).href);
  for (const request of galleryRequests) expect(galleryResources).toContain(request);
  await gallery.close();

  const search = await context.newPage();
  const fragment = search.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname.startsWith('/pagefind/fragment/'),
  );
  await expectRequestsAreAssociated(search, '/en/search/', async () => {
    await expect(search.locator('[data-site-search]')).toHaveAttribute('data-search-ready', '');
    await search.locator('[data-site-search] .pf-input').fill('gith');
    await fragment;
    await expect(search.locator('.site-search-result__link').first()).toBeVisible();
  });
  const englishSearch = inventory.pageResources[inventoryPage('/en/search/')];
  const chineseSearch = inventory.pageResources[inventoryPage('/zh/search/')];
  expect(englishSearch.some((url) => /\/zh(?:-|_)/i.test(new URL(url).pathname))).toBe(false);
  expect(chineseSearch.some((url) => /\/en(?:-|_)/i.test(new URL(url).pathname))).toBe(false);
  await search.close();
});
