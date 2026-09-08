import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, readFile, repositoryRoot } from '../source-files';

describe('shared package dependency direction', () => {
  it('keeps shared packages from reaching back into application source', async () => {
    const roots = ['content-ui', 'site-domain', 'site-i18n'].map((name) =>
      join(repositoryRoot, 'packages', name),
    );
    const violations: string[] = [];
    for (const packageRoot of roots)
      for (const path of await collectSourceFiles(join(packageRoot, 'src'))) {
        const source = await readFile(path, 'utf8');
        for (const match of source.matchAll(/(?:from\s+|import\s*\()["']([^"']+)/g)) {
          const specifier = match[1];
          if (!specifier?.startsWith('.')) continue;
          if (relative(packageRoot, resolve(dirname(path), specifier)).startsWith('..'))
            violations.push(`${relative(repositoryRoot, path)} -> ${specifier}`);
        }
      }
    expect(violations).toEqual([]);
  });
});
