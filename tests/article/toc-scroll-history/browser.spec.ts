import { expect, test } from '@playwright/test';

const articlePath = '/en/blog/git-operations-reference/';

test('the static TOC synchronizes fragment state and restores page scroll across refresh', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 560 });
  await page.goto(articlePath);

  const tocRegion = page.locator('[data-scroll-region="article-sidebar"]');
  const pageYBeforeNestedScroll = await page.evaluate(() => scrollY);
  await tocRegion.hover();
  await page.mouse.wheel(0, 180);
  await expect.poll(() => tocRegion.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(pageYBeforeNestedScroll);

  await tocRegion.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  const pageYBeforeBoundaryWheel = await page.evaluate(() => scrollY);
  await tocRegion.hover();
  await page.mouse.wheel(0, 180);
  expect(await page.evaluate(() => scrollY)).toBe(pageYBeforeBoundaryWheel);

  await page.locator('.article-main').hover();
  await page.mouse.wheel(0, 180);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(pageYBeforeNestedScroll);

  const tocLinks = page.locator('#article-sidebar [data-article-toc] a[data-toc-slug]');
  const targetLink = tocLinks.nth(Math.floor((await tocLinks.count()) * 0.65));
  const targetSlug = await targetLink.getAttribute('data-toc-slug');
  expect(targetSlug).toBeTruthy();
  const tocGeometryBeforeSelection = await tocLinks.evaluateAll((links) =>
    links.map((link) => ({
      slug: (link as HTMLElement).dataset.tocSlug,
      offsetTop: (link as HTMLElement).offsetTop,
      offsetHeight: (link as HTMLElement).offsetHeight,
    })),
  );
  await targetLink.evaluate((link) => link.setAttribute('data-identity-probe', 'original'));
  await targetLink.click();

  await expect(page).toHaveURL(new RegExp(`#${targetSlug}$`));
  await expect(
    page.locator(`#article-sidebar [data-article-toc] a[data-toc-slug="${targetSlug}"]`),
  ).toHaveAttribute('aria-current', 'location');
  await expect(targetLink).toHaveAttribute('data-identity-probe', 'original');
  expect(
    await tocLinks.evaluateAll((links) =>
      links.map((link) => ({
        slug: (link as HTMLElement).dataset.tocSlug,
        offsetTop: (link as HTMLElement).offsetTop,
        offsetHeight: (link as HTMLElement).offsetHeight,
      })),
    ),
  ).toEqual(tocGeometryBeforeSelection);
  await expect
    .poll(() =>
      page.locator(`#${targetSlug}`).evaluate((heading) => {
        const offset = Number.parseFloat(getComputedStyle(heading).scrollMarginTop);
        return Math.abs(heading.getBoundingClientRect().top - offset);
      }),
    )
    .toBeLessThan(2);

  const settledPageY = await page.evaluate(() => scrollY);
  const settledTocY = await tocRegion.evaluate((element) => element.scrollTop);
  expect(settledPageY).toBeGreaterThan(0);
  expect(settledTocY).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (history.state as { sshawn9?: { page?: { y?: number } } } | null)?.sshawn9?.page?.y ?? 0,
      ),
    )
    .toBeCloseTo(settledPageY, 0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (history.state as { sshawn9?: { regions?: Record<string, { y?: number }> } } | null)
            ?.sshawn9?.regions?.['article-sidebar']?.y ?? 0,
      ),
    )
    .toBeCloseTo(settledTocY, 0);
  await page.addInitScript(() => {
    const observer = new PerformanceObserver((entries, paintObserver) => {
      if (!entries.getEntries().some((entry) => entry.name === 'first-contentful-paint')) return;
      paintObserver.disconnect();
      const active = document.querySelector<HTMLElement>(
        '#article-sidebar [data-article-toc] a[data-active]',
      );
      const historyY =
        (history.state as { sshawn9?: { page?: { y?: number } } } | null)?.sshawn9?.page?.y ?? 0;
      const toc = document.querySelector<HTMLElement>('[data-scroll-region="article-sidebar"]');
      const historyTocY =
        (
          history.state as {
            sshawn9?: { regions?: Record<string, { y?: number }> };
          } | null
        )?.sshawn9?.regions?.['article-sidebar']?.y ?? 0;
      sessionStorage.setItem(
        'article-reload-first-frame',
        JSON.stringify({
          active: active?.dataset.tocSlug ?? '',
          historyY,
          historyTocY,
          scrollY,
          tocY: toc?.scrollTop ?? 0,
        }),
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
        historyTocY: number;
        scrollY: number;
        tocY: number;
      },
  );
  expect(firstFrame.historyY).toBeCloseTo(settledPageY, 0);
  expect(firstFrame.scrollY).toBeCloseTo(settledPageY, 0);
  expect(firstFrame.historyTocY).toBeCloseTo(settledTocY, 0);
  expect(firstFrame.tocY).toBeCloseTo(settledTocY, 0);
  expect(firstFrame.active).toBe(targetSlug);
  await expect(page.locator(`#article-sidebar [data-toc-slug="${targetSlug}"]`)).toHaveAttribute(
    'aria-current',
    'location',
  );

  // The sticky header is reachable without scrolling back to the breadcrumbs,
  // which would legitimately change both the active section and its TOC position.
  await page.locator('.site-header__nav-link[href="/en/blog/"]').click();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[data-article-page]')) return;
      observer.disconnect();
      const samples: number[] = [];
      const sample = () => {
        const region = document.querySelector<HTMLElement>(
          '[data-scroll-region="article-sidebar"]',
        );
        if (region) samples.push(region.scrollTop);
        if (samples.length < 8) requestAnimationFrame(sample);
        else document.documentElement.dataset.articleTocTraversalSamples = JSON.stringify(samples);
      };
      requestAnimationFrame(sample);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#${targetSlug}$`));
  await expect(page.locator('html')).toHaveAttribute('data-article-toc-traversal-samples', /\[/);
  const traversalSamples = await page
    .locator('html')
    .evaluate((root) =>
      JSON.parse((root as HTMLElement).dataset.articleTocTraversalSamples ?? '[]'),
    );
  expect(traversalSamples).toHaveLength(8);
  expect(traversalSamples.every((value: number) => Math.abs(value - settledTocY) < 1)).toBe(true);
});
