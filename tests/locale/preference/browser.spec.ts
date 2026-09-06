import { expect, test } from '@playwright/test';

test('the neutral entry redirects from the saved locale without losing URL state', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('PARAGLIDE_LOCALE', 'zh'));
  await page.goto('/?source=direct#intro');
  await expect(page).toHaveURL(/\/zh\/\?source=direct#intro$/);
});
