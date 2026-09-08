import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, readFile, repositoryRoot } from '../source-files';

describe('public package exports', () => {
  it('keeps consumers on package exports instead of package source paths', async () => {
    const ownPath = fileURLToPath(import.meta.url);
    const sourceFiles = (
      await Promise.all(
        ['apps/site/src', 'tests', 'worker'].map((directory) =>
          collectSourceFiles(join(repositoryRoot, directory)),
        ),
      )
    )
      .flat()
      .filter((path) => path !== ownPath);
    const forbidden = [
      'packages/content-ui/src',
      'packages/site-domain/src',
      'packages/site-i18n/src',
      '@site-domain/',
    ];
    const violations: string[] = [];
    for (const path of sourceFiles) {
      const source = await readFile(path, 'utf8');
      const specifiers = source.matchAll(/(?:from\s+|import\s*(?:\(\s*)?)["']([^"']+)["']/g);
      if ([...specifiers].some((match) => forbidden.some((entry) => match[1]?.includes(entry)))) {
        violations.push(relative(repositoryRoot, path));
      }
    }
    expect(violations).toEqual([]);
  });
});
