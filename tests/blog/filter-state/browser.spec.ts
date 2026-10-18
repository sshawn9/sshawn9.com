import { expect, test, type Page } from '@playwright/test';
import { installBlogFixture } from '../browser-fixtures';

const blogPath = '/en/blog/';

test.beforeEach(async ({ page }) => {
  await installBlogFixture(page);
});

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
      top: element.parentElement?.offsetTop,
      height: element.parentElement?.offsetHeight,
    })),
  );
  const alphaArticles = ['Fixture alpha-only', 'Fixture shared', 'Fixture alpha-second'];
  const unionArticles = [
    'Fixture alpha-only',
    'Fixture beta-only',
    'Fixture shared',
    'Fixture alpha-second',
    'Fixture beta-second',
  ];

  await page.locator('[data-blog-tag-definition][data-tag-slug="alpha"]').click();
  await expect(listing).toHaveAttribute('data-selected-tags', '["alpha"]');
  await expect(visibleArticles(page).locator('h2 a')).toHaveText(alphaArticles);
  expect(new URL(page.url()).searchParams.getAll('tag')).toEqual(['alpha']);

  await panel.evaluate((element) => element.scrollTo(0, 72));
  const panelScrollBefore = await panel.evaluate((element) => element.scrollTop);
  await page.locator('[data-blog-tag-definition][data-tag-slug="beta"]').click();

  await expect(listing).toHaveAttribute('data-selected-tags', '["beta","alpha"]');
  await expect(visibleArticles(page).locator('h2 a')).toHaveText(unionArticles);
  expect(new URL(page.url()).searchParams.getAll('tag')).toEqual(['beta', 'alpha']);
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(panelScrollBefore);
  expect(
    await definitions.evaluateAll((elements) =>
      elements.map((element) => ({
        name: element.getAttribute('data-tag-name'),
        slug: element.getAttribute('data-tag-slug'),
        count: element.getAttribute('data-tag-count'),
        top: element.parentElement?.offsetTop,
        height: element.parentElement?.offsetHeight,
      })),
    ),
  ).toEqual(initialDefinitions);
  expect(
    await visibleArticles(page).evaluateAll((elements) =>
      elements.every((element) => element.querySelector('[data-blog-filter-link][data-selected]')),
    ),
  ).toBe(true);

  await page.goBack();
  await expect(page).toHaveURL(/\?tag=alpha$/);
  await expect(listing).toHaveAttribute('data-selected-tags', '["alpha"]');
  await expect(visibleArticles(page).locator('h2 a')).toHaveText(alphaArticles);

  await page.goForward();
  await expect(page).toHaveURL(/\?tag=beta&tag=alpha$/);
  await expect(listing).toHaveAttribute('data-selected-tags', '["beta","alpha"]');
  await expect(visibleArticles(page).locator('h2 a')).toHaveText(unionArticles);
});

test('two tag clicks in one frame retain both history entries and traverse one intent at a time', async ({
  page,
}) => {
  await page.goto(blogPath);
  await page.evaluate(() => {
    const alpha = document.querySelector<HTMLElement>(
      '[data-blog-tag-definition][data-tag-slug="alpha"]',
    );
    const beta = document.querySelector<HTMLElement>(
      '[data-blog-tag-definition][data-tag-slug="beta"]',
    );
    if (!alpha || !beta) throw new Error('Expected blog tag fixtures');
    alpha.click();
    beta.click();
  });

  await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["beta","alpha"]');
  await expect(page).toHaveURL(/\?tag=beta&tag=alpha$/);
  await page.goBack();
  await expect(page).toHaveURL(/\?tag=alpha$/);
  await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["alpha"]');
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '[]');
});

test('leaving a local blog view and returning restores its selected tags', async ({ page }) => {
  await page.goto(blogPath);
  await blogTag(page, 'alpha').click();
  await expect(page).toHaveURL(/\?tag=alpha$/);

  const article = page.locator('[data-blog-article]:not([hidden]) h2 a').first();
  await expect(article).toBeVisible();
  await article.click();
  await expect(page).toHaveURL(/\/en\/about\/$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/en\/blog\/\?tag=alpha$/);
  await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["alpha"]');
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
    await blogTag(page, 'alpha').click();
    await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["alpha"]');
    await blogTag(page, 'beta').click();
    await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["beta","alpha"]');
    await page.goBack();
    await expect(blogListing(page)).toHaveAttribute('data-selected-tags', '["alpha"]');
    await expect(page.locator('main')).toHaveAttribute('data-view-navigation-identity', 'blog');
    await expect(page.locator('.page-outlet')).toHaveCSS('opacity', '1');
  });
}
