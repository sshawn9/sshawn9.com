import { expect, test, type Locator, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

type DragTestWindow = typeof window & {
  __motionDragD3: {
    select: typeof import('d3-selection').select;
  };
};

let d3Fixture: string;
test.beforeAll(async () => {
  // Inspect D3 listeners through its public API, not window.__on internals.
  const result = await build({
    stdin: {
      contents: "export { select } from 'd3-selection';",
      resolveDir: fileURLToPath(new URL('../../../', import.meta.url)),
    },
    bundle: true,
    format: 'iife',
    globalName: '__motionDragD3',
    write: false,
  });
  d3Fixture = result.outputFiles[0].text;
});

test.beforeEach(async ({ context }) => {
  await context.route('**/api/wallpapers', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
});

async function waitForHandle(handle: Locator) {
  await handle.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      handle.evaluate((element) => Boolean(element.closest('astro-island')?.hasAttribute('ssr'))),
    )
    .toBe(false);
}

async function openFigure(page: Page) {
  await page.goto('/en/projects/');
  await page.addScriptTag({ content: d3Fixture });
  const figure = page.locator(
    '[data-project-preview="motion-control"] .motion-control-project-visual',
  );
  const handle = figure.locator('[data-vehicle-drag-handle]');
  await waitForHandle(handle);
  const box = (await handle.boundingBox())!;
  return { figure, handle, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function windowDragState(page: Page) {
  return page.evaluate(() => {
    const { select } = (window as DragTestWindow).__motionDragD3;
    return {
      listeners: [
        'mousemove.drag',
        'mouseup.drag',
        'dragstart.drag',
        'selectstart.drag',
        'click.drag',
      ].filter((type) => select(window).on(type)),
      selectionBlocked: !window.dispatchEvent(new Event('selectstart', { cancelable: true })),
    };
  });
}

async function goToAbout(page: Page) {
  // Keep the mouse button held while keyboard activation starts a real client navigation.
  await page.getByRole('link', { name: 'About', exact: true }).focus();
  await page.keyboard.press('Enter');
}

test('leaving during a mouse drag releases window listeners before the mouse button is released', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { figure, x, y } = await openFigure(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    await page.mouse.move(x + 20, y + 10);
    await expect(figure).toHaveAttribute('data-dragging', '');
    expect((await windowDragState(page)).selectionBlocked).toBe(true);
    await goToAbout(page);
    await expect(page).toHaveURL(/\/en\/about\/$/);
    await expect(figure).toHaveCount(0);
    // The injected D3 global also proves the document was not replaced by a hard load.
    expect(await windowDragState(page)).toEqual({ listeners: [], selectionBlocked: false });
    await page.mouse.move(200, 200);
  } finally {
    await page.mouse.up();
  }
  await page.getByRole('link', { name: 'Projects', exact: true }).click();
  await expect(figure).toBeVisible();
  const handle = figure.locator('[data-vehicle-drag-handle]');
  await waitForHandle(handle);
  const box = (await handle.boundingBox())!;
  const before = await figure.getAttribute('data-vehicle-x');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2);
    await expect(figure).not.toHaveAttribute('data-vehicle-x', before!);
  } finally {
    await page.mouse.up();
  }
  await expect
    .poll(() => windowDragState(page))
    .toEqual({ listeners: [], selectionBlocked: false });
  expect(errors).toEqual([]);
});

test('a cancelled navigation keeps the current drag active', async ({ page }) => {
  const { figure, x, y } = await openFigure(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    await page.mouse.move(x + 10, y + 10);
    const before = await figure.getAttribute('data-vehicle-x');
    await page.evaluate(() => {
      document.addEventListener(
        'astro:before-preparation',
        (rawEvent) => {
          const event = rawEvent as Event & { loader: () => Promise<void>; signal: AbortSignal };
          // Hold preparation until a newer same-document navigation cancels it.
          // preventDefault would request a hard-navigation fallback in Astro.
          event.loader = () =>
            new Promise<void>((resolve) => {
              event.signal.addEventListener('abort', () => resolve(), { once: true });
            });
        },
        { once: true },
      );
    });
    await goToAbout(page);
    await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
    await page.getByRole('link', { name: 'Projects', exact: true }).evaluate((element) => {
      const link = element as HTMLAnchorElement;
      link.href = '/en/projects/#main-content';
      link.click();
    });
    await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending', '');
    await expect(page).toHaveURL(/\/en\/projects\/#main-content$/);
    expect((await windowDragState(page)).selectionBlocked).toBe(true);
    await page.mouse.move(x + 40, y + 20);
    await expect(figure).not.toHaveAttribute('data-vehicle-x', before!);
  } finally {
    await page.mouse.up();
  }
  await expect
    .poll(() => windowDragState(page))
    .toEqual({ listeners: [], selectionBlocked: false });
});

test.describe('touch dragging', () => {
  test.use({ viewport: { width: 390, height: 500 }, isMobile: true, hasTouch: true });

  test('touch movement, normal release and cancellation remain usable', async ({ page }) => {
    const { figure, handle } = await openFigure(page);
    await figure.evaluate((element) =>
      element.scrollIntoView({ block: 'center', behavior: 'instant' }),
    );
    const scrollBefore = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    expect(scrollBefore.y).toBeGreaterThan(100);
    const input = await page.context().newCDPSession(page);
    let touchActive = false;
    try {
      for (const end of ['touchEnd', 'touchCancel'] as const) {
        const box = (await handle.boundingBox())!;
        const startX = box.x + box.width / 2;
        const startY = box.y + box.height / 2;
        const before = await figure.getAttribute('data-vehicle-x');
        await input.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ x: startX, y: startY, id: 1 }],
        });
        touchActive = true;
        await expect(figure).toHaveAttribute('data-dragging', '');
        await input.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: startX + 20, y: startY + 40, id: 1 }],
        });
        await expect(figure).not.toHaveAttribute('data-vehicle-x', before!);
        await input.send('Input.dispatchTouchEvent', { type: end, touchPoints: [] });
        touchActive = false;
        await expect(figure).not.toHaveAttribute('data-dragging', '');
        expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(
          scrollBefore,
        );
        expect(await windowDragState(page)).toEqual({ listeners: [], selectionBlocked: false });
      }
    } finally {
      if (touchActive)
        await input.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await input.detach();
    }
  });

  test('swiping the reference line or empty area scrolls the page without moving the vehicle', async ({
    page,
  }) => {
    const { figure } = await openFigure(page);
    const vehicleX = await figure.getAttribute('data-vehicle-x');
    const vehicleY = await figure.getAttribute('data-vehicle-y');
    const input = await page.context().newCDPSession(page);
    let touchActive = false;
    try {
      for (const area of ['reference', 'empty']) {
        await figure.evaluate((element) =>
          element.scrollIntoView({ block: 'center', behavior: 'instant' }),
        );
        const scrollBefore = await page.evaluate(() => window.scrollY);
        expect(scrollBefore).toBeGreaterThan(100);
        const point = await figure.evaluate((element, area) => {
          if (area === 'reference') {
            const path = element.querySelector<SVGPathElement>('.motion-control-reference-line')!;
            const point = path.getPointAtLength(path.getTotalLength() * 0.15);
            const screen = point.matrixTransform(path.getScreenCTM()!);
            return { x: screen.x, y: screen.y };
          }
          const box = element.getBoundingClientRect();
          return { x: box.x + box.width * 0.1, y: box.y + box.height * 0.2 };
        }, area);
        await input.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ ...point, id: 1 }],
        });
        touchActive = true;
        for (let step = 1; step <= 6; step++) {
          await input.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: point.x, y: point.y + 15 * step, id: 1 }],
          });
          await page.evaluate(() => new Promise(requestAnimationFrame));
        }
        await input.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        touchActive = false;
        await expect
          .poll(() => page.evaluate(() => window.scrollY))
          .toBeLessThan(scrollBefore - 30);
        await expect(figure).toHaveAttribute('data-vehicle-x', vehicleX!);
        await expect(figure).toHaveAttribute('data-vehicle-y', vehicleY!);
        await expect(figure).not.toHaveAttribute('data-dragging', '');
      }
    } finally {
      if (touchActive)
        await input.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await input.detach();
    }
  });
});

test('dragging from a wheel still moves the vehicle', async ({ page }) => {
  const { figure } = await openFigure(page);
  const point = await figure
    .locator('.motion-control-wheel')
    .first()
    .evaluate((element) => {
      const wheel = element as SVGRectElement;
      // Start on the painted tire stroke, not the hollow center.
      const screen = new DOMPoint(0, wheel.y.baseVal.value).matrixTransform(wheel.getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    });
  const before = await figure.getAttribute('data-vehicle-x');
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  try {
    await page.mouse.move(point.x + 20, point.y + 10);
    await expect(figure).not.toHaveAttribute('data-vehicle-x', before!);
  } finally {
    await page.mouse.up();
  }
});

test('the server-rendered project preview responds to two-dimensional dragging', async ({
  page,
}) => {
  await page.goto('/en/projects/');
  const preview = page.locator('[data-project-preview="motion-control"]');
  const figure = preview.locator('.motion-control-project-visual');
  const handle = preview.locator('[data-vehicle-drag-handle]');
  await waitForHandle(handle);
  const initialX = await figure.getAttribute('data-vehicle-x');
  const initialY = await figure.getAttribute('data-vehicle-y');
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(handle).toHaveCSS('cursor', 'grab');
  await page.mouse.down();
  await expect(handle).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(box!.x + box!.width / 2 + 24, box!.y + box!.height / 2 + 12);
  const intermediate = {
    x: await figure.getAttribute('data-vehicle-x'),
    y: await figure.getAttribute('data-vehicle-y'),
  };
  await page.mouse.move(box!.x + box!.width / 2 + 72, box!.y + box!.height / 2 + 36);
  await expect.poll(() => figure.getAttribute('data-vehicle-x')).not.toBe(intermediate.x);
  await expect.poll(() => figure.getAttribute('data-vehicle-y')).not.toBe(intermediate.y);
  const latest = {
    x: await figure.getAttribute('data-vehicle-x'),
    y: await figure.getAttribute('data-vehicle-y'),
  };
  await page.mouse.up();
  await expect(handle).toHaveCSS('cursor', 'grab');

  expect(latest.x).not.toBe(initialX);
  expect(latest.y).not.toBe(initialY);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
      ),
  );
  await expect(figure).toHaveAttribute('data-vehicle-x', latest.x ?? '');
  await expect(figure).toHaveAttribute('data-vehicle-y', latest.y ?? '');
  await expect(page).toHaveURL(/\/en\/projects\/$/);
  const title = page.locator('.project-card--with-preview .project-card__link').first();
  const target = await title.getAttribute('href');
  await title.click();
  await expect(page).toHaveURL(new URL(target!, page.url()).href);
});
