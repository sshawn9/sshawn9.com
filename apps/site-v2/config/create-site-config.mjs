import mdx from '@astrojs/mdx';
import { createMarkdownProcessor } from '@sshawn9/site-build/markdown';
import { createSiteParaglidePlugin } from '@sshawn9/site-i18n/paraglide';
import solid from '@astrojs/solid-js';
import { envField, fontProviders } from 'astro/config';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const publicDirectory = fileURLToPath(new URL('../../../public', import.meta.url));

export function createSiteConfig({ integrations = [], viteServer = {} } = {}) {
  const buildId = process.env.V2_BUILD_ID ?? '';
  const localFonts = fontProviders.local();

  return {
    site: 'https://sshawn9.com',
    publicDir: publicDirectory,
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
    markdown: {
      processor: createMarkdownProcessor(),
    },
    integrations: [...integrations, solid(), mdx({ processor: createMarkdownProcessor() })],
    i18n: {
      defaultLocale: 'en',
      locales: ['en', 'zh'],
      routing: {
        prefixDefaultLocale: true,
        redirectToDefaultLocale: false,
      },
    },
    vite: {
      plugins: [createSiteParaglidePlugin()],
      define: {
        'import.meta.env.V2_BUILD_ID': JSON.stringify(buildId),
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
