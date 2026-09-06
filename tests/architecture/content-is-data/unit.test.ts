import { extname, join, relative } from 'node:path';
import { readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readFile, repositoryRoot } from '../source-files';

async function collectContentFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? collectContentFiles(path) : [path];
      }),
    )
  ).flat();
}

describe('content is data', () => {
  it('keeps implementation files out of content and routes interactive imports through content-ui', async () => {
    const contentFiles = await collectContentFiles(join(repositoryRoot, 'src/content'));
    const implementationExtensions = new Set(['.astro', '.css', '.ts', '.tsx']);
    expect(
      contentFiles
        .filter((path) => implementationExtensions.has(extname(path)))
        .map((path) => relative(repositoryRoot, path)),
    ).toEqual([]);
    const applicationImports: string[] = [];
    for (const path of contentFiles.filter((path) => extname(path) === '.mdx')) {
      if (
        /from\s+["'](?:\.\.\/)+(?:components|i18n|lib|paraglide|styles)\//.test(
          await readFile(path, 'utf8'),
        )
      )
        applicationImports.push(relative(repositoryRoot, path));
    }
    expect(applicationImports).toEqual([]);
  });
});
