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
  await page.mouse.move(box!.x + box!.width / 2 + 48, box!.y + box!.height / 2 + 24, {
    steps: 4,
  });
  await page.mouse.up();

  await expect.poll(() => figure.getAttribute('data-vehicle-x')).not.toBe(initialX);
  await expect.poll(() => figure.getAttribute('data-vehicle-y')).not.toBe(initialY);
});
