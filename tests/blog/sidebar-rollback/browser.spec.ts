import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`blog initialization rollback leaves readable tags and allows a working return at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const navigateTo = async (path: string) => {
      if (width < 1024) await page.locator('[data-mobile-menu-trigger]').click();
      const linkClass = width < 1024 ? 'site-header__mobile-link' : 'site-header__nav-link';
      await page.locator(`.${linkClass}[href="${path}"]`).click();
    };
    const message = 'A01 controlled blog sidebar initialization failure';
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((message) => {
      localStorage.setItem('blog-sidebar-layout', JSON.stringify({ collapsed: true, width: 224 }));
      let failed = false;
      const set = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
        if (!failed && name === 'aria-expanded' && this.matches('[data-blog-sidebar-toggle]')) {
          failed = true;
          throw new Error(message);
        }
        set.call(this, name, value);
      };
    }, message);
    await page.goto('/en/blog/git-operations-reference/');
    await expect(page.locator('[data-article-runtime-ready]')).toBeVisible();
    await navigateTo('/en/blog/');
    await expect(page).toHaveURL('/en/blog/');
    await expect.poll(() => errors).toEqual([message]);
    await expect(page.locator('[data-blog-listing]')).not.toHaveAttribute(
      'data-blog-runtime-ready',
    );
    await expect(page.locator('html')).not.toHaveAttribute('data-navigation-pending');
    await expect(page.locator('main h1')).toBeVisible();
    const tags = page.locator('[data-blog-mobile-panel]');
    await expect(tags).not.toHaveAttribute('aria-hidden');
    await expect(tags.locator('a').first()).toBeVisible();
    await expect(page.locator('[data-blog-mobile-toggle]')).toBeDisabled();
    await expect(page.locator('[data-blog-sidebar-toggle]')).toBeDisabled();
    expect(await page.evaluate(() => localStorage.getItem('blog-sidebar-layout'))).toBe(
      JSON.stringify({ collapsed: true, width: 224 }),
    );

    await navigateTo('/en/projects/');
    await expect(page).toHaveURL('/en/projects/');
    await page.goBack();
    await expect(page.locator('[data-blog-runtime-ready]')).toBeVisible();
    if (width < 1024) {
      const toggle = page.locator('[data-blog-mobile-toggle]');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(tags).toHaveAttribute('aria-hidden', 'true');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(tags).not.toHaveAttribute('aria-hidden');
    } else {
      await expect(page.locator('[data-blog-sidebar-layout]')).toHaveAttribute(
        'data-sidebar-collapsed',
        '',
      );
      await page.locator('[data-blog-sidebar-toggle]').click();
      const resizer = page.locator('[data-blog-sidebar-resizer]');
      await resizer.focus();
      await resizer.press('ArrowRight');
      await expect(resizer).toHaveAttribute('aria-valuenow', '240');
    }
    await expect(tags.locator('a').first()).toBeVisible();
    expect(errors).toEqual([message]);
  });
}
