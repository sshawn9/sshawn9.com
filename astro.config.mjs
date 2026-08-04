// @ts-check
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import solid from '@astrojs/solid-js';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import expressiveCode from 'astro-expressive-code';

const site = 'https://sshawn9.com';
const outDirUrl = new URL('./dist/', import.meta.url);
/** @type {Map<string, Promise<boolean>>} */
const indexability = new Map();

/** @param {string} url */
const isIndexablePage = async (url) => {
  if (indexability.has(url)) return indexability.get(url);

  const result = (async () => {
    const pathname = new URL(url).pathname;
    const relativePath = `${pathname.replace(/^\//, '')}${pathname.endsWith('/') ? 'index.html' : ''}`;
    try {
      const html = await readFile(new URL(relativePath, outDirUrl), 'utf8');
      return !/<meta name="robots" content="[^"]*\bnoindex\b/.test(html);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return true;
      }
      throw error;
    }
  })();

  indexability.set(url, result);
  return result;
};

export default defineConfig({
  site,
  outDir: fileURLToPath(outDirUrl),
  trailingSlash: 'always',
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh'],
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
  integrations: [
    solid(),
    expressiveCode({
      themes: ['github-dark', 'github-light'],
      useDarkModeMediaQuery: false,
      defaultLocale: 'en-US',
      getBlockLocale: ({ file }) => {
        const source = file.url?.pathname || file.path;
        return /\.zh\.md$/.test(source) ? 'zh-CN' : 'en-US';
      },
      defaultProps: { wrap: true },
      styleOverrides: {
        borderRadius: '0.9rem',
      },
    }),
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
          const linkIndexability = await Promise.all(
            item.links.map(async (link) => ({ link, indexable: await isIndexablePage(link.url) })),
          );
          item.links = linkIndexability
            .filter(({ indexable }) => indexable)
            .map(({ link }) => link);
        }
        return item;
      },
    }),
  ],
  vite: {
    plugins: [
      paraglideVitePlugin({
        project: './project.inlang',
        outdir: './src/paraglide',
        strategy: ['url', 'localStorage', 'preferredLanguage', 'globalVariable', 'baseLocale'],
        urlPatterns: [
          {
            pattern: '/',
            localized: [
              ['en', '/en'],
              ['zh', '/zh'],
            ],
          },
          {
            pattern: '/:path(.*)?',
            localized: [
              ['en', '/en/:path(.*)?'],
              ['zh', '/zh/:path(.*)?'],
            ],
          },
        ],
        emitTsDeclarations: false,
      }),
      tailwindcss(),
    ],
  },
});
