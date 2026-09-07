import { expect, test } from '@playwright/test';

const blogPath = '/en/blog/';
const siteRuntimePattern = /\/_astro\/SiteRuntime\.astro_astro_type_script_.*\.js(?:\?|$)/;

test('the static blog remains readable and navigable when its enhancement runtime fails', async ({
  page,
}) => {
  let runtimeRequestAborted = false;
  await page.route(siteRuntimePattern, async (route) => {
    runtimeRequestAborted = true;
    await route.abort('failed');
  });

  await page.goto(`${blogPath}?tag=git`);
  expect(runtimeRequestAborted).toBe(true);

  const listing = page.locator('[data-blog-listing]');
  await expect(listing).toHaveAttribute('data-blog-view-ready', '');
  await expect(listing).not.toHaveAttribute('data-blog-runtime-ready', '');
  await expect(page.locator('.page-outlet')).toBeVisible({ timeout: 5_000 });

  const visibleArticles = listing.locator('[data-blog-article]:not([hidden])');
  expect(await visibleArticles.count()).toBeGreaterThan(0);
  expect(
    await visibleArticles.evaluateAll((articles) =>
      articles.every((article) => {
        const tags = JSON.parse(article.getAttribute('data-article-tag-slugs') ?? '[]') as string[];
        return tags.includes('git');
      }),
    ),
  ).toBe(true);

  const staticTagLink = page.locator('[data-blog-tag-definition][data-tag-slug="git"]');
  await expect(staticTagLink).toHaveAttribute('href', '/en/tags/git/');
  await staticTagLink.click();
  await expect(page).toHaveURL(/\/en\/tags\/git\/$/);
  await expect(page.locator('[data-blog-article]').first()).toBeVisible();
});

test('a stalled enhancement module cannot hide the initially restored page-two list', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(siteRuntimePattern, async (route) => {
    requested = true;
    await gate;
    await route.abort();
  });
  try {
    await page.goto(`${blogPath}?page=2`, { waitUntil: 'commit' });
    const listing = page.locator('[data-blog-listing]');
    await expect.poll(() => requested).toBe(true);
    await expect(listing).toHaveAttribute('data-current-page', '2');
    await expect(listing).toBeVisible();
    await expect(listing).not.toHaveAttribute('data-blog-runtime-ready', '');
    const articles = listing.locator('[data-blog-article]:not([hidden])');
    await expect(articles.first()).toBeVisible();
    const link = articles.first().locator('h2 a');
    const href = await link.getAttribute('href');
    release();
    await link.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(href);
    await expect(page.locator('.article-prose')).toBeVisible();
  } finally {
    release();
  }
});
