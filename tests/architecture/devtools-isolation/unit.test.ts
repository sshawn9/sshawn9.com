import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, readFile, repositoryRoot } from '../source-files';

describe('development tool isolation', () => {
  it('keeps development tools outside the production application graph', async () => {
    const violations: string[] = [];
    for (const path of await collectSourceFiles(join(repositoryRoot, 'apps/site/src'))) {
      if (/from\s+['"][^'"]*devtools\//.test(await readFile(path, 'utf8')))
        violations.push(relative(repositoryRoot, path));
    }
    const config = await readFile(join(repositoryRoot, 'apps/site/astro.config.mjs'), 'utf8');
    expect(violations).toEqual([]);
    expect(config).not.toContain('devtools');
    expect(config).not.toContain('content-health');
  });
});
