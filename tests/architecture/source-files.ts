import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sourceExtensions = new Set(['.astro', '.mjs', '.ts', '.tsx']);

export async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        if (entry.name === '.results') return [];
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return collectSourceFiles(path);
        return sourceExtensions.has(extname(entry.name)) ? [path] : [];
      }),
    )
  ).flat();
}

export { readFile };
