import { expect, test, type Page } from '@playwright/test';

const articlePath = '/en/blog/git-operations-reference/';
const blogPath = '/en/blog/';
const headingSelector = '.article-prose :is(h2[id], h3[id])';
type FailureStage = 'toc' | 'after-swap' | 'loader';
type FailureSnapshot = {
  documentId: string;
  failures: number;
  runtimeReady: number;
  hiddenTargetOpacity?: string;
  owners: Array<{ sidebarAborted?: boolean; tocAborted?: boolean; connected: boolean }>;
};

declare global {
  interface Window {
    __initializationFailure: { read(): FailureSnapshot };
  }
}

test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });

async function installFailure(page: Page, stage: FailureStage) {
  const message = `A01 controlled ${stage} initialization failure`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ stage, message, articlePath, blogPath, headingSelector }) => {
      const documentId = crypto.randomUUID();
      let failures = 0;
      let runtimeReady = 0;
      let armed = false;
      let hiddenTargetOpacity: string | undefined;
      const owners = new Map<HTMLElement, { sidebar?: AbortSignal; toc?: AbortSignal }>();
      const fail = () => {
        armed = false;
        failures++;
        throw new Error(message);
      };
      const owner = (article: HTMLElement) => {
        let value = owners.get(article);
        if (!value) owners.set(article, (value = {}));
        return value;
      };
      window.__initializationFailure = {
        read: () => ({
          documentId,
          failures,
          runtimeReady,
          hiddenTargetOpacity,
          owners: [...owners].map(([article, value]) => ({
            sidebarAborted: value.sidebar?.aborted,
            tocAborted: value.toc?.aborted,
            connected: article.isConnected,
          })),
        }),
      };
      document.addEventListener('site:runtime-ready', () => runtimeReady++);
      document.addEventListener('astro:after-swap', () => {
        if (stage !== 'after-swap' || failures || location.pathname !== articlePath) return;
        hiddenTargetOpacity = document.querySelector<HTMLElement>('.page-outlet')?.style.opacity;
        armed = true;
      });
      document.addEventListener('astro:before-preparation', (event) => {
        if (
          stage === 'loader' &&
          !failures &&
          (event as Event & { to: URL }).to.pathname === blogPath
        )
          armed = true;
      });

      const addEventListener = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (
        this: EventTarget,
        type,
        listener,
        options,
      ) {
        addEventListener.call(this, type, listener, options);
        const signal = typeof options === 'object' ? options?.signal : undefined;
        if (!signal) return;
        if (
          this instanceof HTMLElement &&
          type === 'pointerdown' &&
          this.matches('[data-article-sidebar-resizer]')
        ) {
          const article = this.closest<HTMLElement>('[data-article-page]');
          if (article) owner(article).sidebar = signal;
        } else if (
          this instanceof HTMLElement &&
          type === 'click' &&
          this.matches('[data-article-page]')
        ) {
          owner(this).toc = signal;
        } else if (stage === 'toc' && !failures && this === window && type === 'keydown') {
          const article = document.querySelector<HTMLElement>('[data-article-page]');
          // Match the signal previously registered by THIS article's click
          // handler, not an unrelated window keyboard listener.
          if (article && owners.get(article)?.toc === signal) armed = true;
        }
      };

      const querySelectorAll = Document.prototype.querySelectorAll;
      Document.prototype.querySelectorAll = function (this: Document, selector: string) {
        if (
          stage !== 'loader' &&
          armed &&
          !failures &&
          this === document &&
          selector === headingSelector
        )
          fail();
        return querySelectorAll.call(this, selector);
      } as typeof querySelectorAll;
      const querySelector = Document.prototype.querySelector;
      Document.prototype.querySelector = function (this: Document, selector: string) {
        const result = querySelector.call(this, selector);
        if (
          stage === 'loader' &&
          armed &&
          !failures &&
          this !== document &&
          selector === '[data-blog-listing]' &&
          result
        )
          fail();
        return result;
      } as typeof querySelector;
    },
    { stage, message, articlePath, blogPath, headingSelector },
  );
  return { errors, message };
}

async function snapshot(page: Page) {
  return page.evaluate(() => window.__initializationFailure.read());
}

async function holdNavigation(page: Page, path: string) {
  let release = () => {};
  let requested = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${path}`, async (route) => {
    if (route.request().resourceType() === 'fetch') {
      requested = true;
      await gate;
    }
    await route.continue().catch(() => undefined);
  });
  return {
    release,
    async expectWaiting() {
      await expect.poll(() => requested).toBe(true);
      await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
      await expect(page.locator('html')).toHaveAttribute('data-navigation-progress', 'active');
    },
  };
}

async function expectReadableAndSettled(page: Page) {
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending');
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation-progress');
  await expect(page.locator('main')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.page-outlet')).toHaveCSS('opacity', '1');
  await expect(page.locator('.page-outlet')).not.toHaveAttribute('data-page-outlet-entering');
  await expect(page.locator('.page-outlet')).not.toHaveAttribute('data-page-outlet-leaving');
  await expect(page.locator('main h1')).toBeVisible();
}

async function failArticleNavigation(page: Page, stage: 'toc' | 'after-swap') {
  const failure = await installFailure(page, stage);
  await page.goto(`${blogPath}?tag=git`);
  await expect(page.locator('[data-blog-listing]')).toHaveAttribute('data-blog-runtime-ready', '');
  const gate = await holdNavigation(page, articlePath);
  try {
    await page.locator(`[data-blog-article]:not([hidden]) h2 a[href="${articlePath}"]`).click();
    await gate.expectWaiting();
    gate.release();
    await expect(page).toHaveURL(new RegExp(`${articlePath}$`));
    await expect.poll(async () => (await snapshot(page)).failures).toBe(1);
    await expect.poll(() => failure.errors).toContain(failure.message);
    await expectReadableAndSettled(page);
    return failure;
  } finally {
    gate.release();
  }
}

async function expectWorkingArticle(page: Page) {
  await expect(page.locator('[data-article-page]')).toHaveAttribute(
    'data-article-runtime-ready',
    '',
  );
  const resizer = page.locator('[data-article-sidebar-resizer]');
  const initialWidth = Number(await resizer.getAttribute('aria-valuenow'));
  await resizer.focus();
  await resizer.press('ArrowRight');
  await expect(resizer).toHaveAttribute('aria-valuenow', String(initialWidth - 16));
  const link = page.locator('#article-sidebar a[data-toc-slug]').nth(2);
  const slug = await link.getAttribute('data-toc-slug');
  await link.click();
  await expect(link).toHaveAttribute('aria-current', 'location');
  await expect
    .poll(() => page.evaluate(() => decodeURIComponent(location.hash.slice(1))))
    .toBe(slug);
  await expect
    .poll(() =>
      page
        .locator(`[id="${slug}"]`)
        .evaluate((heading) =>
          Math.abs(
            heading.getBoundingClientRect().top -
              Number.parseFloat(getComputedStyle(heading).scrollMarginTop),
          ),
        ),
    )
    .toBeLessThan(2);
}

test('a failed SPA article mount rolls back child listeners and a real return mounts normally', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('article-sidebar-layout', JSON.stringify({ collapsed: true, width: 256 }));
  });
  const failure = await failArticleNavigation(page, 'toc');
  await expect(page.locator('[data-article-page]')).not.toHaveAttribute(
    'data-article-runtime-ready',
  );
  const failed = await snapshot(page);
  expect(failed.owners).toHaveLength(1);
  expect(failed.owners[0]).toMatchObject({
    sidebarAborted: true,
    tocAborted: true,
    connected: true,
  });
  await expect(page.locator('[data-article-sidebar-layout]')).not.toHaveAttribute(
    'data-sidebar-controlled',
  );
  // The root's saved collapsed track is still zero. The failed page must
  // override it locally, not just remove inert while leaving a clipped TOC.
  expect(await page.evaluate(() => localStorage.getItem('article-sidebar-layout'))).toBe(
    JSON.stringify({ collapsed: true, width: 256 }),
  );
  await expect
    .poll(() =>
      page
        .locator('.article-sidebar-viewport')
        .evaluate((element) => element.getBoundingClientRect().width),
    )
    .toBe(256);
  await expect(page.locator('[data-article-sidebar-toggle]')).toBeDisabled();
  const staticLink = page.locator('#article-sidebar a[data-toc-slug]').nth(1);
  const staticSlug = await staticLink.getAttribute('data-toc-slug');
  await staticLink.click();
  await expect
    .poll(() => page.evaluate(() => decodeURIComponent(location.hash.slice(1))))
    .toBe(staticSlug);
  await page.locator('.site-header__nav-link[href="/en/projects/"]').click();
  await expect(page).toHaveURL(/\/en\/projects\/$/);
  await page.goBack();
  await expect(page.locator('[data-article-sidebar-layout]')).toHaveAttribute(
    'data-sidebar-collapsed',
    '',
  );
  await page.locator('[data-article-sidebar-toggle]').click();
  await expectWorkingArticle(page);
  expect((await snapshot(page)).documentId).toBe(failed.documentId);
  expect(failure.errors).toEqual([failure.message]);
});

test('cold article failure does not publish runtime-ready and preserves full-document navigation', async ({
  page,
}) => {
  const failure = await installFailure(page, 'toc');
  await page.goto(articlePath);
  await expect.poll(async () => (await snapshot(page)).failures).toBe(1);
  await expect.poll(() => failure.errors).toContain(failure.message);
  const failed = await snapshot(page);
  expect(failed.runtimeReady).toBe(0);
  expect(failed.owners).toHaveLength(1);
  expect(failed.owners[0]).toMatchObject({ sidebarAborted: true, tocAborted: true });
  await expect(page.locator('[data-article-page]')).not.toHaveAttribute(
    'data-article-runtime-ready',
  );
  await expectReadableAndSettled(page);
  await page.locator('.site-header__nav-link[href="/en/projects/"]').click();
  await expect(page).toHaveURL(/\/en\/projects\/$/);
  await expect.poll(async () => (await snapshot(page)).documentId).not.toBe(failed.documentId);
  // The per-document init marker changes only on a new Document, not an Astro swap.
  await expectReadableAndSettled(page);
  expect(failure.errors).toEqual([failure.message]);
});

test('failure before entering animation creation does not leave the swapped target transparent', async ({
  page,
}) => {
  const failure = await failArticleNavigation(page, 'after-swap');
  expect((await snapshot(page)).hiddenTargetOpacity).toBe('0');
  await expect(page.locator('.article-prose')).toBeVisible();
  await page.locator('.site-header__nav-link[href="/en/projects/"]').click();
  await expect(page).toHaveURL(/\/en\/projects\/$/);
  await expectReadableAndSettled(page);
  expect(failure.errors).toEqual([failure.message]);
});

test('a target-document preparation failure settles feedback and leaves the old page navigable', async ({
  page,
}) => {
  const failure = await installFailure(page, 'loader');
  await page.goto(articlePath);
  await expect(page.locator('[data-article-page]')).toHaveAttribute(
    'data-article-runtime-ready',
    '',
  );
  const originalId = (await snapshot(page)).documentId;
  const gate = await holdNavigation(page, blogPath);
  try {
    await page.locator('.site-header__nav-link[href="/en/blog/"]').click();
    await gate.expectWaiting();
    gate.release();
    await expect.poll(async () => (await snapshot(page)).failures).toBe(1);
    await expect.poll(() => failure.errors).toContain(failure.message);
    await expectReadableAndSettled(page);
    await expect(page).toHaveURL(new RegExp(`${articlePath}$`));
    await expect(page.locator('[data-article-page]')).toHaveAttribute(
      'data-article-runtime-ready',
      '',
    );
    expect((await snapshot(page)).documentId).toBe(originalId);
    await page.locator('.site-header__nav-link[href="/en/projects/"]').click();
    await expect(page).toHaveURL(/\/en\/projects\/$/);
    await expectReadableAndSettled(page);
    expect(failure.errors).toEqual([failure.message]);
  } finally {
    gate.release();
  }
});

for (const direction of ['back', 'forward'] as const) {
  for (const stage of ['preparation', 'swap'] as const) {
    test(`failed ${direction} ${stage} loads the selected history entry without changing history`, async ({
      page,
    }) => {
      const target = `${blogPath}?tag=git#main-content`;
      if (direction === 'back') {
        await page.goto(target);
        await expect(page.locator('[data-blog-runtime-ready]')).toBeVisible();
        await page.locator(`h2 a[href="${articlePath}"]`).click();
      } else {
        await page.goto(articlePath);
        await expect(page.locator('[data-article-runtime-ready]')).toBeVisible();
        await page.locator('.site-header__nav-link[href="/en/blog/"]').click();
        await expect(page.locator('[data-blog-runtime-ready]')).toBeVisible();
        await page.goBack();
      }
      await expect(page.locator('[data-article-runtime-ready]')).toBeVisible();
      const originalMain = await page.locator('main').elementHandle();
      const historyLength = await page.evaluate(() => history.length);
      const message = `A01 controlled ${direction} ${stage} failure`;
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      let documentRequests = 0;
      page.on('request', (request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame())
          documentRequests++;
      });
      await page.evaluate(
        ({ stage, message }) => {
          let armed = false;
          document.addEventListener('astro:before-preparation', (rawEvent) => {
            const event = rawEvent as Event & { navigationType: string };
            armed = event.navigationType === 'traverse';
          });
          const fail = () => {
            armed = false;
            throw new Error(message);
          };
          if (stage === 'preparation') {
            const query = Document.prototype.querySelector;
            Document.prototype.querySelector = function (this: Document, selector: string) {
              const result = query.call(this, selector);
              if (armed && this !== document && selector === '[data-blog-listing]' && result)
                fail();
              return result;
            } as typeof query;
          } else {
            document.addEventListener('astro:before-swap', () => {
              if (!armed) return;
              // Fail inside the router swap, which is wrapped by the site's owner.
              const root = document.documentElement;
              const remove = root.removeAttribute.bind(root);
              root.removeAttribute = (name) => {
                if (armed && name === 'lang') fail();
                remove(name);
              };
            });
          }
        },
        { stage, message },
      );
      if (direction === 'back') await page.goBack();
      else await page.goForward();
      await expect(page).toHaveURL(direction === 'back' ? target : blogPath);
      await expect(page.locator('[data-blog-runtime-ready]')).toBeVisible();
      await expectReadableAndSettled(page);
      expect(await page.evaluate(() => history.length)).toBe(historyLength);
      expect(documentRequests).toBe(1);
      // The original error is reported synchronously before unloading. Astro's
      // rejected promise may also be reported if this Document is still alive.
      expect(errors).toContain(message);
      expect(errors.every((error) => error === message)).toBe(true);
      // A complete Document load, not a fake-ready flag on the old article.
      await expect
        .poll(async () =>
          originalMain!.evaluate((element) => element.isConnected).catch(() => false),
        )
        .toBe(false);
      if (direction === 'back') await page.goForward();
      else await page.goBack();
      await expect(page.locator('[data-article-runtime-ready]')).toBeVisible();
      await expectReadableAndSettled(page);
    });
  }
}
