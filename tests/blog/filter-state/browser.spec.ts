import { expect, test, type Page } from '@playwright/test';

const blogPath = '/en/blog/';

function visibleArticles(page: Page) {
  return page.locator('[data-blog-article]:not([hidden])');
}

function blogListing(page: Page) {
  return page.locator('[data-blog-listing]');
}

function blogTag(page: Page, slug: string) {
  return page.locator(`[data-blog-tag-definition][data-tag-slug="${slug}"]`);
}

test('union filters keep global facets, article selection, URL, and history synchronized', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(blogPath);

  const listing = page.locator('[data-blog-listing]');
  const panel = page.locator('[data-blog-mobile-panel]');
  const definitions = page.locator('[data-blog-tag-definition]');
  const initialDefinitions = await definitions.evaluateAll((elements) =>
    elements.map((element) => ({
      name: element.getAttribute('data-tag-name'),
      slug: element.getAttribute('data-tag-slug'),
      count: element.getAttribute('data-tag-count'),
    })),
  );
  const articles = await page
    .locator('[data-blog-article]')
    .evaluateAll((elements) =>
      elements.map(
        (element) => JSON.parse(element.getAttribute('data-article-tag-slugs') ?? '[]') as string[],
      ),
    );
  const expectedCount = (selected: string[]) =>
    articles.filter((tags) => tags.some((tag) => selected.includes(tag))).length;

  await page.locator('[data-blog-tag-definition][data-tag-slug="astro"]').click();
  await expect(listing).toHaveAttribute('data-selected-tags', '["astro"]');
  await expect(visibleArticles(page)).toHaveCount(expectedCount(['astro']));
  expect(new URL(page.url()).searchParams.getAll('tag')).toEqual(['astro']);

  await panel.evaluate((element) => element.scrollTo(0, 72));
  const panelScrollBefore = await panel.evaluate((element) => element.scrollTop);
  await page.locator('[data-blog-tag-definition][data-tag-slug="git"]').click();

  await expect(listing).toHaveAttribute('data-selected-tags', '["astro","git"]');
  await expect(visibleArticles(page)).toHaveCount(expectedCount(['astro', 'git']));
  expect(new URL(page.url()).searchParams.getAll('tag')).toEqual(['astro', 'git']);
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(panelScrollBefore);
  expect(
    await definitions.evaluateAll((elements) =>
      elements.map((element) => ({
        name: element.getAttribute('data-tag-name'),
        slug: element.getAttribute('data-tag-slug'),
        count: element.getAttribute('data-tag-count'),
      })),
    ),
  ).toEqual(initialDefinitions);
  expect(
    await visibleArticles(page).evaluateAll((elements) =>
      elements.every((element) => element.querySelector('[data-blog-filter-link][data-selected]')),
    ),
  ).toBe(true);

  await page.goBack();
  await expect(page).toHaveURL(/\?tag=astro$/);
  await expect(listing).toHaveAttribute('data-selected-tags', '["astro"]');
  await expect(visibleArticles(page)).toHaveCount(expectedCount(['astro']));

  await page.goForward();
  await expect(page).toHaveURL(/\?tag=astro&tag=git$/);
  await expect(listing).toHaveAttribute('data-selected-tags', '["astro","git"]');
  await expect(visibleArticles(page)).toHaveCount(expectedCount(['astro', 'git']));
});

test('two tag clicks in one frame retain both history entries and traverse one intent at a time', async ({
  page,
}) => {
  await page.goto(blogPath);
  await page.evaluate(() => {
    const astro = document.querySelector<HTMLElement>(
      '[data-blog-tag-definition][data-tag-slug="astro"]',
    );
    const git = document.querySelector<HTMLElement>(
      '[data-blog-tag-definition][data-tag-slug="git"]',
    );
    if (!astro || !git) throw new Error('Expected blog tag fixtures');
    astro.click();
    git.click();
  });

  await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["astro","git"]');
  await expect(page).toHaveURL(/\?tag=astro&tag=git$/);
  await page.goBack();
  await expect(page).toHaveURL(/\?tag=astro$/);
  await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["astro"]');
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '[]');
});

test('leaving a local blog view and returning restores its selected tags', async ({ page }) => {
  await page.goto(blogPath);
  await blogTag(page, 'astro').click();
  await expect(page).toHaveURL(/\?tag=astro$/);

  const article = page.locator('[data-blog-article]:not([hidden]) h2 a').first();
  await expect(article).toBeVisible();
  await article.click();
  await expect(page).toHaveURL(/\/en\/blog\/[^?]+\/$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/en\/blog\/\?tag=astro$/);
  await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["astro"]');
});

for (const mode of ['reduced-motion', 'without-view-transitions'] as const) {
  test(`local tag history remains in place ${mode}`, async ({ page }) => {
    if (mode === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' });
    else
      await page.addInitScript(() => {
        Object.defineProperty(Document.prototype, 'startViewTransition', {
          configurable: true,
          value: undefined,
        });
      });
    await page.goto(blogPath);
    await page.locator('main').evaluate((element) => {
      element.dataset.viewNavigationIdentity = 'blog';
    });
    await blogTag(page, 'astro').click();
    await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["astro"]');
    await blogTag(page, 'git').click();
    await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["astro","git"]');
    await page.goBack();
    await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["astro"]');
    await expect(page.locator('main')).toHaveAttribute('data-view-navigation-identity', 'blog');
    await expect(page.locator('.page-outlet')).toHaveCSS('opacity', '1');
  });
}
