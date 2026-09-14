import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('**/api/wallpapers', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
});

const cases: Array<{ name: string; actions: Array<'toggle' | 'reset'>; synchronized: boolean }> = [
  { name: 'disable synchronization', actions: ['toggle'], synchronized: false },
  { name: 'toggle off and back on', actions: ['toggle', 'toggle'], synchronized: true },
  { name: 'reset an early choice', actions: ['toggle', 'reset'], synchronized: true },
  {
    name: 'change the choice after reset',
    actions: ['toggle', 'reset', 'toggle'],
    synchronized: false,
  },
];

const positions = (points: Locator) =>
  points.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('transform')));

async function checkDragCoupling(page: Page, figure: Locator, synchronized: boolean) {
  const feedback = figure.locator('.feedbackPoints path');
  const applications = figure.locator('.applicationPoints path');
  const point = feedback.nth(3);
  await point.scrollIntoViewIfNeeded();
  const before = {
    feedback: await positions(feedback),
    applications: await positions(applications),
    interval: await figure.getAttribute('data-feedback-interval'),
  };
  const box = (await point.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    await expect(figure).toHaveAttribute('data-dragging', 'feedback-interval');
    await page.mouse.move(x + 35, y);
    await expect(figure).not.toHaveAttribute('data-feedback-interval', before.interval!);
  } finally {
    await page.mouse.up();
  }
  await expect(figure).not.toHaveAttribute('data-dragging', /.+/);
  expect(await positions(feedback)).not.toEqual(before.feedback);
  if (synchronized) {
    expect(await positions(applications)).not.toEqual(before.applications);
    expect(await figure.getAttribute('data-application-interval')).toBe(
      await figure.getAttribute('data-feedback-interval'),
    );
  } else {
    expect(await positions(applications)).toEqual(before.applications);
  }
}

for (const scenario of cases) {
  test(`loading-time input is applied to the graph: ${scenario.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const gate = Promise.withResolvers<void>();
    let moduleRequested = false;
    await page.route('**/_astro/vega.module.*.js', async (route) => {
      moduleRequested = true;
      await gate.promise;
      await route.continue();
    });
    const figure = page.locator('[data-closed-loop-control-timing]');
    const control = figure.locator('.closed-loop-control-timing-switch-control');
    const input = figure.getByRole('switch');
    const reset = figure.getByRole('button', { name: 'Reset', exact: true });
    try {
      await page.goto('/en/blog/closed-loop-control-timing/', { waitUntil: 'domcontentloaded' });
      await expect.poll(() => moduleRequested).toBe(true);
      await expect(input).toHaveAttribute('aria-checked', 'true');
      await expect(figure.locator('.closed-loop-control-timing-plot svg')).toHaveCount(0);
      let expected = true;
      for (const action of scenario.actions) {
        if (action === 'reset') {
          await reset.click();
          expected = true;
        } else {
          // The visible switch control covers Kobalte's native input.
          await control.click();
          expected = !expected;
        }
        await expect(input).toHaveAttribute('aria-checked', String(expected));
      }
    } finally {
      gate.resolve();
    }
    await expect(figure.locator('.closed-loop-control-timing-plot svg')).toBeVisible();
    await expect(figure).toHaveAttribute('data-synchronized', String(scenario.synchronized));
    await expect(input).toHaveAttribute('aria-checked', String(scenario.synchronized));
    await checkDragCoupling(page, figure, scenario.synchronized);

    // Once loaded, toggling must still switch the actual graph behavior.
    await control.click();
    await expect(figure).toHaveAttribute('data-synchronized', String(!scenario.synchronized));
    await expect(input).toHaveAttribute('aria-checked', String(!scenario.synchronized));
    await checkDragCoupling(page, figure, !scenario.synchronized);
    await reset.click();
    await expect(input).toHaveAttribute('aria-checked', 'true');
    await expect(figure).toHaveAttribute('data-synchronized', 'true');
    for (const [name, value] of Object.entries({
      'feedback-interval': '6',
      'application-interval': '6',
      'feedback-offset': '2.5',
      'application-offset': '2.5',
    }))
      await expect(figure).toHaveAttribute(`data-${name}`, value);
    expect(errors).toEqual([]);
  });
}
