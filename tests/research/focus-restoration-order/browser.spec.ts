import { expect, test, type Page } from '@playwright/test';

const articlePath = '/en/blog/planar-frenet-frame/';
const graphSelector = '[data-research-figure][data-kind="planar-heading"]';
const dialogSelector = '[data-figure-focus-dialog]';
type Followup = 'toc' | 'scroll-and-focus' | 'reopen';
type Sample = {
  y: number;
  expectedFocus: boolean;
  dialogOpen: boolean;
  figureInDialog: boolean;
  figureConnected: boolean;
};

declare global {
  interface Window {
    __focusOrder: {
      frames: Sample[];
      read(): Sample;
      expectedHash: string;
      expectedY: number;
      closeEvents: number;
      ran: boolean;
    };
  }
}

async function openFigure(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(articlePath);
  await expect(page.locator('[data-article-page]')).toHaveAttribute(
    'data-article-runtime-ready',
    '',
  );
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'smooth');
  const figure = page.locator(graphSelector).locator('xpath=ancestor::figure[1]');
  const toggle = figure.locator('[data-figure-focus-toggle]');
  await toggle.scrollIntoViewIfNeeded();
  const originalParent = await figure.evaluateHandle((element) => element.parentNode);
  const savedY = await page.evaluate(() => scrollY);
  expect(savedY).toBeGreaterThan(500);
  await toggle.click();
  await expect(page.locator(dialogSelector)).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(savedY, 0);
  // Opening is settled before testing close ordering; these frames only observe.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  return { figure, toggle, originalParent, savedY };
}

async function followCloseInSameTask(page: Page, action: Followup) {
  await page.evaluate(
    ({ graphSelector, dialogSelector, action }) => {
      const figure = document.querySelector(graphSelector)?.closest<HTMLElement>('figure');
      const toggle = figure?.querySelector<HTMLButtonElement>('[data-figure-focus-toggle]');
      const dialog = document.querySelector<HTMLDialogElement>(dialogSelector);
      const toc = document.querySelector<HTMLAnchorElement>('#article-sidebar a[data-toc-slug]');
      const other = document.querySelector<HTMLAnchorElement>(
        '.site-header__nav-link[href="/en/blog/"]',
      );
      if (!figure || !toggle || !dialog?.open || !toc || !other)
        throw new Error('Missing open figure and real navigation controls.');
      let expectedFocus: HTMLElement = toggle;
      const probe: Window['__focusOrder'] = (window.__focusOrder = {
        frames: [] as Sample[],
        expectedHash: toc.hash,
        expectedY: 0,
        closeEvents: 0,
        ran: false,
        read: (): Sample => ({
          y: scrollY,
          expectedFocus: document.activeElement === expectedFocus,
          dialogOpen: dialog.open,
          figureInDialog: dialog.contains(figure),
          figureConnected: figure.isConnected,
        }),
      });
      dialog.addEventListener('close', () => {
        probe.closeEvents++;
      });
      const afterClose = (event: MouseEvent) => {
        if (!(event.target instanceof Element) || !toggle.contains(event.target)) return;
        document.removeEventListener('click', afterClose);
        if (!event.isTrusted || dialog.open)
          throw new Error(
            'Expected the real close button to have closed the dialog before the follow-up.',
          );
        probe.ran = true;
        if (action === 'toc') {
          // A controlled same-task intent, using the existing TOC and its handlers.
          expectedFocus = toc;
          toc.click();
          toc.focus({ preventScroll: true });
        } else if (action === 'scroll-and-focus') {
          expectedFocus = other;
          window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
          other.focus({ preventScroll: true });
        } else {
          probe.expectedY = scrollY;
          toggle.click();
        }
        const sample = () => {
          probe.frames.push(probe.read());
          if (probe.frames.length < 8) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      };
      // Installed after the application's document click handler. This does not
      // intercept RAF, replace dialog methods, or alter the smooth-scroll CSS.
      document.addEventListener('click', afterClose);
    },
    { graphSelector, dialogSelector, action },
  );
}

async function readFollowup(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__focusOrder.frames.length)).toBe(8);
  return page.evaluate(() => {
    const { frames, expectedHash, expectedY, closeEvents, ran } = window.__focusOrder;
    return { frames, expectedHash, expectedY, closeEvents, ran };
  });
}

test('a same-task TOC intent after the real close click keeps its destination and focus', async ({
  page,
}) => {
  const { toggle } = await openFigure(page);
  await followCloseInSameTask(page, 'toc');
  await toggle.click();
  const result = await readFollowup(page);
  expect(result.ran).toBe(true);
  await expect(page).toHaveURL(`${new URL(articlePath, page.url()).href}${result.expectedHash}`);
  const heading = page.locator(`[id="${decodeURIComponent(result.expectedHash.slice(1))}"]`);
  await expect(heading).toBeInViewport();
  expect(
    result.frames.every(
      (frame) =>
        frame.expectedFocus && !frame.dialogOpen && !frame.figureInDialog && frame.figureConnected,
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      heading.evaluate((element) =>
        Math.abs(
          element.getBoundingClientRect().top -
            Number.parseFloat(getComputedStyle(element).scrollMarginTop),
        ),
      ),
    )
    .toBeLessThan(2);
  const settled = await page.evaluate(
    () =>
      new Promise<Sample[]>((resolve) => {
        const samples: Sample[] = [];
        const sample = () => {
          samples.push(window.__focusOrder.read());
          if (samples.length === 8) resolve(samples);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  expect(
    settled.every((frame) => frame.expectedFocus && Math.abs(frame.y - settled[0]!.y) < 1),
  ).toBe(true);
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'smooth');
});

test('an explicit scroll and another control focus after closing are not overwritten on later frames', async ({
  page,
}) => {
  const { toggle } = await openFigure(page);
  await followCloseInSameTask(page, 'scroll-and-focus');
  await toggle.click();
  const result = await readFollowup(page);
  expect(result.ran).toBe(true);
  expect(
    result.frames.every(
      (frame) =>
        Math.abs(frame.y) < 1 &&
        frame.expectedFocus &&
        !frame.dialogOpen &&
        frame.figureConnected &&
        !frame.figureInDialog,
    ),
  ).toBe(true);
  await expect(page.locator('.site-header__nav-link[href="/en/blog/"]')).toBeFocused();
  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'smooth');
});

test('the queued native close event cannot close the same dialog reopened in that task', async ({
  page,
}) => {
  const { figure, toggle, originalParent } = await openFigure(page);
  await followCloseInSameTask(page, 'reopen');
  await toggle.click();
  await expect.poll(() => page.evaluate(() => window.__focusOrder.closeEvents)).toBeGreaterThan(0);
  const result = await readFollowup(page);
  expect(result.ran).toBe(true);
  expect(
    result.frames.every(
      (frame) =>
        frame.dialogOpen &&
        frame.figureInDialog &&
        frame.figureConnected &&
        frame.expectedFocus &&
        Math.abs(frame.y - result.expectedY) < 1,
    ),
  ).toBe(true);
  await expect(page.locator(dialogSelector)).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(page.locator(dialogSelector)).not.toBeVisible();
  expect(
    await figure.evaluate((element, parent) => element.parentNode === parent, originalParent),
  ).toBe(true);
  await expect(page.locator('.frenet-figure-placeholder')).toHaveCount(0);
});

test('cancelled navigation leaves the original figure in place and available to focus again', async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/en/about/', async (route) => {
    if (route.request().resourceType() === 'fetch') {
      requested = true;
      await gate;
    }
    await route.continue().catch(() => undefined);
  });
  try {
    const { figure, toggle, originalParent } = await openFigure(page);
    // Modal inertness prevents pointer access to the header. Trigger the real
    // existing navigation link programmatically; the document request is real.
    await page.locator('.site-header__nav-link[href="/en/about/"]').evaluate((element) => {
      (element as HTMLAnchorElement).click();
    });
    await expect.poll(() => requested).toBe(true);
    await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
    await expect(page.locator(dialogSelector)).not.toBeVisible();
    expect(
      await figure.evaluate((element, parent) => element.parentNode === parent, originalParent),
    ).toBe(true);
    const toc = page.locator('#article-sidebar a[data-toc-slug]').first();
    const hash = await toc.getAttribute('href');
    await toc.click();
    await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending');
    await expect(page).toHaveURL(`${new URL(articlePath, page.url()).href}${hash}`);
    release();
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    await expect(page.locator(dialogSelector)).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.locator(dialogSelector)).toBeVisible();
    await toggle.click();
    expect(
      await figure.evaluate((element, parent) => element.parentNode === parent, originalParent),
    ).toBe(true);
    await expect(page.locator('.frenet-figure-placeholder')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});
