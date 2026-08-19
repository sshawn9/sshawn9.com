// @ts-check
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig, envField, fontProviders } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import solid from '@astrojs/solid-js';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import expressiveCode from 'astro-expressive-code';
import rehypeExternalLinks from 'rehype-external-links';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

const site = 'https://sshawn9.com';
const isPreviewBuild = process.env.SITE_MODE === 'preview';
const outDirUrl = new URL('./dist/', import.meta.url);
const localFonts = fontProviders.local();
/** @type {Map<string, Promise<boolean>>} */
const indexability = new Map();

const createMarkdownProcessor = () =>
  unified({
    remarkPlugins: [remarkMath],
    rehypePlugins: [
      rehypeKatex,
      [rehypeExternalLinks, { target: '_blank', rel: ['noopener', 'noreferrer'] }],
    ],
  });

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
      fallbacks: ['Noto Sans SC Variable', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
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
            src: ['@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2'],
            weight: '200 900',
            style: 'normal',
          },
          {
            src: ['@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-italic.woff2'],
            weight: '200 900',
            style: 'italic',
          },
        ],
      },
      weights: ['200 900'],
      styles: ['normal', 'italic'],
      subsets: ['latin'],
      fallbacks: ['Noto Sans SC Variable', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
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
  image: {
    layout: 'constrained',
    responsiveStyles: true,
  },
  markdown: {
    processor: createMarkdownProcessor(),
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
        return /\.zh\.(?:md|mdx)$/.test(source) ? 'zh-CN' : 'en-US';
      },
      defaultProps: { wrap: true },
      styleOverrides: {
        borderRadius: '0.9rem',
        codeFontFamily: 'var(--font-code)',
      },
    }),
    mdx({ processor: createMarkdownProcessor() }),
    ...(isPreviewBuild
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
                const linkIndexability = await Promise.all(
                  item.links.map(async (link) => ({
                    link,
                    indexable: await isIndexablePage(link.url),
                  })),
                );
                item.links = linkIndexability
                  .filter(({ indexable }) => indexable)
                  .map(({ link }) => link);
              }
              return item;
            },
          }),
        ]),
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
