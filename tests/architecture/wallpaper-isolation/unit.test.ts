import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSourceFiles, readFile, repositoryRoot } from '../source-files';

describe('wallpaper feature isolation', () => {
  it('keeps wallpaper independent from page and navigation runtimes', async () => {
    const sourceRoot = join(repositoryRoot, 'apps/site/src');
    const wallpaperRoot = join(sourceRoot, 'features/appearance/wallpaper');
    const applicationSources = (await collectSourceFiles(sourceRoot)).filter(
      (path) => !path.startsWith(`${wallpaperRoot}/`),
    );
    const consumers: string[] = [];
    for (const path of applicationSources)
      if (/from\s+['"][^'"]*appearance\/wallpaper\//.test(await readFile(path, 'utf8')))
        consumers.push(relative(repositoryRoot, path));
    const forbiddenDependencies: string[] = [];
    for (const path of await collectSourceFiles(wallpaperRoot))
      if (
        /from\s+['"][^'"]*(?:runtime|components|pages|layouts)\//.test(await readFile(path, 'utf8'))
      )
        forbiddenDependencies.push(relative(repositoryRoot, path));
    expect(consumers).toEqual([]);
    expect(forbiddenDependencies).toEqual([]);
  });
});
