import { expect, test } from '@playwright/test';

test('the server-rendered project preview responds to two-dimensional dragging', async ({
  page,
}) => {
  await page.goto('/en/projects/');
  const preview = page.locator('[data-project-preview="motion-control"]');
  const figure = preview.locator('.motion-control-project-visual');
  const handle = preview.locator('[data-vehicle-drag-handle]');
  const initialX = await figure.getAttribute('data-vehicle-x');
  const initialY = await figure.getAttribute('data-vehicle-y');
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
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
});
