import { expect, test, type Page } from '@playwright/test';

const path = '/zh/blog/closed-loop-control-timing/';
const section = '与真实系统的区别';
const lastSection = '实际执行机构的固有特性';
const active = (page: Page) =>
  page.locator('#article-sidebar [data-article-toc] a[aria-current="location"]');
const link = (page: Page, slug: string) =>
  page
    .locator('#article-sidebar [data-article-toc]')
    .getByRole('link', { name: slug, exact: true });

async function expectAtPageEnd(page: Page) {
  // A fragment traversal can settle a few pixels away from the stored page-end coordinate.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        const tolerance = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
        return Math.max(0, maxScrollY - window.scrollY) - tolerance;
      }),
    )
    .toBeLessThanOrEqual(0);
}

async function settleToc(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

test('explicit page-end navigation yields to reading and restores the reading mode', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${path}#${encodeURIComponent(section)}`);
  await expect(page.locator('[data-article-page]')).toHaveAttribute(
    'data-article-runtime-ready',
    '',
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.abs(scrollY - (document.documentElement.scrollHeight - innerHeight)),
      ),
    )
    .toBeLessThan(1);
  // The fragment is visible, but the document is too short to align it at the top.
  expect(
    await page
      .locator(`[id="${section}"]`)
      .evaluate(
        (heading) =>
          heading.getBoundingClientRect().top -
          Number.parseFloat(getComputedStyle(heading).scrollMarginTop),
      ),
  ).toBeGreaterThan(1);
  await expect(active(page)).toHaveAttribute('data-toc-slug', section);
  const bottom = await page.evaluate(() => scrollY);

  await link(page, lastSection).click();
  await settleToc(page);
  await expect(active(page)).toHaveAttribute('data-toc-slug', lastSection);
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(bottom, 0);
  await link(page, section).click();
  await settleToc(page);
  await expect(active(page)).toHaveAttribute('data-toc-slug', section);

  // Another directory click at the same position must still be saved.
  await link(page, lastSection).click();
  await expect(active(page)).toHaveAttribute('data-toc-slug', lastSection);
  await settleToc(page);
  await page.reload();
  await expect(page.locator('[data-article-page]')).toHaveAttribute(
    'data-article-runtime-ready',
    '',
  );
  await expect(active(page)).toHaveAttribute('data-toc-slug', lastSection);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(bottom, 0);
  await page.goBack();
  await expect(active(page)).toHaveAttribute('data-toc-slug', section);
  await page.reload();
  await expect(page.locator('[data-article-page]')).toHaveAttribute(
    'data-article-runtime-ready',
    '',
  );
  await expect(active(page)).toHaveAttribute('data-toc-slug', section);
  await page.goForward();
  await expect(active(page)).toHaveAttribute('data-toc-slug', lastSection);
  await expectAtPageEnd(page);
  await page.goBack();
  await expect(active(page)).toHaveAttribute('data-toc-slug', section);

  await link(page, lastSection).click();
  await settleToc(page);
  await expect(active(page)).toHaveAttribute('data-toc-slug', lastSection);
  const sectionHeading = page.locator(`[id="${section}"]`);
  await sectionHeading.evaluate((heading) => {
    const header = document.querySelector<HTMLElement>('.site-header');
    const readingTop = Math.max(header?.getBoundingClientRect().bottom ?? 0, 0);
    const targetTop = readingTop + 200;
    window.scrollTo({
      top: window.scrollY + heading.getBoundingClientRect().top - targetTop,
      behavior: 'instant',
    });
  });
  await settleToc(page);
  await expect(sectionHeading).toBeInViewport();
  await sectionHeading.hover();
  await page.mouse.wheel(0, -32);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(bottom - 100);
  await expect(active(page)).toHaveAttribute('data-toc-slug', section);
  await expect
    .poll(() => page.evaluate(() => decodeURIComponent(location.hash.slice(1))))
    .toBe(lastSection);

  // Returning and reloading at the same position must not revive the stale URL target.
  await page.mouse.wheel(0, 1000);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(bottom, 0);
  await expect(active(page)).toHaveAttribute('data-toc-slug', section);
  await page.reload();
  await expect(page.locator('[data-article-page]')).toHaveAttribute(
    'data-article-runtime-ready',
    '',
  );
  await expect(active(page)).toHaveAttribute('data-toc-slug', section);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(bottom, 0);
});

test('reading uses the first visible heading or the current chapter when no heading is visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await expect(page.locator('[data-article-page]')).toHaveAttribute(
    'data-article-runtime-ready',
    '',
  );
  // Fixed content geometry makes this independent of edits to published articles.
  await page.evaluate(() => {
    document.documentElement.style.overflowAnchor = 'none';
    document.querySelector('.article-prose')!.innerHTML = `
      <h2 id="reading-parent">Parent introduction</h2><div id="reading-parent-body" style="height:900px"></div>
      <h3 id="reading-hidden" hidden>Hidden heading</h3>
      <h3 id="reading-child">Child section</h3><div style="height:1600px"></div>
      <h2 id="reading-next">Next section</h2><div style="height:900px"></div>`;
    for (const toc of document.querySelectorAll('[data-article-toc]')) {
      toc.innerHTML = `<ul class="article-toc-list">
        <li><a href="#reading-parent" data-toc-slug="reading-parent">Parent introduction</a></li>
        <li><a href="#reading-child" data-toc-slug="reading-child">Child section</a></li>
        <li><a href="#reading-next" data-toc-slug="reading-next">Next section</a></li></ul>`;
    }
  });
  const child = page.locator('#reading-child');
  const placeChildAt = async (top: number) => {
    await child.evaluate((heading, top) => {
      scrollTo({ top: scrollY + heading.getBoundingClientRect().top - top, behavior: 'instant' });
    }, top);
    await expect
      .poll(() => child.evaluate((heading) => heading.getBoundingClientRect().top))
      .toBeCloseTo(top, 0);
  };
  await placeChildAt(200);
  await expect(active(page)).toHaveAttribute('data-toc-slug', 'reading-child');
  await placeChildAt(700);
  // The parent occupies more space, but the first visible heading is the child.
  await expect(active(page)).toHaveAttribute('data-toc-slug', 'reading-child');

  await placeChildAt(-200);
  // A long section can fill the viewport with prose and no visible heading.
  await expect(active(page)).toHaveAttribute('data-toc-slug', 'reading-child');
  await placeChildAt(1000);
  // Scrolling upward into the parent's prose must release the previous child.
  await expect(active(page)).toHaveAttribute('data-toc-slug', 'reading-parent');

  const beforeResize = await page.evaluate(() => scrollY);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await expect(active(page)).toHaveAttribute('data-toc-slug', 'reading-child');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(active(page)).toHaveAttribute('data-toc-slug', 'reading-parent');
  await page.locator('#reading-parent-body').evaluate((body) => {
    body.style.height = '500px';
  });
  await expect(active(page)).toHaveAttribute('data-toc-slug', 'reading-child');
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(beforeResize, 0);
});

test('scrolling the sidebar during a smooth chapter jump preserves the selected chapter', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto(path);
  await expect(page.locator('[data-article-page]')).toHaveAttribute(
    'data-article-runtime-ready',
    '',
  );
  const sidebar = page.locator('[data-scroll-region="article-sidebar"]');
  const target = link(page, lastSection);
  await expect(target).toBeInViewport();
  await target.click();
  await page.waitForFunction(
    () => scrollY > 100 && scrollY < document.documentElement.scrollHeight - innerHeight - 100,
  );
  await sidebar.hover();
  await page.mouse.wheel(0, -100);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.abs(scrollY - (document.documentElement.scrollHeight - innerHeight)),
      ),
    )
    .toBeLessThan(1);
  await expect(active(page)).toHaveAttribute('data-toc-slug', lastSection);

  // The same input over the prose must hand control back to manual reading.
  await page.locator(`[id="${section}"]`).hover();
  await page.mouse.wheel(0, -250);
  await expect(active(page)).toHaveAttribute('data-toc-slug', section);
});

test('cross-page traversal leaves the outgoing article selection alone until swap', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto(`${path}#${encodeURIComponent(lastSection)}`);
  await expect(page.locator('[data-article-page]')).toHaveAttribute(
    'data-article-runtime-ready',
    '',
  );
  await expect(active(page)).toHaveAttribute('data-toc-slug', lastSection);
  await page.locator('.site-header__nav-link[href="/zh/about/"]').click();
  await expect(page).toHaveURL(/\/zh\/about\/$/);
  await page.goBack();
  await expect(page.locator('[data-article-page]')).toHaveAttribute(
    'data-article-runtime-ready',
    '',
  );
  await expect(active(page)).toHaveAttribute('data-toc-slug', lastSection);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/zh/about/', async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  try {
    const request = page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/zh/about/',
    );
    await page.goForward();
    await request;
    await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
    await expect(active(page)).toHaveAttribute('data-toc-slug', lastSection);
    release();
    await expect(page.locator('[data-article-page]')).toHaveCount(0);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});
