import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const buildInfoUrl = new URL('../../.astro/resource-inventory-build.json', import.meta.url);
export const fontPolicyUrl = new URL('../../src/runtime/required-fonts.ts', import.meta.url);
const manifestFile = 'resource-inventory.vite.json';

/** Shared enumeration for the final build snapshot and its later verification. */
export async function listBuildFiles(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const file = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listBuildFiles(directory, file)));
    else if (entry.isFile()) files.push(file);
    else throw new Error(`Unsupported build output entry: ${file}`);
  }
  return files.sort();
}

/** Capture Vite's public manifest without adding it to the deployed assets. */
export function captureClientManifest(onManifest) {
  return {
    name: 'site-resource-inventory',
    apply: 'build',
    enforce: 'post',
    configEnvironment(name) {
      if (name === 'client') return { build: { manifest: manifestFile } };
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        if (this.environment.name !== 'client') return;
        const output = bundle[manifestFile];
        if (!output || output.type !== 'asset') {
          throw new Error('Resource inventory: Vite did not produce its client manifest.');
        }
        const source =
          typeof output.source === 'string'
            ? output.source
            : new TextDecoder().decode(output.source);
        const manifest = JSON.parse(source);
        // Astro can fold client CSS into the document's SSR stylesheet or inline it.
        // Only emitted client styles belong to this graph; final HTML supplies the rest.
        for (const entry of Object.values(manifest)) {
          if (entry.css) entry.css = entry.css.filter((file) => file in bundle);
        }
        onManifest(manifest);
        delete bundle[manifestFile];
      },
    },
  };
}

/** Runs after all asset producers; parsing and reporting remain in the separate command. */
export function resourceInventoryBuildInfo({ buildId, mode }) {
  let manifest = {};
  let site;
  return {
    name: 'site-resource-inventory',
    hooks: {
      'astro:config:setup': ({ command, config, updateConfig }) => {
        if (command !== 'build') return;
        site = config.site;
        updateConfig({ vite: { plugins: [captureClientManifest((value) => (manifest = value))] } });
      },
      'astro:build:start': async () => {
        await rm(buildInfoUrl, { force: true });
      },
      'astro:build:done': async ({ dir }) => {
        const directory = fileURLToPath(dir);
        const fileHashes = Object.create(null);
        for (const file of await listBuildFiles(directory)) {
          fileHashes[file] = createHash('sha256')
            .update(await readFile(join(directory, file)))
            .digest('hex');
        }
        await mkdir(dirname(fileURLToPath(buildInfoUrl)), { recursive: true });
        await writeFile(
          buildInfoUrl,
          JSON.stringify(
            {
              buildId,
              mode,
              site,
              fileHashes,
              manifest,
              fontPolicyHash: createHash('sha256')
                .update(await readFile(fontPolicyUrl))
                .digest('hex'),
            },
            null,
            2,
          ) + '\n',
        );
      },
    },
  };
}
