import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ timeout: 90_000 });

const viewports = [
  { width: 320, height: 720 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

const representativeRoutes = [
  '/en/',
  '/zh/blog/',
  '/en/search/?q=g',
  '/zh/projects/',
  '/zh/blog/frenet-arc-length-conversion/',
  '/en/blog/planar-frenet-frame/',
  '/en/blog/closed-loop-control-timing/',
  '/en/blog/my-personal-website/compare/?base=1&compare=2',
] as const;

async function waitForRouteEnhancement(page: Page, route: string): Promise<void> {
  if (route.includes('/search/')) {
    await expect(page.locator('[data-site-search]')).toHaveAttribute('data-search-ready', '');
    await expect(page.locator('.site-search-result__card').first()).toBeVisible();
  }
  if (route.includes('/compare/')) {
    await expect(page.locator('[data-diff-panel]')).toBeVisible();
  }
  if (route.includes('frenet-arc-length-conversion')) {
    const firstExplorer = page.locator('[data-frenet-explorer]').first();
    await firstExplorer.scrollIntoViewIfNeeded();
    await expect(firstExplorer.locator('.plot-container').first()).toBeVisible({
      timeout: 30_000,
    });
  }
  if (route.includes('planar-frenet-frame')) {
    await expect(page.locator('[data-plotly-figure] .plot-container').first()).toBeVisible({
      timeout: 30_000,
    });
  }
  if (route.includes('closed-loop-control-timing')) {
    await expect(page.locator('.closed-loop-control-timing-plot svg')).toBeVisible({
      timeout: 30_000,
    });
  }
}

async function responsiveGeometry(page: Page) {
  return page.evaluate(() => {
    const selectors = [
      '.site-header__inner',
      '.page-outlet',
      'main',
      '.site-footer .content-shell',
      '.blog-layout',
      '.blog-results-column',
      '.site-search-panel',
      '.site-search-result__card',
      '.project-card',
      '.article-layout',
      '.article-main',
      '.version-comparison',
      '[data-version-comparison-main]',
    ];
    const viewportWidth = document.documentElement.clientWidth;
    const outsideViewport: string[] = [];
    const overflowingElements: string[] = [];
    const wideContainers: string[] = [];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (box.left < -0.5 || box.right > viewportWidth + 0.5) {
          outsideViewport.push(
            `${selector}:${box.left.toFixed(1)}..${box.right.toFixed(1)}/${viewportWidth}`,
          );
        }
      }
    }

    if (document.body.scrollWidth > viewportWidth + 1) {
      for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
        const box = element.getBoundingClientRect();
        if (
          element.closest('.katex-mathml') ||
          box.width === 0 ||
          box.height === 0 ||
          box.right <= viewportWidth + 0.5
        ) {
          continue;
        }
        const name = [
          element.tagName.toLowerCase(),
          element.id ? `#${element.id}` : '',
          ...Array.from(element.classList, (className) => `.${className}`),
        ].join('');
        overflowingElements.push(
          `${name || element.tagName.toLowerCase()}:${box.left.toFixed(1)}..${box.right.toFixed(1)}`,
        );
        if (overflowingElements.length >= 12) break;
      }
      for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
        if (
          element.closest('.katex-mathml') ||
          element.scrollWidth <= element.clientWidth + 1
        ) {
          continue;
        }
        const name = [
          element.tagName.toLowerCase(),
          element.id ? `#${element.id}` : '',
          ...Array.from(element.classList, (className) => `.${className}`),
        ].join('');
        wideContainers.push(`${name}:${element.clientWidth}/${element.scrollWidth}`);
        if (wideContainers.length >= 12) break;
      }
    }

    return {
      rootClientWidth: viewportWidth,
      rootScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      outsideViewport,
      overflowingElements,
      wideContainers,
    };
  });
}

test('representative page families stay within every responsive geometry boundary', async ({
  page,
}) => {
  for (const route of representativeRoutes) {
    await page.setViewportSize(viewports.at(-1)!);
    await page.goto(route);
    await waitForRouteEnhancement(page, route);

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const geometry = await responsiveGeometry(page);
      expect(geometry.rootScrollWidth, `${route} at ${viewport.width}px`).toBeLessThanOrEqual(
        geometry.rootClientWidth + 1,
      );
      expect(geometry.overflowingElements, `${route} at ${viewport.width}px`).toEqual([]);
      expect(geometry.wideContainers, `${route} at ${viewport.width}px`).toEqual([]);
      expect(geometry.bodyScrollWidth, `${route} at ${viewport.width}px`).toBeLessThanOrEqual(
        geometry.rootClientWidth + 1,
      );
      expect(geometry.outsideViewport, `${route} at ${viewport.width}px`).toEqual([]);
    }
  }
});

test('header geometry is identical between short and long documents', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/en/about/');
  const shortDocumentHeader = await page.locator('.site-header__inner').boundingBox();

  await page.locator('[data-shell-sync-key="blog"]').click();
  await expect(page).toHaveURL(/\/en\/blog\/$/);
  const longDocumentHeader = await page.locator('.site-header__inner').boundingBox();

  expect(shortDocumentHeader).not.toBeNull();
  expect(longDocumentHeader).not.toBeNull();
  expect(longDocumentHeader?.x).toBeCloseTo(shortDocumentHeader?.x ?? 0, 1);
  expect(longDocumentHeader?.y).toBeCloseTo(shortDocumentHeader?.y ?? 0, 1);
  expect(longDocumentHeader?.width).toBeCloseTo(shortDocumentHeader?.width ?? 0, 1);
  expect(longDocumentHeader?.height).toBeCloseTo(shortDocumentHeader?.height ?? 0, 1);
});
