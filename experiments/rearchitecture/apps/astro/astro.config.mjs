import svelte from '@astrojs/svelte';
import { defineConfig } from 'astro/config';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BUILD_ID = 'astro-generation-1';
const DEFAULT_ASSET_DIRECTORY = '_astro';
const SAFE_SEGMENT = /^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,63}$/;

function readBuildSetting(name, fallback) {
  const value = process.env[name]?.trim() || fallback;
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(`${name} must be a safe, non-empty path segment.`);
  }
  return value;
}

const buildId = readBuildSetting('POC_BUILD_ID', DEFAULT_BUILD_ID);
const assetDirectory = readBuildSetting('POC_ASSET_DIRECTORY', DEFAULT_ASSET_DIRECTORY);
const experimentRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const requestedOutputDirectory = process.env.POC_OUTPUT_DIRECTORY?.trim();
const outputDirectory = requestedOutputDirectory ? resolve(requestedOutputDirectory) : undefined;
if (outputDirectory && !outputDirectory.startsWith(experimentRoot + sep)) {
  throw new Error('POC_OUTPUT_DIRECTORY must stay inside the experiment root.');
}

export default defineConfig({
  integrations: [svelte()],
  output: 'static',
  ...(outputDirectory ? { outDir: outputDirectory } : {}),
  trailingSlash: 'always',
  build: {
    assets: assetDirectory,
  },
  vite: {
    define: {
      __POC_BUILD_ID__: JSON.stringify(buildId),
    },
    resolve: {
      alias: {
        '@poc-shared': fileURLToPath(new URL('../../shared', import.meta.url)),
      },
    },
  },
});
