import { expect, test, type Page } from '@playwright/test';
import { BLOG_PAGE_SIZE } from '../../src/features/blog/runtime/blog-view-state';

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
              shellVisible: boolean;
            }>;
          };
        }
      ).__blogFrameProbe?.frames ?? [],
  );
}

async function readSidebarFrames(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __blogSidebarFrameProbe?: { complete: boolean };
            }
          ).__blogSidebarFrameProbe?.complete ?? false,
      ),
    )
    .toBe(true);

  return page.evaluate(
    () =>
      (
        window as Window & {
          __blogSidebarFrameProbe?: {
            frames: Array<{
              resultsOffset: number;
              sidebarWidth: number;
              boundaryVisible: boolean;
              animating: boolean;
            }>;
          };
        }
      ).__blogSidebarFrameProbe?.frames ?? [],
  );
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

test('filtered and paginated cold entries are correct in every observable frame', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const probe = {
      frames: [] as Array<{
        articleCount: number;
        totalArticleCount: number;
        selectedTags: string[];
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
});

test('listing emphasis and pagination retain the tuned information hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(blogPath);

  const results = page.locator('[data-blog-results]');
  const resultCount = page.locator('[data-blog-result-count]');
  await expect(resultCount).toHaveText(/Articles: \d+ · Page 1 of 2/);
  await expect(page.locator('[data-blog-page-status]')).toHaveCount(0);

  const previous = page.locator('[data-blog-page="previous"]');
  const next = page.locator('[data-blog-page="next"]');
  await expect(previous).toBeHidden();
  await expect(next).toBeVisible();
  const firstResultsBox = await results.boundingBox();
  const nextBox = await next.boundingBox();
  expect(firstResultsBox).not.toBeNull();
  expect(nextBox).not.toBeNull();
  expect(
    Math.abs(nextBox!.x + nextBox!.width - (firstResultsBox!.x + firstResultsBox!.width)),
  ).toBeLessThan(1);
  const footerBox = await page.locator('.site-footer').boundingBox();
  expect(footerBox).not.toBeNull();
  expect(footerBox!.y - (nextBox!.y + nextBox!.height)).toBeGreaterThanOrEqual(60);

  const firstTitle = page.locator('.blog-article h2 a').first();
  await expect(firstTitle).toHaveCSS('text-decoration-line', 'none');
  await firstTitle.hover();
  await expect(firstTitle).toHaveCSS('text-decoration-line', 'underline');

  const selectedFilter = page.locator('[data-blog-tag-definition][data-tag-slug="astro"]');
  await selectedFilter.click();
  await expect(selectedFilter).toHaveCSS('font-weight', '700');
  const selectedArticleTag = page
    .locator('[data-blog-article]:not([hidden]) [data-blog-filter-link][data-selected]')
    .first();
  await expect(selectedArticleTag).toBeVisible();
  expect(
    await selectedArticleTag.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.color !== style.backgroundColor;
    }),
  ).toBe(true);

  await page.goto(`${blogPath}?page=2`);
  await expect(resultCount).toHaveText(/Articles: \d+ · Page 2 of 2/);
  await expect(previous).toBeVisible();
  await expect(next).toBeHidden();
  const secondResultsBox = await results.boundingBox();
  const previousBox = await previous.boundingBox();
  expect(secondResultsBox).not.toBeNull();
  expect(previousBox).not.toBeNull();
  expect(Math.abs(previousBox!.x - secondResultsBox!.x)).toBeLessThan(1);
});

test('the desktop sidebar resizes, collapses, and restores its geometry before paint', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(blogPath);

  const layout = page.locator('[data-blog-sidebar-layout]');
  const sidebar = page.locator('#blog-sidebar');
  await expect(sidebar).toHaveAccessibleName('Article tags');
  const results = page.locator('[data-blog-results]');
  const resizer = page.getByRole('separator', { name: 'Resize blog sidebar' });
  const collapse = page.getByRole('button', { name: 'Collapse blog sidebar' });

  const initialSidebar = await sidebar.boundingBox();
  const initialResults = await results.boundingBox();
  expect(initialSidebar).not.toBeNull();
  expect(initialResults).not.toBeNull();
  expect(initialSidebar!.width).toBeCloseTo(272, 0);
  expect(initialResults!.x - initialSidebar!.x - initialSidebar!.width).toBeCloseTo(40, 0);

  const resizerBox = await resizer.boundingBox();
  expect(resizerBox).not.toBeNull();
  const dragX = resizerBox!.x + resizerBox!.width / 2;
  const dragY = resizerBox!.y + Math.min(resizerBox!.height / 2, 220);
  await page.mouse.move(dragX, dragY);
  await page.mouse.down();
  await page.mouse.move(dragX + 48, dragY, { steps: 4 });
  await page.mouse.up();
  await expect(resizer).toHaveAttribute('aria-valuenow', '320');

  await resizer.focus();
  await resizer.press('Home');
  await expect(resizer).toHaveAttribute('aria-valuenow', '208');
  await resizer.press('End');
  await expect(resizer).toHaveAttribute('aria-valuenow', '400');

  const resetBox = await resizer.boundingBox();
  expect(resetBox).not.toBeNull();
  await page.mouse.move(resetBox!.x + resetBox!.width / 2, dragY);
  await page.mouse.down();
  await page.mouse.move(resetBox!.x + resetBox!.width / 2 - 80, dragY, { steps: 4 });
  await page.mouse.up();
  await expect(resizer).toHaveAttribute('aria-valuenow', '320');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('blog-sidebar-layout')))
    .toBe('{"collapsed":false,"width":320}');

  await page.addInitScript(() => {
    const probe = {
      frames: [] as Array<{
        resultsOffset: number;
        sidebarWidth: number;
        boundaryVisible: boolean;
        animating: boolean;
      }>,
      complete: false,
      attempts: 0,
    };
    Object.defineProperty(window, '__blogSidebarFrameProbe', {
      configurable: true,
      value: probe,
    });

    const sample = () => {
      probe.attempts += 1;
      const layout = document.querySelector<HTMLElement>('[data-blog-sidebar-layout]');
      const sidebar = document.querySelector<HTMLElement>('#blog-sidebar');
      const results = document.querySelector<HTMLElement>('[data-blog-results]');
      const boundary = document.querySelector<HTMLElement>('[data-blog-sidebar-boundary]');
      if (layout && sidebar && results && boundary) {
        const layoutBox = layout.getBoundingClientRect();
        const sidebarBox = sidebar.getBoundingClientRect();
        const resultsBox = results.getBoundingClientRect();
        const round = (value: number) => Math.round(value * 100) / 100;
        probe.frames.push({
          resultsOffset: round(resultsBox.x - layoutBox.x),
          sidebarWidth: round(sidebarBox.width),
          boundaryVisible: boundary.getClientRects().length > 0,
          animating: layout.hasAttribute('data-sidebar-animating'),
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

  await page.reload();
  const expandedFrames = await readSidebarFrames(page);
  expect(expandedFrames).toHaveLength(8);
  expect(expandedFrames.every((frame) => frame.resultsOffset === 360)).toBe(true);
  expect(expandedFrames.every((frame) => frame.sidebarWidth === 320)).toBe(true);
  expect(expandedFrames.every((frame) => frame.boundaryVisible && !frame.animating)).toBe(true);

  await collapse.click();
  await expect(layout).toHaveAttribute('data-sidebar-collapsed', '');
  await expect(sidebar).toHaveAttribute('inert', '');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('blog-sidebar-layout')))
    .toBe('{"collapsed":true,"width":320}');

  await page.reload();
  const collapsedFrames = await readSidebarFrames(page);
  expect(collapsedFrames).toHaveLength(8);
  expect(collapsedFrames.every((frame) => frame.resultsOffset === 40)).toBe(true);
  expect(collapsedFrames.every((frame) => frame.sidebarWidth === 320)).toBe(true);
  expect(collapsedFrames.every((frame) => !frame.boundaryVisible && !frame.animating)).toBe(true);
  await expect(page.getByRole('button', { name: 'Expand blog sidebar' })).toBeVisible();
});

test('sidebar scrolling is independent, restores on refresh, and cannot strand mobile tags', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto(blogPath);

  const panel = page.locator('[data-blog-mobile-panel]');
  const pageY = await page.evaluate(() => scrollY);
  await panel.evaluate((element) => element.scrollTo(0, 240));
  await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const savedPanelY = await panel.evaluate((element) => element.scrollTop);
  expect(await page.evaluate(() => scrollY)).toBe(pageY);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (history.state as { sshawn9?: { regions?: Record<string, { y?: number }> } } | null)
            ?.sshawn9?.regions?.['blog-sidebar-tags']?.y ?? 0,
      ),
    )
    .toBe(savedPanelY);

  await page.addInitScript(() => {
    const values: number[] = [];
    Object.defineProperty(window, '__blogScrollFrameProbe', {
      configurable: true,
      value: { values, complete: false },
    });
    const sample = () => {
      const panel = document.querySelector<HTMLElement>('[data-scroll-region="blog-sidebar-tags"]');
      if (panel) values.push(panel.scrollTop);
      if (values.length >= 8) {
        (
          window as Window & { __blogScrollFrameProbe?: { complete: boolean } }
        ).__blogScrollFrameProbe!.complete = true;
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

  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __blogScrollFrameProbe?: { complete: boolean };
            }
          ).__blogScrollFrameProbe?.complete ?? false,
      ),
    )
    .toBe(true);
  const restoredFrames = await page.evaluate(
    () =>
      (
        window as Window & {
          __blogScrollFrameProbe?: { values: number[] };
        }
      ).__blogScrollFrameProbe?.values ?? [],
  );
  expect(restoredFrames).toHaveLength(8);
  expect(restoredFrames.every((value) => value === savedPanelY)).toBe(true);

  await page.getByRole('button', { name: 'Collapse blog sidebar' }).click();
  await page.setViewportSize({ width: 760, height: 900 });
  const sidebar = page.getByRole('complementary', { name: 'Article tags' });
  const mobileToggle = page.getByRole('button', { name: 'Article tags' });
  const tagDefinitions = page.locator('[data-blog-tag-definition]');
  expect(await tagDefinitions.count()).toBeGreaterThan(0);
  await expect(sidebar).toBeVisible();
  await expect(sidebar).not.toHaveAttribute('aria-hidden', 'true');
  await expect(mobileToggle).toBeVisible();
  await expect(tagDefinitions.first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page
      .locator('.blog-tag-name')
      .evaluateAll((elements) =>
        elements.every((element) => element.scrollWidth <= element.clientWidth + 1),
      ),
  ).toBe(true);

  await mobileToggle.click();
  await expect(mobileToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(tagDefinitions.first()).toBeHidden();
  await mobileToggle.click();
  await expect(mobileToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(tagDefinitions.first()).toBeVisible();
});
