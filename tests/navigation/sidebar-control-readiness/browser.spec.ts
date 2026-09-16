import { expect, test } from '@playwright/test';

const runtimePattern = /\/_astro\/SiteRuntime\.astro_astro_type_script_.*\.js(?:\?|$)/;
const cases = [
  {
    name: 'desktop blog',
    path: '/en/blog/',
    width: 1440,
    button: '[data-blog-sidebar-toggle]',
    resizer: '[data-blog-sidebar-resizer]',
    link: '[data-blog-filter-link][data-tag-slug="git"]',
  },
  {
    name: 'desktop article',
    path: '/en/blog/git-operations-reference/',
    width: 1440,
    button: '[data-article-sidebar-toggle]',
    resizer: '[data-article-sidebar-resizer]',
    link: '#article-sidebar a[data-toc-slug]',
  },
  {
    name: 'narrow blog',
    path: '/en/blog/',
    width: 390,
    button: '[data-blog-mobile-toggle]',
    resizer: undefined,
    link: '[data-blog-filter-link][data-tag-slug="git"]',
  },
] as const;

for (const example of cases) {
  for (const outcome of ['ready', 'failed'] as const) {
    test(`${example.name} controls remain disabled until ready (${outcome})`, async ({ page }) => {
      await page.setViewportSize({ width: example.width, height: 900 });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let requested = false;
      await page.route(runtimePattern, async (route) => {
        requested = true;
        await gate;
        if (outcome === 'ready') await route.continue();
        else await route.abort('failed');
      });
      try {
        await page.goto(example.path, { waitUntil: 'commit' });
        await expect.poll(() => requested).toBe(true);
        await expect(page.locator('main h1')).toBeVisible();
        const button = page.locator(example.button);
        const link = page.locator(example.link).first();
        await expect(button).toBeVisible();
        await expect(button).toBeDisabled();
        await expect(link).toBeVisible();
        if (example.resizer) {
          await expect(page.locator(example.resizer)).toHaveAttribute('tabindex', '-1');
          await expect(page.locator(example.resizer)).toHaveAttribute('aria-disabled', 'true');
        }
        // Disabled native buttons reject focus; tabindex=-1 removes the
        // separator from sequential keyboard focus without disabling links.
        await link.focus();
        await button.evaluate((element) => (element as HTMLButtonElement).focus());
        await expect(link).toBeFocused();
        const screenshot = await button.screenshot();
        release();
        await page.waitForLoadState('load');
        if (outcome === 'failed') {
          await expect(button).toBeDisabled();
          const href = await link.getAttribute('href');
          await link.click();
          if (example.resizer === '[data-article-sidebar-resizer]') {
            await expect.poll(() => page.evaluate(() => location.hash)).toBe(href);
          } else {
            await expect(page).toHaveURL('/en/tags/git/');
            await expect(page.locator('[data-blog-article]').first()).toBeVisible();
          }
          return;
        }
        await expect(button).toBeEnabled();
        expect(await button.screenshot()).toEqual(screenshot);
        if (example.resizer) {
          const resizer = page.locator(example.resizer);
          await expect(resizer).toHaveAttribute('tabindex', '0');
          await expect(resizer).not.toHaveAttribute('aria-disabled');
          const width = Number(await resizer.getAttribute('aria-valuenow'));
          await resizer.focus();
          await resizer.press('ArrowRight');
          await expect(resizer).toHaveAttribute(
            'aria-valuenow',
            String(width + (example.name === 'desktop blog' ? 16 : -16)),
          );
        }
        await button.click();
        await expect(button).toHaveAttribute('aria-expanded', 'false');
        await button.click();
        await expect(button).toHaveAttribute('aria-expanded', 'true');
      } finally {
        release();
      }
    });
  }
}
