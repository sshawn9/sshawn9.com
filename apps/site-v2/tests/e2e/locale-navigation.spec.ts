import { expect, test } from '@playwright/test';

const articleId = 'git-operations-reference';
const englishArticlePath = `/en/blog/${articleId}/`;
const chineseArticlePath = `/zh/blog/${articleId}/`;
const routeState = '?view=reader#locale-transfer-probe';

test('same-build language navigation preserves route state, wallpaper visual, and click-time scroll', async ({
  page,
}) => {
  await page.goto(`${englishArticlePath}${routeState}`);

  const clickedY = await page.evaluate(() => {
    document.querySelector<HTMLElement>('[data-wallpaper-visual]')!.dataset.identityProbe =
      'original';
    const maximumY = document.documentElement.scrollHeight - innerHeight;
    scrollTo(0, Math.min(1_800, maximumY - 200));
    const actualY = scrollY;

    // Deliberately leave an older history value. The language transfer must
    // use the synchronous click position instead of this throttled snapshot.
    history.replaceState(
      {
        ...history.state,
        sshawn9: {
          version: 1,
          routeKey: location.pathname + location.search,
          page: { x: 0, y: 48 },
          regions: {},
        },
      },
      '',
    );
    document.querySelector<HTMLAnchorElement>('[data-locale-switch="zh"]')!.click();
    return actualY;
  });

  await expect(page).toHaveURL(
    new RegExp(`${chineseArticlePath.replaceAll('/', '\\/')}\\?view=reader#locale-transfer-probe$`),
  );
  await expect(page.locator('[data-wallpaper-visual]')).toHaveAttribute(
    'data-identity-probe',
    'original',
  );
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect
    .poll(() => page.evaluate((expected) => Math.abs(scrollY - expected), clickedY))
    .toBeLessThan(2);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('PARAGLIDE_LOCALE'))).toBe('zh');
});

test('fallback article content cannot override the requested interface language', async ({
  page,
}) => {
  await page.goto('/en/blog/obsidian-wayland-app-id-mismatch/');

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('article[data-article-page]')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.locator('.article-fallback-notice')).toBeVisible();
});
