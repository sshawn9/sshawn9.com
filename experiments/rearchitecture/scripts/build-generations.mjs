import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const experimentRoot = fileURLToPath(new URL('..', import.meta.url));
const outputRoot = resolve(experimentRoot, '.cross-generation-builds');
const generations = [
  { id: 'generation-a', assets: '_astro-generation-a' },
  { id: 'generation-b', assets: '_astro-generation-b' },
];

await mkdir(outputRoot, { recursive: true });

for (const generation of generations) {
  const outputDirectory = resolve(outputRoot, generation.id);
  await runBuild({
    ...process.env,
    POC_ASSET_DIRECTORY: generation.assets,
    POC_BUILD_ID: generation.id,
    POC_OUTPUT_DIRECTORY: outputDirectory,
  });
}

function runBuild(environment) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('npm', ['run', 'build:astro'], {
      cwd: experimentRoot,
      env: environment,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(`Generation build failed (${signal ? `signal ${signal}` : `exit ${code}`}).`),
      );
    });
  });
}
