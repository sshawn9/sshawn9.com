import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, readFile, repositoryRoot } from '../source-files';

describe('domain package independence', () => {
  it('keeps the domain package independent from frameworks and platform APIs', async () => {
    const externalImports = new Set<string>();
    for (const path of await collectSourceFiles(join(repositoryRoot, 'packages/site-domain/src'))) {
      const source = await readFile(path, 'utf8');
      for (const match of source.matchAll(/(?:from\s+|import\s*\()["']([^"']+)/g)) {
        const specifier = match[1];
        if (specifier && !specifier.startsWith('.')) externalImports.add(specifier);
      }
    }
    expect([...externalImports].sort()).toEqual(['github-slugger']);
  });
});
