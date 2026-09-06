import { expect, test, type Page } from '@playwright/test';
import { installViewNavigationProbe } from '../view-probe';

const blogPath = '/en/blog/';

function blogTag(page: Page, slug: string) {
  return page.locator(`[data-blog-tag-definition][data-tag-slug="${slug}"]`);
}

async function pageLoadCount(page: Page) {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __viewNavigationProbe?: { astroEvents: string[] };
        }
      ).__viewNavigationProbe?.astroEvents.filter((name) => name === 'astro:page-load').length ?? 0,
  );
}

async function waitForPageLoadAnnouncerBoundary(page: Page, previousPageLoads: number) {
  await expect.poll(() => pageLoadCount(page)).toBe(previousPageLoads + 1);
  // Astro appends its route announcer after dispatching page-load. Cross two
  // frames so the assertion observes the resource-creation boundary itself.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test('local views suppress the route announcer scope while document navigation restores announcements', async ({
  page,
}) => {
  await page.goto(blogPath);
  const announcer = page.locator('.astro-route-announcer');

  await blogTag(page, 'astro').click();
  await expect(page.locator('html')).toHaveAttribute('data-navigation-scope', 'view');
  await expect(announcer).toHaveCount(1);
  await expect(announcer).toHaveCSS('display', 'none');

  await page.locator('[data-blog-article]:not([hidden]) h2 a').first().click();
  await expect(page).toHaveURL(/\/en\/blog\/[^?]+\/$/);
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation-scope', 'view');
  await expect(announcer).not.toHaveCSS('display', 'none');
  await expect(announcer).toContainText(await page.title());
});

test('eight local blog navigations keep route announcers bounded before a document navigation announces', async ({
  page,
}) => {
  await installViewNavigationProbe(page);
  await page.goto(blogPath);
  const announcer = page.locator('.astro-route-announcer');

  for (const slug of ['astro', 'git', 'astro', 'git', 'astro', 'git', 'astro', 'git']) {
    const pageLoadsBeforeClick = await pageLoadCount(page);
    await blogTag(page, slug).click();
    await waitForPageLoadAnnouncerBoundary(page, pageLoadsBeforeClick);
    await expect(announcer).toHaveCount(1);
    await expect(announcer).toHaveCSS('display', 'none');
  }

  await page.locator('[data-blog-article]:not([hidden]) h2 a').first().click();
  await expect(page).toHaveURL(/\/en\/blog\/[^?]+\/$/);
  await expect(announcer).toHaveCount(1);
  await expect(announcer).not.toHaveCSS('display', 'none');
  await expect(announcer).toContainText(await page.title());
});
