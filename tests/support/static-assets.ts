import { Miniflare } from 'miniflare';
import { fileURLToPath } from 'node:url';

export const builtSiteOutput = new URL('../../apps/site/dist/', import.meta.url);
export const builtSiteDirectory = fileURLToPath(builtSiteOutput);

export function createStaticAssetsServer(name: string): Miniflare {
  return new Miniflare({
    cf: false,
    logRequests: false,
    workers: [
      {
        config: {
          name,
          type: 'worker',
          compatibilityDate: '2026-08-10',
          // Static Assets handles these requests, not this unused Worker.
          manifest: {
            mainModule: 'unused.js',
            modules: {
              'unused.js': {
                type: 'esm',
                contents:
                  'export default { fetch() { return new Response(null, { status: 404 }); } };',
              },
            },
          },
          assets: {
            directory: builtSiteDirectory,
            hasUserWorker: false,
            htmlHandling: 'auto-trailing-slash',
            notFoundHandling: '404-page',
          },
        },
      },
    ],
  });
}
