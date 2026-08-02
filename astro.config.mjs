// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import expressiveCode from 'astro-expressive-code';

const site = 'https://sshawn9.com';

export default defineConfig({
  site,
  trailingSlash: 'always',
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
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
    expressiveCode({
      themes: ['github-dark', 'github-light'],
      useDarkModeMediaQuery: false,
      defaultLocale: 'en-US',
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
    }),
  ],
  vite: {
    plugins: [
      paraglideVitePlugin({
        project: './project.inlang',
        outdir: './src/paraglide',
        strategy: ['url', 'localStorage', 'preferredLanguage', 'baseLocale'],
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
