import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { routeWallpaperResources, seedTwoSlots } from '../browser-fixtures';

test('the wallpaper uses one content-addressed classic script across page navigation', async ({
  page,
}) => {
  await routeWallpaperResources(page);
  await seedTwoSlots(page, 1600);
  const scriptPath = /^\/_astro\/wallpaper-system\.[\w-]+\.js$/;
  const requests: string[] = [];
  page.on('request', (request) => {
    if (scriptPath.test(new URL(request.url()).pathname)) requests.push(request.url());
  });

  const [response] = await Promise.all([
    page.waitForResponse((response) => scriptPath.test(new URL(response.url()).pathname)),
    page.goto('/en/blog/'),
  ]);
  expect(response.ok()).toBe(true);
  const source = await response.text();
  expect(() => new Script(source)).not.toThrow();
  await expect(
    readFile(new URL('../../../apps/site/dist/_runtime/wallpaper-system-v3.js', import.meta.url)),
  ).rejects.toMatchObject({ code: 'ENOENT' });

  const entry = page.locator('head script[data-wallpaper-system-entry]');
  await expect(entry).toHaveAttribute('src', new URL(response.url()).pathname);
  for (const attribute of ['type', 'async', 'defer', 'data-astro-rerun']) {
    expect(await entry.getAttribute(attribute)).toBeNull();
  }
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');

  await page.locator('.site-header__desktop a[href="/en/about/"]').click();
  await expect(page).toHaveURL(/\/en\/about\/$/);
  await expect(page.locator('.about-page')).toBeVisible();
  await expect(entry).toHaveAttribute('src', new URL(response.url()).pathname);
  await expect(page.locator('html')).toHaveAttribute('data-wallpaper-photo-id', 'photo-one');
  expect(requests).toEqual([response.url()]);
});
