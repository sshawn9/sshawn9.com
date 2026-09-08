import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const commitUrl = `https://github.com/sshawn9/sshawn9.com/commit/${commitSha}`;

test('only About footers render the source commit in built HTML and client navigation', async ({
  page,
}) => {
  await page
    .context()
    .route(commitUrl, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Git commit</title>' }),
    );
  for (const locale of ['en', 'zh']) {
    const html = await readFile(
      new URL(`../../../apps/site/dist/${locale}/about/index.html`, import.meta.url),
      'utf8',
    );
    expect(html.match(/<footer\b[^>]*>[\s\S]*?<\/footer>/)?.[0]).toContain(commitUrl);

    await page.goto(`/${locale}/blog/`);
    const commit = page.locator('.site-footer__commit');
    await expect(commit).toHaveCount(0);
    await expect(page.locator('.site-footer a')).toHaveText('SHAWN');
    await expect(page.locator('.site-footer a')).toHaveAttribute('href', `/${locale}/`);
    await page.locator(`.site-header__desktop a[href="/${locale}/about/"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/about/$`));
    await expect(page.locator('.site-footer a')).toHaveCount(1);
    await expect(commit).toHaveText(`SHAWN@${commitSha.slice(0, 7)}`);
    await expect(commit).toHaveAttribute('href', commitUrl);
    await expect(commit).toHaveAttribute('title', commitSha);
    await expect(commit).toHaveAttribute('target', '_blank');
    await expect(commit).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(page.locator('.site-footer .site-footer__commit')).toBeVisible();
    await expect(page.locator('main .site-footer__commit')).toHaveCount(0);

    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await commit.scrollIntoViewIfNeeded();
      const geometry = await commit.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          viewport: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport);
    }

    const [popup] = await Promise.all([page.waitForEvent('popup'), commit.click()]);
    await expect(popup).toHaveURL(commitUrl);
    await expect(popup).toHaveTitle('Git commit');
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/${locale}/about/$`));
    await popup.close();

    await page.reload();
    await expect(commit).toHaveAttribute('href', commitUrl);
    await page.locator(`.site-header__desktop a[href="/${locale}/blog/"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/blog/$`));
    await expect(commit).toHaveCount(0);
    await expect(page.locator('.site-footer a')).toHaveText('SHAWN');
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/${locale}/about/$`));
    await expect(commit).toHaveAttribute('href', commitUrl);
  }
});
