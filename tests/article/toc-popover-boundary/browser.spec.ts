import { expect, test, type CDPSession, type Page } from '@playwright/test';

const articlePath = '/en/blog/git-operations-reference/';
const versionedArticlePath = '/en/blog/my-personal-website/';

async function installMissingPopoverBoundary(page: Page) {
  await page.addInitScript(() => {
    // Reproduce the missing JS surface, not an entire legacy browser engine.
    for (const name of ['showPopover', 'hidePopover', 'togglePopover']) {
      Reflect.deleteProperty(HTMLElement.prototype, name);
    }
    const matches = Element.prototype.matches;
    Element.prototype.matches = function (this: Element, selector: string) {
      if (selector.includes(':popover-open')) {
        throw new DOMException('Unsupported selector: :popover-open', 'SyntaxError');
      }
      return matches.call(this, selector);
    } as typeof matches;
    Object.assign(window, { articleBoundaryDocument: Math.random(), articleBoundaryReady: false });
    document.addEventListener('site:runtime-ready', () => {
      Object.assign(window, { articleBoundaryReady: true });
    });
  });
}

async function expectRuntimeReady(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { articleBoundaryReady?: boolean }).articleBoundaryReady,
      ),
    )
    .toBe(true);
}

async function expectDesktopTocUsable(page: Page) {
  await expect(page.locator('[data-article-page]')).toHaveAttribute(
    'data-article-runtime-ready',
    '',
  );
  await expect(page.locator('[data-article-mobile-toc-toggle]')).toBeHidden();
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending');
  await expect(page.locator('main')).not.toHaveAttribute('aria-busy', 'true');

  const links = page.locator('#article-sidebar [data-article-toc] a[data-toc-slug]');
  const link = links.nth(Math.floor((await links.count()) / 2));
  const slug = await link.getAttribute('data-toc-slug');
  expect(slug).toBeTruthy();
  await link.click();
  await expect
    .poll(() => page.evaluate(() => decodeURIComponent(location.hash.slice(1))))
    .toBe(slug);
  await expect(link).toHaveAttribute('aria-current', 'location');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
}

async function expectNativeDisclosure(
  page: Page,
  accessibility: CDPSession,
  selector: string,
  expanded: boolean,
) {
  // Read Chromium's actual accessibility tree: native Popover state need not
  // exist as an aria-expanded DOM attribute or in a JS-computed ARIA snapshot.
  await expect
    .poll(async () => {
      const { root } = await accessibility.send('DOM.getDocument');
      const { nodeId } = await accessibility.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector,
      });
      const { nodes } = await accessibility.send('Accessibility.getPartialAXTree', {
        nodeId,
        fetchRelatives: false,
      });
      return nodes[0]?.properties?.find((property) => property.name === 'expanded')?.value.value;
    })
    .toBe(expanded);
  await expect(page.locator(selector).locator('span')).toHaveCSS(
    'transform',
    expanded ? 'matrix(-1, 0, 0, -1, 0, 0)' : 'none',
  );
}

test('a cold wide article initializes and its desktop TOC works without Popover JS support', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMissingPopoverBoundary(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(versionedArticlePath);
  await expectRuntimeReady(page);
  await expectDesktopTocUsable(page);
  expect(errors).toEqual([]);
});

test('a wide SPA article finishes navigation without touching unsupported hidden TOC state', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMissingPopoverBoundary(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/en/blog/');
  await expectRuntimeReady(page);
  const documentIdentity = await page.evaluate(
    () => (window as Window & { articleBoundaryDocument?: number }).articleBoundaryDocument,
  );
  await page.getByRole('link', { name: 'Git Operations Reference', exact: true }).click();
  await expect(page).toHaveURL(articlePath);
  await expectDesktopTocUsable(page);
  expect(
    await page.evaluate(
      () => (window as Window & { articleBoundaryDocument?: number }).articleBoundaryDocument,
    ),
  ).toBe(documentIdentity);
  expect(errors).toEqual([]);
});

test('the mobile TOC exposes native expanded state and closes after following a section link', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(articlePath);
  await expect(page.locator('[data-article-page]')).toHaveAttribute(
    'data-article-runtime-ready',
    '',
  );
  const accessibility = await page.context().newCDPSession(page);
  try {
    await accessibility.send('Accessibility.enable');
    const selector = '[data-article-mobile-toc-toggle]';
    const toggle = page.locator(selector);
    const popup = page.locator('#article-toc-mobile');
    await expectNativeDisclosure(page, accessibility, selector, false);
    await toggle.click();
    await expect(popup).toBeVisible();
    await expectNativeDisclosure(page, accessibility, selector, true);
    const link = popup.locator('a[data-toc-slug]').nth(2);
    const slug = await link.getAttribute('data-toc-slug');
    expect(slug).toBeTruthy();
    await link.click();
    await expect
      .poll(() => page.evaluate(() => decodeURIComponent(location.hash.slice(1))))
      .toBe(slug);
    await expect(popup).toBeHidden();
    await expectNativeDisclosure(page, accessibility, selector, false);
  } finally {
    await accessibility.detach();
  }
});

test('desktop and narrow version buttons retain native expanded state and arrow feedback', async ({
  page,
}) => {
  const accessibility = await page.context().newCDPSession(page);
  try {
    await accessibility.send('Accessibility.enable');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(versionedArticlePath);
      await expect(page.locator('[data-article-page]')).toHaveAttribute(
        'data-article-runtime-ready',
        '',
      );
      const container = width === 1440 ? '#article-sidebar' : '.article-mobile-support';
      const selector = `${container} [data-article-popover-toggle]`;
      const toggle = page.locator(selector);
      const target = await toggle.getAttribute('popovertarget');
      expect(target).toBeTruthy();
      const popup = page.locator(`#${target}`);
      await expectNativeDisclosure(page, accessibility, selector, false);
      await toggle.click();
      await expect(popup).toBeVisible();
      await expectNativeDisclosure(page, accessibility, selector, true);
      await toggle.press('Enter');
      await expect(popup).toBeHidden();
      await expectNativeDisclosure(page, accessibility, selector, false);
    }
  } finally {
    await accessibility.detach();
  }
});
