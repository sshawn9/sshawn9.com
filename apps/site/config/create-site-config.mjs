import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { createSiteParaglidePlugin } from '@sshawn9/site-i18n/paraglide';
import solid from '@astrojs/solid-js';
import { envField, fontProviders } from 'astro/config';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { developmentFontAssets } from './development-font-assets.mjs';
import { classicScriptBundles } from './classic-script-bundles.mjs';
import { createMarkdownProcessor } from './markdown.ts';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const outputDirectory = new URL('../dist/', import.meta.url);
const site = 'https://sshawn9.com';

function createIndexabilityResolver() {
  const results = new Map();

  return async (pageUrl) => {
    if (results.has(pageUrl)) return results.get(pageUrl);

    const result = (async () => {
      const pathname = new URL(pageUrl).pathname;
      const relativePath = `${pathname.replace(/^\//, '')}${pathname.endsWith('/') ? 'index.html' : ''}`;
      try {
        const html = await readFile(new URL(relativePath, outputDirectory), 'utf8');
        return !/<meta name="robots" content="[^"]*\bnoindex\b/.test(html);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return true;
        }
        throw error;
      }
    })();

    results.set(pageUrl, result);
    return result;
  };
}

export function createSiteConfig({ integrations = [], viteServer = {} } = {}) {
  const buildId = randomUUID();
  const previewBuild = process.env.SITE_MODE === 'preview';
  const localFonts = fontProviders.local();
  const isIndexablePage = createIndexabilityResolver();

  return {
    site,
    output: 'static',
    trailingSlash: 'always',
    fonts: [
      {
        provider: localFonts,
        name: 'Manrope Variable',
        cssVariable: '--font-manrope',
        display: 'block',
        options: {
          variants: [
            {
              src: ['@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2'],
              weight: '200 800',
              style: 'normal',
            },
          ],
        },
        weights: ['200 800'],
        styles: ['normal'],
        subsets: ['latin'],
        fallbacks: ['Noto Sans SC Variable'],
        optimizedFallbacks: false,
      },
      {
        provider: localFonts,
        name: 'Source Sans 3 Variable',
        cssVariable: '--font-source-sans-3',
        display: 'block',
        options: {
          variants: [
            {
              src: [
                '@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2',
              ],
              weight: '200 900',
              style: 'normal',
            },
            {
              src: [
                '@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-italic.woff2',
              ],
              weight: '200 900',
              style: 'italic',
            },
          ],
        },
        weights: ['200 900'],
        styles: ['normal', 'italic'],
        subsets: ['latin'],
        fallbacks: ['Noto Sans SC Variable'],
        optimizedFallbacks: false,
      },
      {
        provider: localFonts,
        name: 'JetBrains Mono Variable',
        cssVariable: '--font-jetbrains-mono',
        display: 'block',
        options: {
          variants: [
            {
              src: [
                '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
              ],
              weight: '100 800',
              style: 'normal',
            },
          ],
        },
        weights: ['100 800'],
        styles: ['normal'],
        subsets: ['latin'],
        fallbacks: ['Noto Sans SC Variable'],
        optimizedFallbacks: false,
      },
    ],
    env: {
      schema: {
        SITE_MODE: envField.enum({
          context: 'server',
          access: 'secret',
          values: ['production', 'preview'],
          default: 'production',
        }),
      },
    },
    markdown: {
      processor: createMarkdownProcessor(),
    },
    integrations: [
      ...integrations,
      solid(),
      mdx({ processor: createMarkdownProcessor() }),
      ...(previewBuild
        ? []
        : [
            sitemap({
              filter: (page) =>
                page !== `${site}/` &&
                !page.includes('/compare/') &&
                !page.includes('/v/') &&
                !page.endsWith('/search/'),
              i18n: {
                defaultLocale: 'en',
                locales: { en: 'en', zh: 'zh-CN' },
              },
              serialize: async (item) => {
                if (!(await isIndexablePage(item.url))) return undefined;
                if (item.links) {
                  const links = await Promise.all(
                    item.links.map(async (link) => ({
                      link,
                      indexable: await isIndexablePage(link.url),
                    })),
                  );
                  item.links = links.filter(({ indexable }) => indexable).map(({ link }) => link);
                }
                return item;
              },
            }),
          ]),
    ],
    i18n: {
      defaultLocale: 'en',
      locales: ['en', 'zh'],
      routing: {
        prefixDefaultLocale: true,
        redirectToDefaultLocale: false,
      },
    },
    vite: {
      plugins: [classicScriptBundles(), ...developmentFontAssets(), createSiteParaglidePlugin()],
      define: {
        // Astro can replace import.meta.env keys from private env before Vite's define runs.
        __SITE_BUILD_ID__: JSON.stringify(buildId),
      },
      server: {
        ...viteServer,
        fs: {
          allow: [repositoryRoot],
        },
      },
      ssr: {
        noExternal: ['@sshawn9/content-ui'],
      },
    },
  };
}
