import { expect, test, type Page } from '@playwright/test';
import { BLOG_PAGE_SIZE } from '../../../apps/site/src/features/blog/runtime/blog-view-state';

const blogPath = '/en/blog/';

function visibleArticles(page: Page) {
  return page.locator('[data-blog-article]:not([hidden])');
}

async function readBlogFrames(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __blogFrameProbe?: { complete: boolean };
            }
          ).__blogFrameProbe?.complete ?? false,
      ),
    )
    .toBe(true);

  return page.evaluate(
    () =>
      (
        window as Window & {
          __blogFrameProbe?: {
            frames: Array<{
              articleCount: number;
              totalArticleCount: number;
              selectedTags: string[];
              currentPage: string;
              visibleArticleHrefs: string[];
              shellVisible: boolean;
            }>;
          };
        }
      ).__blogFrameProbe?.frames ?? [],
  );
}

test('filtered and paginated cold entries stay consistent in the sampled frames after first contentful paint', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const probe = {
      frames: [] as Array<{
        articleCount: number;
        totalArticleCount: number;
        selectedTags: string[];
        currentPage: string;
        visibleArticleHrefs: string[];
        shellVisible: boolean;
      }>,
      complete: false,
      attempts: 0,
    };
    Object.defineProperty(window, '__blogFrameProbe', { configurable: true, value: probe });

    const sample = () => {
      probe.attempts += 1;
      const listing = document.querySelector<HTMLElement>('[data-blog-listing]');
      const shell = document.querySelector<HTMLElement>('.site-shell');
      if (listing && shell) {
        probe.frames.push({
          articleCount: listing.querySelectorAll('[data-blog-article]:not([hidden])').length,
          totalArticleCount: listing.querySelectorAll('[data-blog-article]').length,
          selectedTags: JSON.parse(listing.dataset.selectedTags ?? '[]'),
          currentPage: listing.dataset.currentPage ?? '',
          visibleArticleHrefs: [
            ...listing.querySelectorAll<HTMLAnchorElement>(
              '[data-blog-article]:not([hidden]) h2 a',
            ),
          ].map((link) => link.pathname),
          shellVisible:
            getComputedStyle(document.body).visibility !== 'hidden' &&
            getComputedStyle(shell).visibility !== 'hidden',
        });
      }
      if (probe.frames.length >= 8 || probe.attempts >= 120) {
        probe.complete = true;
        return;
      }
      requestAnimationFrame(sample);
    };
    const paintObserver = new PerformanceObserver((entries, observer) => {
      if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      observer.disconnect();
      requestAnimationFrame(sample);
    });
    paintObserver.observe({ type: 'paint', buffered: true });
  });

  await page.goto(`${blogPath}?tag=git`);
  const filteredFrames = await readBlogFrames(page);
  const filteredCount = await visibleArticles(page).count();
  expect(filteredFrames).toHaveLength(8);
  expect(
    filteredFrames.every(
      (frame) =>
        frame.shellVisible &&
        frame.articleCount === filteredCount &&
        frame.selectedTags.join(',') === 'git',
    ),
  ).toBe(true);

  await page.goto(`${blogPath}?page=2`);
  const secondPageFrames = await readBlogFrames(page);
  expect(secondPageFrames).toHaveLength(8);
  expect(
    secondPageFrames.every(
      (frame) =>
        frame.shellVisible &&
        frame.selectedTags.length === 0 &&
        frame.articleCount === Math.min(BLOG_PAGE_SIZE, frame.totalArticleCount - BLOG_PAGE_SIZE),
    ),
  ).toBe(true);
  await expect(page.locator('[data-blog-listing]')).toHaveAttribute('data-current-page', '2');
  await expect(page.getByRole('navigation', { name: 'Article pagination' })).toBeVisible();

  const combinedTags = ['frenet', 'personal-website', 'git', 'self-hosting'];
  const combinedQuery = combinedTags.map((tag) => `tag=${tag}`).join('&');
  await page.goto(`${blogPath}?${combinedQuery}&page=2`);
  const combinedFrames = await readBlogFrames(page);
  const combinedHrefs = await visibleArticles(page)
    .locator('h2 a')
    .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).pathname));
  expect(combinedHrefs.length).toBeGreaterThan(0);
  expect(combinedFrames).toHaveLength(8);
  expect(
    combinedFrames.every(
      (frame) =>
        frame.shellVisible &&
        frame.currentPage === '2' &&
        frame.selectedTags.toSorted().join(',') === combinedTags.toSorted().join(',') &&
        frame.visibleArticleHrefs.join(',') === combinedHrefs.join(','),
    ),
  ).toBe(true);
  await expect(page.locator('[data-blog-result-count]')).toHaveText(/Page 2 of \d+/);
  await expect(page.getByRole('navigation', { name: 'Article pagination' })).toBeVisible();
});
