import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { build as viteBuild, createServer } from 'vite';
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

const fixtureId = 'virtual:wallpaper-script-delivery-fixture';

async function buildFixture(buildId: string) {
  const result = await viteBuild({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    define: { __SITE_BUILD_ID__: JSON.stringify(buildId) },
    plugins: [
      classicScriptBundles(),
      {
        name: 'wallpaper-script-delivery-fixture',
        resolveId(id) {
          return id === fixtureId ? id : undefined;
        },
        load(id) {
          if (id !== fixtureId) return undefined;
          return [
            "import wallpaperScriptUrl from 'virtual:site-wallpaper-script-url';",
            'console.log(__SITE_BUILD_ID__, wallpaperScriptUrl);',
          ].join('\n');
        },
      },
    ],
    build: {
      write: false,
      rolldownOptions: {
        input: fixtureId,
        output: {
          assetFileNames: '_astro/[name].[hash][extname]',
          entryFileNames: '_astro/[name].[hash].js',
        },
      },
    },
  });
  if (Array.isArray(result) || !('output' in result)) {
    throw new Error('fixture build must return one in-memory output');
  }
  const output = result.output;
  const asset = output.find(
    (item) => item.type === 'asset' && /^_astro\/wallpaper-system\.[\w-]+\.js$/.test(item.fileName),
  );
  const entry = output.find((item) => item.type === 'chunk' && item.isEntry);

  if (!asset || !entry || entry.type !== 'chunk') {
    throw new Error('fixture build did not emit its wallpaper asset and entry');
  }
  const url = `/${asset.fileName}`;
  expect(entry.code).toContain(url);
  return { asset, url };
}

describe('wallpaper classic-script delivery', () => {
  it('uses a content-addressed _astro URL without a .cache output', async () => {
    const headers = await readFile(
      new URL('../../../apps/site/public/_headers', import.meta.url),
      'utf8',
    );
    expect(headers).toContain('/_astro/*\n  Cache-Control: public, max-age=31536000, immutable');

    const first = await buildFixture('first-build-id');
    const second = await buildFixture('second-build-id');
    expect(second.url).toBe(first.url);
    expect(first.asset.fileName).not.toContain('.cache');

    bundledSource.value = '(() => { window.__wallpaperBundle = "changed"; })();';
    const changed = await buildFixture('third-build-id');
    expect(changed.url).not.toBe(first.url);
  });

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
