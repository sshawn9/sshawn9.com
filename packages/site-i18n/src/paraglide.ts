import { fileURLToPath } from 'node:url';
import { paraglideVitePlugin } from '@inlang/paraglide-js';

const repositoryRoot = new URL('../../../', import.meta.url);

/**
 * Both site applications compile the same message catalog and locale strategy.
 * Keeping this configuration here prevents their generated runtimes from drifting.
 */
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
