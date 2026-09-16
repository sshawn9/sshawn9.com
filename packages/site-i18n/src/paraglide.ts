import { fileURLToPath } from 'node:url';
import { paraglideVitePlugin } from '@inlang/paraglide-js';

const repositoryRoot = new URL('../../../', import.meta.url);

/** Shared message catalog compilation and locale strategy for the site. */
export function createSiteParaglidePlugin() {
  return paraglideVitePlugin({
    project: fileURLToPath(new URL('project.inlang', repositoryRoot)),
    outdir: fileURLToPath(new URL('packages/site-i18n/generated', repositoryRoot)),
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
    emitTsDeclarations: true,
  });
}
