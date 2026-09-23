import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, isRunnableDevEnvironment } from 'vite';
import solid from 'vite-plugin-solid';
import { expect, test } from 'vitest';
import { createSiteConfig } from '../../../apps/site/config/create-site-config.mjs';

const siteRoot = fileURLToPath(new URL('../../../apps/site/', import.meta.url));
const component = fileURLToPath(
  new URL(
    '../../../packages/content-ui/src/features/frenet-explorer/FrenetExplorer.tsx',
    import.meta.url,
  ),
);

test(
  'imports the Frenet client island safely during SSR, including after invalidation',
  { timeout: 30_000 },
  async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'site-solid-ssr-'));
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      server = await createServer({
        root: siteRoot,
        configFile: false,
        publicDir: false,
        appType: 'custom',
        cacheDir,
        logLevel: 'silent',
        plugins: [solid({ ssr: true })],
        ssr: createSiteConfig().vite.ssr,
        server: { middlewareMode: true, hmr: false, ws: false, watch: null },
        optimizeDeps: { noDiscovery: true },
      });
      const environment = server.environments.ssr!;
      if (!isRunnableDevEnvironment(environment))
        throw new Error('Expected a runnable SSR environment');
      // Import the real component graph in Node. The island is client-only, but
      // Astro's development MDX asset collection still evaluates its imports.
      const initial = await environment.runner.import(component);
      expect(initial.default).toBeTypeOf('function');

      environment.moduleGraph.invalidateAll();
      environment.runner.clearCache();
      const refreshed = await environment.runner.import(component);
      expect(refreshed.default).toBeTypeOf('function');
      expect(refreshed.default).not.toBe(initial.default);
    } finally {
      try {
        await server?.close();
      } finally {
        await rm(cacheDir, { recursive: true, force: true });
      }
    }
  },
);
