import { expect, test } from '@playwright/test';
import { installViewNavigationProbe, viewProbe } from '../../navigation/view-probe';

const blogPath = '/en/blog/';

function blogListing(page: import('@playwright/test').Page) {
  return page.locator('[data-blog-listing]');
}

test('an undeclared blog query follows the document-update path instead of a local view', async ({
  page,
}) => {
  await installViewNavigationProbe(page);
  await page.goto(blogPath);
  const main = page.locator('main');
  await main.evaluate((element) => (element.dataset.viewNavigationIdentity = 'blog'));
  const nextPage = page.locator('[data-blog-page="next"]');
  await expect(nextPage).toBeVisible();
  await nextPage.evaluate((element) => {
    (element as HTMLAnchorElement).href = '/en/blog/?page=2&unknown-view-parameter=one';
  });

  await nextPage.click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('unknown-view-parameter'))
    .toBe('one');
  await expect(blogListing(page)).toHaveAttribute('data-current-page', '2');
  await expect(main).not.toHaveAttribute('data-view-navigation-identity', 'blog');
  expect((await viewProbe(page))?.astroEvents).toContain('astro:before-swap');
});
