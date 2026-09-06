import { expect, test } from '@playwright/test';
import {
  NAVIGATION_FADE_MS,
  NAVIGATION_MIN_VISIBLE_MS,
  NAVIGATION_SHOW_DELAY_MS,
} from '../../../apps/site/src/runtime/navigation-feedback';

const articlePath = '/en/blog/git-operations-reference/';

test('slow same-build navigation exposes feedback without replacing the wallpaper visual', async ({
  page,
}) => {
  let releaseResponse = () => {};
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });

  await page.route(`**${articlePath}`, async (route) => {
    if (route.request().resourceType() !== 'fetch') {
      await route.continue();
      return;
    }
    await responseGate;
    await route.continue();
  });
  await page.goto('/en/blog/');
  await page.evaluate(() => {
    document.querySelector<HTMLAnchorElement>(
      'a[href="/en/blog/git-operations-reference/"]',
    )!.dataset.astroPrefetch = 'false';
    document.querySelector<HTMLElement>('[data-wallpaper-visual]')!.dataset.identityProbe =
      'original';
  });

  const click = page.getByRole('link', { name: 'Git Operations Reference' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-navigation-pending', '');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true');
  await page.waitForTimeout(NAVIGATION_SHOW_DELAY_MS + 20);
  await expect(page.locator('html')).toHaveAttribute('data-navigation-progress', 'active');
  await expect(page.locator('.page-outlet')).toHaveCSS('opacity', '1');
  expect(
    await page.evaluate(() =>
      document.getAnimations().some((animation) => {
        const effect = animation.effect as
          (KeyframeEffect & { pseudoElement?: string | null }) | null;
        return effect?.pseudoElement?.includes('page-outlet') ?? false;
      }),
    ),
  ).toBe(false);

  releaseResponse();
  await click;
  await expect(page).toHaveURL(new RegExp(`${articlePath}$`));
  await expect(page.locator('[data-wallpaper-visual]')).toHaveAttribute(
    'data-identity-probe',
    'original',
  );
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending', '');
  await expect(page.locator('main')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('html')).not.toHaveAttribute('data-navigation-progress', 'active', {
    timeout: NAVIGATION_MIN_VISIBLE_MS + NAVIGATION_FADE_MS + 1_000,
  });
});
