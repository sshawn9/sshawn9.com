import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

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

const resolvedPrefix = '\0site-inline-script:';

async function bundleEntry(entryUrl, addWatchFile) {
  const result = await build({
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

  for (const input of Object.keys(result.metafile.inputs)) addWatchFile(input);
  const output = result.outputFiles[0];
  if (!output) throw new Error(`No inline script was generated for ${entryUrl.href}`);
  return output.text.trim();
}

/** Builds parser-executed TypeScript entries as inline classic scripts. */
export function inlineScriptBundles() {
  return {
    name: 'site-inline-script-bundles',
    enforce: 'pre',
    resolveId(id) {
      return virtualEntries.has(id) ? `${resolvedPrefix}${id}` : undefined;
    },
    async load(id) {
      if (!id.startsWith(resolvedPrefix)) return undefined;
      const publicId = id.slice(resolvedPrefix.length);
      const entryUrl = virtualEntries.get(publicId);
      if (!entryUrl) return undefined;

      const source = await bundleEntry(entryUrl, (path) => this.addWatchFile(path));
      return `export default ${JSON.stringify(source)};`;
    },
  };
}
