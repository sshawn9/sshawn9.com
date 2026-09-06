import { expect, test, type Page } from '@playwright/test';
import { installViewNavigationProbe, viewProbe } from '../view-probe';

const blogPath = '/en/blog/';

function blogListing(page: Page) {
  return page.locator('[data-blog-listing]');
}

function blogTag(page: Page, slug: string) {
  return page.locator(`[data-blog-tag-definition][data-tag-slug="${slug}"]`);
}

test('blog tag views commit locally, retain the shell, and restore target history state', async ({
  page,
}) => {
  await installViewNavigationProbe(page);
  let documentRequests = 0;
  let blogHtmlFetches = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest()) documentRequests += 1;
    const url = new URL(request.url());
    if (request.resourceType() === 'fetch' && url.pathname === blogPath) {
      blogHtmlFetches += 1;
    }
  });

  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(blogPath);
  const listing = blogListing(page);
  const panel = page.locator('[data-blog-mobile-panel]');
  const main = page.locator('main');
  const sidebar = page.locator('#blog-sidebar');
  const mainIdentity = await main.evaluate((element) => {
    element.dataset.viewNavigationIdentity = 'main';
    return element.dataset.viewNavigationIdentity;
  });
  const sidebarIdentity = await sidebar.evaluate((element) => {
    element.dataset.viewNavigationIdentity = 'sidebar';
    return element.dataset.viewNavigationIdentity;
  });
  documentRequests = 0;
  blogHtmlFetches = 0;

  await blogTag(page, 'astro').click();
  await expect(listing).toHaveAttribute('data-selected-tags', '["astro"]');
  await expect(page).toHaveURL(/\/en\/blog\/\?tag=astro$/);
  await panel.evaluate((element) => element.scrollTo(0, 96));
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const astroPanelY = await panel.evaluate((element) => element.scrollTop);

  await blogTag(page, 'git').click();
  await expect(listing).toHaveAttribute('data-selected-tags', '["astro","git"]');
  await expect(page).toHaveURL(/\?tag=astro&tag=git$/);
  await panel.evaluate((element) => element.scrollTo(0, 16));
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(16);
  const astroAndGitPanelY = await panel.evaluate((element) => element.scrollTop);
  // scrollTo changes layout synchronously; the browser delivers its scroll
  // event on the next frame. Traverse only once this entry has been saved.
  await expect
    .poll(() => page.evaluate(() => history.state?.sshawn9?.regions?.['blog-sidebar-tags']?.y))
    .toBe(astroAndGitPanelY);

  await page.goBack();
  await expect(page).toHaveURL(/\?tag=astro$/);
  await expect(listing).toHaveAttribute('data-selected-tags', '["astro"]');
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(astroPanelY);
  // The region scroll listener persists in an animation frame. Let that commit before
  // asking the browser to traverse to the other local history entry.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await page.goForward();
  await expect(page).toHaveURL(/\?tag=astro&tag=git$/);
  await expect(listing).toHaveAttribute('data-selected-tags', '["astro","git"]');
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBe(astroAndGitPanelY);

  expect(await main.getAttribute('data-view-navigation-identity')).toBe(mainIdentity);
  expect(await sidebar.getAttribute('data-view-navigation-identity')).toBe(sidebarIdentity);
  expect(documentRequests).toBe(0);
  expect(blogHtmlFetches).toBe(0);
  const probe = await viewProbe(page);
  expect(probe?.outletOpacities.every((opacity) => opacity > 0.99)).toBe(true);
});
