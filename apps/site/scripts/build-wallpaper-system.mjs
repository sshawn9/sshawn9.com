import { build, context } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const siteRoot = fileURLToPath(new URL('../', import.meta.url));
const entryPoint = fileURLToPath(
  new URL('../src/features/appearance/wallpaper/entry.ts', import.meta.url),
);
const outputDirectory = fileURLToPath(new URL('../public/_runtime/', import.meta.url));
const outfile = fileURLToPath(
  new URL('../public/_runtime/wallpaper-system-v3.js', import.meta.url),
);
const watch = process.argv.includes('--watch');

await mkdir(outputDirectory, { recursive: true });

const options = {
  absWorkingDir: siteRoot,
  entryPoints: [entryPoint],
  outfile,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info',
};

if (watch) {
  const buildContext = await context(options);
  await buildContext.watch();
  const dispose = async () => {
    await buildContext.dispose();
    process.exit(0);
  };
  process.once('SIGINT', dispose);
  process.once('SIGTERM', dispose);
  await new Promise(() => {});
} else {
  await build(options);
}
