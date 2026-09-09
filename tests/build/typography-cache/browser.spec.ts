import { expect, test } from '@playwright/test';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const distRoot = new URL('../../../apps/site/dist/', import.meta.url);
const typographyPattern = /^\/_astro\/typography-vendor\.[\w-]+\.css$/;

function stylesheetHrefs(html: string): string[] {
  return Array.from(
    html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g),
    (match) => match[1],
  );
}

async function readBuiltDocument(relativePath: string) {
  const html = await readFile(new URL(relativePath, distRoot), 'utf8');
  const stylesheets = stylesheetHrefs(html);
  const typography = stylesheets.filter((href) => typographyPattern.test(href));

  expect(typography, `${relativePath} must link one independent typography asset`).toHaveLength(1);
  const typographyIndex = stylesheets.indexOf(typography[0]);
  const siteStylesheets = stylesheets.filter((href) => href !== typography[0]);
  expect(siteStylesheets.length, `${relativePath} must retain its site stylesheet`).toBeGreaterThan(
    0,
  );
  expect(
    siteStylesheets.every((href) => typographyIndex < stylesheets.indexOf(href)),
    `${relativePath} must load vendor CSS before site CSS so site rules win the cascade`,
  ).toBe(true);

  return typography[0];
}

test('built pages share one independent typography stylesheet with emitted fonts', async () => {
  const pageTypography = await readBuiltDocument('zh/about/index.html');
  const fallbackTypography = await readBuiltDocument('404.html');
  expect(fallbackTypography).toBe(pageTypography);

  const css = await readFile(new URL(`.${pageTypography}`, distRoot), 'utf8');
  expect(css).toContain('Noto Sans SC Variable');
  expect(css).toContain('KaTeX_Main');

  const fontReferences = Array.from(css.matchAll(/url\(([^)]+)\)/g), (match) =>
    match[1].replace(/^["']|["']$/g, ''),
  ).filter((url) => !url.startsWith('data:'));
  expect(fontReferences.length).toBeGreaterThan(0);
  expect(fontReferences.some((url) => url.includes('noto-sans-sc'))).toBe(true);
  expect(fontReferences.some((url) => url.includes('KaTeX_'))).toBe(true);

  await Promise.all(
    fontReferences.map(async (reference) => {
      const pathname = new URL(reference, 'https://sshawn9.com').pathname;
      expect(pathname).toMatch(/^\/_astro\//);
      await access(fileURLToPath(new URL(`.${pathname}`, distRoot)));
    }),
  );
});

test('client navigation to Chinese math content keeps the global vendor URL', async ({ page }) => {
  await page.goto('/zh/about/', { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');

  const typographyLink = page.locator('link[rel="stylesheet"][href*="typography-vendor."]');
  await expect(typographyLink).toHaveCount(1);
  const initialUrl = await typographyLink.getAttribute('href');
  expect(initialUrl).toMatch(typographyPattern);

  const initialFamilies = await page.evaluate(() =>
    Array.from(document.fonts, (font) => font.family),
  );
  expect(initialFamilies.some((family) => family.includes('Noto Sans SC Variable'))).toBe(true);
  expect(initialFamilies.some((family) => family.includes('KaTeX_Main'))).toBe(true);
  const originalDocument = await page.evaluateHandle(() => document);

  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = '/zh/blog/planar-frenet-frame/';
    document.body.append(link);
    link.click();
  });

  await expect(page).toHaveURL(/\/zh\/blog\/planar-frenet-frame\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('html')).toHaveAttribute('data-font-state', 'ready');
  await expect(page.locator('[data-article-page]')).toBeVisible();
  await expect(page.locator('.katex').first()).toBeVisible();
  expect(await originalDocument.evaluate((previous) => previous === document)).toBe(true);
  await originalDocument.dispose();
  await expect(typographyLink).toHaveCount(1);
  await expect(typographyLink).toHaveAttribute('href', initialUrl!);
  await expect(page.locator('.article-prose .katex-display').first()).toHaveCSS(
    'overflow-x',
    'auto',
  );

  const stylesheetOrder = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
      (link) => new URL(link.href).pathname,
    ),
  );
  const vendorIndex = stylesheetOrder.findIndex((href) => typographyPattern.test(href));
  expect(vendorIndex).toBeGreaterThanOrEqual(0);
  expect(stylesheetOrder.slice(vendorIndex + 1).some((href) => href.endsWith('.css'))).toBe(true);
});
