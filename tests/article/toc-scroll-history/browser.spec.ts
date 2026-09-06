import { expect, test } from '@playwright/test';

const articlePath = '/en/blog/git-operations-reference/';

test('the static TOC synchronizes fragment state and restores page scroll across refresh', async ({
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
