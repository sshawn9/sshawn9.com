import { emitClientAsset } from 'astro/assets/utils';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const virtualEntries = new Map([
  [
    'virtual:site-initial-document-script',
    new URL('../src/runtime/entries/initial-document.ts', import.meta.url),
  ],
  [
    'virtual:site-locale-entry-script',
    new URL('../src/runtime/entries/locale-entry.ts', import.meta.url),
  ],
  [
    'virtual:site-fallback-locale-script',
    new URL('../src/runtime/entries/fallback-locale.ts', import.meta.url),
  ],
]);

const resolvedPrefix = '\0site-classic-script:';
const wallpaperUrlId = 'virtual:site-wallpaper-script-url';
const wallpaperEntry = new URL('../src/features/appearance/wallpaper/entry.ts', import.meta.url);
const wallpaperScriptId = `${fileURLToPath(wallpaperEntry)}?site-classic-script`;

async function bundleEntry(entryUrl, addWatchFile) {
  const result = await build({
    absWorkingDir: siteRoot,
    entryPoints: [fileURLToPath(entryUrl)],
    bundle: true,
    charset: 'utf8',
    format: 'iife',
    legalComments: 'none',
    metafile: true,
    minify: true,
    platform: 'browser',
    target: 'es2022',
    write: false,
  });

  for (const input of Object.keys(result.metafile.inputs)) addWatchFile(resolve(siteRoot, input));
  const output = result.outputFiles[0];
  if (!output) throw new Error(`No classic script was generated for ${entryUrl.href}`);
  return output.text;
}

/** Builds parser-executed TypeScript entries without changing them into deferred modules.
 * @returns {import('vite').Plugin}
 */
export function classicScriptBundles() {
  let development = false;
  let base = '/';
  return {
    name: 'site-classic-script-bundles',
    enforce: 'pre',
    configResolved(config) {
      development = config.command === 'serve';
      base = config.base;
    },
    resolveId(id) {
      return virtualEntries.has(id) || id === wallpaperUrlId ? `${resolvedPrefix}${id}` : undefined;
    },
    async load(id) {
      if (id === `${resolvedPrefix}${wallpaperUrlId}`) {
        // Dev requests participate in Vite's normal module cache and file watching.
        if (development)
          return `export default ${JSON.stringify(`${base}@fs${wallpaperScriptId}`)};`;

        const source = await bundleEntry(wallpaperEntry, (path) => this.addWatchFile(path));
        const asset = emitClientAsset(this, { type: 'asset', name: 'wallpaper-system.js', source });
        return `export default import.meta.ROLLDOWN_FILE_URL_${asset};`;
      }
      if (!id.startsWith(resolvedPrefix)) return undefined;
      const publicId = id.slice(resolvedPrefix.length);
      const entryUrl = virtualEntries.get(publicId);
      if (!entryUrl) return undefined;

      const source = await bundleEntry(entryUrl, (path) => this.addWatchFile(path));
      return `export default ${JSON.stringify(source.trim())};`;
    },
    transform(_source, id) {
      if (id === wallpaperScriptId) {
        return bundleEntry(wallpaperEntry, (path) => this.addWatchFile(path));
      }
    },
    resolveFileUrl({ moduleId, fileName }) {
      if (moduleId === `${resolvedPrefix}${wallpaperUrlId}`) {
        return JSON.stringify(`${base}${fileName}`);
      }
    },
  };
}
