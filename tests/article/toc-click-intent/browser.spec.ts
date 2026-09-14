import { expect, test, type Page } from '@playwright/test';

const articlePath = '/en/blog/git-operations-reference/';
const tocLinks = '#article-sidebar [data-article-toc] a[data-toc-slug]';

test.beforeEach(async ({ context }) => {
  // Popups share these routes too; none of these cases needs the live wallpaper API.
  await context.route('**/api/wallpapers', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
});

async function openArticle(page: Page, path = articlePath) {
  await page.goto(path);
  await expect(page.locator('[data-article-page]')).toHaveAttribute(
    'data-article-runtime-ready',
    '',
  );
}

async function readPosition(page: Page) {
  return page.evaluate(() => ({
    href: location.href,
    pageY: scrollY,
    tocY: document.querySelector<HTMLElement>('[data-scroll-region="article-sidebar"]')?.scrollTop,
    active: Array.from(
      document.querySelectorAll<HTMLElement>('[data-article-toc] [data-active]'),
    ).map((link) => link.dataset.tocSlug),
  }));
}

async function desktopTarget(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArticle(page);
  const link = page.locator(tocLinks).nth(2);
  // Do not let Playwright's automatic scrolling change the baseline geometry.
  await expect(link).toBeInViewport();
  await expect(link).not.toHaveAttribute('aria-current', 'location');
  return link;
}

for (const mode of ['Control', 'middle', 'blank'] as const) {
  test(`${mode} TOC activation opens the destination without changing the original article`, async ({
    page,
  }) => {
    const link = await desktopTarget(page);
    if (mode === 'blank') await link.evaluate((link) => link.setAttribute('target', '_blank'));
    const slug = (await link.getAttribute('data-toc-slug'))!;
    const href = new URL((await link.getAttribute('href'))!, page.url()).href;
    const before = await readPosition(page);
    let popup: Page | undefined;
    try {
      [popup] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 5_000 }),
        link.click(
          mode === 'Control'
            ? { modifiers: ['Control'] }
            : mode === 'middle'
              ? { button: 'middle' }
              : {},
        ),
      ]);
      await expect(popup).toHaveURL(href);
      await expect(popup.locator(`[id="${slug}"]`)).toBeInViewport();
      expect(await readPosition(page)).toEqual(before);
    } finally {
      await popup?.close();
    }
  });
}

test('a click cancelled at the link leaves the current TOC state unchanged', async ({ page }) => {
  const link = await desktopTarget(page);
  const before = await readPosition(page);
  await link.evaluate((link) =>
    link.addEventListener('click', (event) => event.preventDefault(), { once: true }),
  );
  await link.click();
  expect(await readPosition(page)).toEqual(before);
});

const ignoredActivations: Array<{
  name: string;
  event?: MouseEventInit;
  href?: string;
  download?: boolean;
}> = [
  { name: 'Meta modifier', event: { metaKey: true } },
  { name: 'Shift modifier', event: { shiftKey: true } },
  { name: 'Alt modifier', event: { altKey: true } },
  { name: 'a non-primary click event', event: { button: 1 } },
  { name: 'a download link', download: true },
  { name: 'a different article', href: '/en/about/' },
  { name: 'a different query', href: '?different=1' },
  { name: 'a mismatched fragment', href: '#not-the-declared-section' },
  { name: 'a malformed encoded fragment', href: '#%E0%A4%A' },
];

for (const activation of ignoredActivations) {
  test(`the TOC ignores ${activation.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const link = await desktopTarget(page);
    const before = await readPosition(page);
    await link.evaluate((link, { href, download }) => {
      if (href) {
        const destination = new URL(href, location.href);
        if (!destination.hash) destination.hash = new URL((link as HTMLAnchorElement).href).hash;
        link.setAttribute('href', destination.href);
      }
      if (download) link.setAttribute('download', 'article.html');
    }, activation);
    // This runs after the TOC's article listener but before Astro's document
    // listener, preventing unrelated navigation/downloads in these guard tests.
    await page.locator('[data-article-page]').evaluate((article) => {
      article.addEventListener('click', (event) => event.preventDefault(), { once: true });
    });
    await link.dispatchEvent('click', {
      bubbles: true,
      cancelable: true,
      button: 0,
      ...activation.event,
    });
    expect(await readPosition(page)).toEqual(before);
    expect(errors).toEqual([]);
  });
}

test('keyboard activation still follows a percent-encoded Chinese section link', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openArticle(page, '/zh/blog/git-operations-reference/');
  const link = page.locator(tocLinks).filter({ hasText: /^工作区状态$/ });
  const slug = (await link.getAttribute('data-toc-slug'))!;
  expect(slug).toMatch(/[^\x00-\x7F]/);
  await link.evaluate((link) => {
    link.setAttribute('href', `#${encodeURIComponent(link.getAttribute('data-toc-slug')!)}`);
    link.setAttribute('target', '_self');
  });
  await link.focus();
  await expect(link).not.toHaveAttribute('aria-current', 'location');
  await link.evaluate((link) => {
    // Registered after the TOC handler on the same article, before Astro's
    // document listener can navigate and scroll-based reconciliation can run.
    link.closest('[data-article-page]')!.addEventListener(
      'click',
      () => {
        link.setAttribute('data-toc-click-current', link.getAttribute('aria-current') ?? '');
      },
      { once: true },
    );
  });
  await link.press('Enter');
  await expect(link).toHaveAttribute('data-toc-click-current', 'location');
  await expect
    .poll(() => page.evaluate(() => decodeURIComponent(location.hash.slice(1))))
    .toBe(slug);
  await expect(link).toHaveAttribute('aria-current', 'location');
  await expect(page.locator(`[id="${slug}"]`)).toBeInViewport();
});

test.describe('touch TOC activation', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a cancelled tap keeps the mobile TOC open and a later valid tap closes it', async ({
    page,
  }) => {
    await openArticle(page);
    await page.locator('[data-article-mobile-toc-toggle]').tap();
    const popup = page.locator('#article-toc-mobile');
    await expect(popup).toBeVisible();
    const link = popup.locator('a[data-toc-slug]').nth(2);
    const slug = (await link.getAttribute('data-toc-slug'))!;
    const before = await readPosition(page);
    await link.evaluate((link) =>
      link.addEventListener('click', (event) => event.preventDefault(), { once: true }),
    );
    await link.tap();
    await expect(popup).toBeVisible();
    expect(await readPosition(page)).toEqual(before);
    await link.tap();
    await expect(popup).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => decodeURIComponent(location.hash.slice(1))))
      .toBe(slug);
    await expect(link).toHaveAttribute('aria-current', 'location');
    await expect(page.locator(`[id="${slug}"]`)).toBeInViewport();
  });
});
