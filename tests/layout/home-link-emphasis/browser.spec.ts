import { expect, test } from '@playwright/test';

test('homepage project and recent-article titles stay quiet until interaction', async ({
  page,
}) => {
  await page.goto('/en/');
  const projectTitle = page.getByRole('link', { name: '自动驾驶运动控制' });
  const recentArticleTitle = page.getByRole('link', {
    name: 'From Page Transitions to a Persistent Shell: Governing the Client Lifecycle of My Website',
  });
  await expect(projectTitle).toHaveCSS('text-decoration-line', 'none');
  await expect(recentArticleTitle).toHaveCSS('text-decoration-line', 'none');
  await projectTitle.hover();
  await expect(projectTitle).toHaveCSS('text-decoration-line', 'underline');
  await recentArticleTitle.hover();
  await expect(recentArticleTitle).toHaveCSS('text-decoration-line', 'underline');
});
