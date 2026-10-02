import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { createServer } from 'vite';
import { describe, expect, it, vi } from 'vitest';

const bundledSource = {
  value: '(() => { window.__wallpaperBundle = "first"; })();',
};
const compile = vi.fn(async () => ({
  metafile: {
    inputs: {
      'src/features/appearance/wallpaper/entry.ts': {},
      '../../packages/site-domain/src/wallpaper.ts': {},
    },
  },
  outputFiles: [{ text: bundledSource.value }],
}));

// The app and the repository root can resolve different esbuild installations.
const compiler = createRequire(
  new URL('../../../apps/site/config/classic-script-bundles.mjs', import.meta.url),
).resolve('esbuild');
vi.doMock(compiler, async (importOriginal) => {
  const esbuild = await importOriginal<typeof import('esbuild')>();
  return {
    ...esbuild,
    build: compile,
  };
});

// Bind the plugin to the app compiler mock, not the root's transitive dependency.
const { classicScriptBundles } =
  await import('../../../apps/site/config/classic-script-bundles.mjs');

describe('wallpaper classic-script delivery', () => {
  it('compiles on demand, reuses dev results, and invalidates changed dependencies', async () => {
    bundledSource.value = '(() => { window.__wallpaperBundle = "first"; })();';
    compile.mockClear();
    const server = await createServer({
      configFile: false,
      publicDir: false,
      logLevel: 'silent',
      plugins: [classicScriptBundles()],
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true },
    });
    try {
      const { default: url } = await server.ssrLoadModule('virtual:site-wallpaper-script-url');
      expect(compile).not.toHaveBeenCalled();
      const first = await server.transformRequest(url);
      expect(first?.code).toContain('"first"');
      expect(() => new Script(first!.code)).not.toThrow();
      await server.transformRequest(url);
      expect(compile).toHaveBeenCalledTimes(1);

      bundledSource.value = '(() => { window.__wallpaperBundle = "changed"; })();';
      const changedFile = fileURLToPath(
        new URL('../../../packages/site-domain/src/wallpaper.ts', import.meta.url),
      );
      expect([...server.environments.client.moduleGraph.fileToModulesMap.keys()]).toContain(
        changedFile,
      );
      server.watcher.emit('change', changedFile);
      await expect
        .poll(async () => (await server.transformRequest(url))?.code)
        .toContain('"changed"');
      expect(compile).toHaveBeenCalledTimes(2);
    } finally {
      await server.close();
    }
  });
});
