import { expect, test, type Page } from '@playwright/test';

const articlePath = '/en/blog/git-operations-reference/';
const versionedArticlePath = '/en/blog/my-personal-website/';
const comparisonPath = `${versionedArticlePath}compare/?base=1&compare=2`;

async function visibleLocator(page: Page, selector: string) {
  return page.locator(`${selector}:visible`);
}

test('article support, historical snapshots, and comparison fallback exist in generated documents', async ({
  request,
}) => {
  const currentHtml = await (await request.get(versionedArticlePath)).text();
  expect(currentHtml).toContain('From Jekyll to Astro: Rebuilding My Personal Website');
  expect(currentHtml).toContain('class="article-sidebar-shell"');
  expect(currentHtml).toContain('href="/en/blog/my-personal-website/v/1/"');

  const historicalHtml = await (await request.get('/en/blog/my-personal-website/v/1/')).text();
  expect(historicalHtml).toContain('content="noindex, follow"');
  expect(historicalHtml).toContain('My GitHub Pages');
  expect(historicalHtml).toContain('data-current-version');
  expect(historicalHtml).toContain('#Jekyll');
  expect(historicalHtml).toContain('#GitHub Pages');

  const comparisonHtml = await (await request.get(comparisonPath)).text();
  expect(comparisonHtml).toContain('version-comparison-static-fallback');
  expect(comparisonHtml).toContain('interactive diff needs JavaScript');
  expect(comparisonHtml).toContain('href="/en/blog/my-personal-website/v/1/"');
  expect(comparisonHtml).toContain('href="/en/blog/my-personal-website/"');

  const response = await request.get(articlePath);
  const html = await response.text();
  const articleHeader = html.indexOf('<header class="article-header"');
  const articleInformation = html.indexOf('class="article-sidebar-shell"');
  const articleBody = html.indexOf('class="article-main"');
  expect(articleHeader).toBeGreaterThan(0);
  expect(articleInformation).toBeGreaterThan(articleHeader);
  expect(articleBody).toBeGreaterThan(articleInformation);
  expect(html).not.toContain('VersionComparison');
});

test('the article sidebar resizes, collapses, and restores before paint', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(articlePath);

  const layout = page.locator('[data-article-sidebar-layout]');
  const sidebar = page.locator('#article-sidebar');
  const resizer = page.getByRole('separator', { name: 'Resize article sidebar' });
  await expect(sidebar).toHaveAccessibleName('Article information and navigation');
  await expect(resizer).toHaveAttribute('aria-valuenow', '224');

  await resizer.focus();
  await resizer.press('End');
  await expect(resizer).toHaveAttribute('aria-valuenow', '352');
  await resizer.press('ArrowRight');
  await resizer.press('ArrowRight');
  await expect(resizer).toHaveAttribute('aria-valuenow', '320');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('article-sidebar-layout')))
    .toBe('{"collapsed":false,"width":320}');

  await page.getByRole('button', { name: 'Collapse article sidebar' }).click();
  await expect(layout).toHaveAttribute('data-sidebar-collapsed', '');
  await expect(sidebar).toHaveAttribute('inert', '');

  await page.addInitScript(() => {
    const probe = { frames: [] as Array<{ collapsed: boolean; track: string }>, attempts: 0 };
    Object.defineProperty(window, '__articleSidebarFrameProbe', {
      configurable: true,
      value: probe,
    });
    const sample = () => {
      probe.attempts += 1;
      const layout = document.querySelector<HTMLElement>('[data-article-sidebar-layout]');
      if (layout) {
        probe.frames.push({
          collapsed: document.documentElement.hasAttribute('data-article-sidebar-collapsed'),
          track: getComputedStyle(layout).gridTemplateColumns,
        });
      }
      if (probe.frames.length < 8 && probe.attempts < 120) requestAnimationFrame(sample);
    };
    const observer = new PerformanceObserver((entries, paintObserver) => {
      if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      paintObserver.disconnect();
      requestAnimationFrame(sample);
    });
    observer.observe({ type: 'paint', buffered: true });
  });

  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as Window & {
              __articleSidebarFrameProbe?: { frames: Array<{ collapsed: boolean }> };
            }
          ).__articleSidebarFrameProbe?.frames.length ?? 0,
      ),
    )
    .toBe(8);
  const frames = await page.evaluate(
    () =>
      (
        window as Window & {
          __articleSidebarFrameProbe?: {
            frames: Array<{ collapsed: boolean; track: string }>;
          };
        }
      ).__articleSidebarFrameProbe?.frames ?? [],
  );
  expect(frames.every((frame) => frame.collapsed)).toBe(true);
  expect(frames.every((frame) => frame.track.endsWith('0px'))).toBe(true);

  await page.setViewportSize({ width: 760, height: 900 });
  await expect(layout).not.toHaveAttribute('data-sidebar-collapsed', '');
  await expect(page.locator('.article-mobile-support')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('button', { name: 'Expand article sidebar' })).toBeVisible();
});

test('the static TOC keeps page and nested scrolling synchronized across refresh', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 560 });
  await page.goto(articlePath);

  const tocRegion = page.locator('[data-scroll-region="article-sidebar"]');
  const pageYBeforeNestedScroll = await page.evaluate(() => scrollY);
  await tocRegion.evaluate((element) => element.scrollTo(0, 180));
  await expect.poll(() => tocRegion.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(pageYBeforeNestedScroll);

  const tocLinks = page.locator('#article-sidebar [data-article-toc] a[data-toc-slug]');
  const targetLink = tocLinks.nth(Math.floor((await tocLinks.count()) * 0.65));
  const targetSlug = await targetLink.getAttribute('data-toc-slug');
  expect(targetSlug).toBeTruthy();
  await targetLink.evaluate((link) => link.setAttribute('data-identity-probe', 'original'));
  await targetLink.click();

  await expect(page).toHaveURL(new RegExp(`#${targetSlug}$`));
  await expect(
    page.locator(`#article-sidebar [data-article-toc] a[data-toc-slug="${targetSlug}"]`),
  ).toHaveAttribute('aria-current', 'location');
  await expect(targetLink).toHaveAttribute('data-identity-probe', 'original');
  await expect
    .poll(() =>
      page.locator(`#${targetSlug}`).evaluate((heading) => {
        const offset = Number.parseFloat(getComputedStyle(heading).scrollMarginTop);
        return Math.abs(heading.getBoundingClientRect().top - offset);
      }),
    )
    .toBeLessThan(2);

  const settledPageY = await page.evaluate(() => scrollY);
  expect(settledPageY).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (history.state as { sshawn9?: { page?: { y?: number } } } | null)?.sshawn9?.page?.y ?? 0,
      ),
    )
    .toBeCloseTo(settledPageY, 0);
  await page.addInitScript(() => {
    const observer = new PerformanceObserver((entries, paintObserver) => {
      if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      paintObserver.disconnect();
      const active = document.querySelector<HTMLElement>(
        '#article-sidebar [data-article-toc] a[data-active]',
      );
      const historyY =
        (history.state as { sshawn9?: { page?: { y?: number } } } | null)?.sshawn9?.page?.y ?? 0;
      sessionStorage.setItem(
        'article-reload-first-frame',
        JSON.stringify({ active: active?.dataset.tocSlug ?? '', historyY, scrollY }),
      );
    });
    observer.observe({ type: 'paint', buffered: true });
  });

  await page.reload();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('article-reload-first-frame')))
    .not.toBeNull();
  const firstFrame = await page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem('article-reload-first-frame') ?? '{}') as {
        active: string;
        historyY: number;
        scrollY: number;
      },
  );
  expect(firstFrame.historyY).toBeCloseTo(settledPageY, 0);
  expect(firstFrame.scrollY).toBeCloseTo(settledPageY, 0);
  expect(firstFrame.active).toBe(targetSlug);
  await expect(page.locator(`#article-sidebar [data-toc-slug="${targetSlug}"]`)).toHaveAttribute(
    'aria-current',
    'location',
  );
});

test('version comparison loads only on its route and follows container width until overridden', async ({
  page,
}) => {
  const requestedSources: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/compare/data/')) requestedSources.push(request.url());
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(versionedArticlePath);
  expect(requestedSources).toEqual([]);

  await page.goto(comparisonPath);
  await expect(page.locator('[data-version-comparison]')).toBeVisible();
  await expect(page.locator('[data-diff-panel="split"]')).toBeVisible();
  expect(
    await page.locator('[data-version-comparison-main]').evaluate((main) => main.clientWidth),
  ).toBeGreaterThanOrEqual(760);
  expect(requestedSources).toHaveLength(2);

  const unifiedButton = await visibleLocator(page, '[data-diff-mode="unified"]');
  await unifiedButton.click();
  await expect(page.locator('[data-diff-panel="unified"]')).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.locator('[data-diff-panel="unified"]')).toBeVisible();
  expect(
    await page.locator('[data-version-comparison-main]').evaluate((main) => main.clientWidth),
  ).toBeLessThan(760);

  await page.reload();
  await expect(page.locator('[data-diff-panel="unified"]')).toBeVisible();
  const splitButton = await visibleLocator(page, '[data-diff-mode="split"]');
  await splitButton.click();
  await expect(page.locator('[data-diff-panel="split"]')).toBeVisible();
});
