import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const sourceExtensions = new Set(['.astro', '.mjs', '.ts', '.tsx']);

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectSourceFiles(path);
      return sourceExtensions.has(extname(entry.name)) ? [path] : [];
    }),
  );
  return files.flat();
}

describe('architecture boundaries', () => {
  it('consumers use package exports instead of package source paths', async () => {
    const sourceFiles = (
      await Promise.all(
        ['apps/site/src', 'tests/unit', 'worker'].map((directory) =>
          collectSourceFiles(join(repositoryRoot, directory)),
        ),
      )
    )
      .flat()
      .filter((path) => !path.endsWith('architecture-boundaries.test.ts'));
    const forbiddenImports = [
      'packages/content-ui/src',
      'packages/site-build/src',
      'packages/site-domain/src',
      'packages/site-i18n/src',
      '@site-domain/',
    ];
    const violations: string[] = [];

    for (const path of sourceFiles) {
      const source = await readFile(path, 'utf8');
      if (forbiddenImports.some((specifier) => source.includes(specifier))) {
        violations.push(path.slice(repositoryRoot.length + 1));
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps the domain package independent from frameworks and platform APIs', async () => {
    const sourceFiles = await collectSourceFiles(join(repositoryRoot, 'packages/site-domain/src'));
    const externalImports = new Set<string>();

    for (const path of sourceFiles) {
      const source = await readFile(path, 'utf8');
      for (const match of source.matchAll(/(?:from\s+|import\s*\()["']([^"']+)/g)) {
        const specifier = match[1];
        if (specifier && !specifier.startsWith('.')) externalImports.add(specifier);
      }
    }

    expect([...externalImports].sort()).toEqual(['github-slugger']);
  });

  it('keeps development tools outside the production application graph', async () => {
    const productionSources = await collectSourceFiles(join(repositoryRoot, 'apps/site/src'));
    const violations: string[] = [];

    for (const path of productionSources) {
      const source = await readFile(path, 'utf8');
      if (/from\s+['"][^'"]*devtools\//.test(source)) {
        violations.push(relative(repositoryRoot, path));
      }
    }

    const productionConfig = await readFile(
      join(repositoryRoot, 'apps/site/astro.config.mjs'),
      'utf8',
    );
    expect(violations).toEqual([]);
    expect(productionConfig).not.toContain('devtools');
    expect(productionConfig).not.toContain('content-health');
  });

  it('keeps the wallpaper application independent from page and navigation runtimes', async () => {
    const sourceRoot = join(repositoryRoot, 'apps/site/src');
    const wallpaperRoot = join(sourceRoot, 'features/appearance/wallpaper');
    const applicationSources = (await collectSourceFiles(sourceRoot)).filter(
      (path) => !path.startsWith(`${wallpaperRoot}/`),
    );
    const consumers: string[] = [];

    for (const path of applicationSources) {
      const source = await readFile(path, 'utf8');
      if (/from\s+['"][^'"]*appearance\/wallpaper\//.test(source)) {
        consumers.push(relative(repositoryRoot, path));
      }
    }

    const wallpaperSources = await collectSourceFiles(wallpaperRoot);
    const forbiddenDependencies: string[] = [];
    for (const path of wallpaperSources) {
      const source = await readFile(path, 'utf8');
      if (/from\s+['"][^'"]*(?:runtime|components|pages|layouts)\//.test(source)) {
        forbiddenDependencies.push(relative(repositoryRoot, path));
      }
    }

    expect(consumers).toEqual([]);
    expect(forbiddenDependencies).toEqual([]);
  });

  it('keeps content as data and imports interactive behavior through content-ui', async () => {
    const contentRoot = join(repositoryRoot, 'src/content');
    const implementationExtensions = new Set(['.astro', '.css', '.ts', '.tsx']);

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

    const contentFiles = await collectContentFiles(contentRoot);
    expect(
      contentFiles
        .filter((path) => implementationExtensions.has(extname(path)))
        .map((path) => relative(repositoryRoot, path)),
    ).toEqual([]);

    const applicationImports: string[] = [];
    for (const path of contentFiles.filter((path) => extname(path) === '.mdx')) {
      const source = await readFile(path, 'utf8');
      if (/from\s+["'](?:\.\.\/)+(?:components|i18n|lib|paraglide|styles)\//.test(source)) {
        applicationImports.push(relative(repositoryRoot, path));
      }
    }
    expect(applicationImports).toEqual([]);
  });

  it('keeps shared packages from reaching back into application source', async () => {
    const packageRoots = ['content-ui', 'site-build', 'site-domain', 'site-i18n'].map((name) =>
      join(repositoryRoot, 'packages', name),
    );
    const violations: string[] = [];

    for (const packageRoot of packageRoots) {
      const sourceFiles = await collectSourceFiles(join(packageRoot, 'src'));
      for (const path of sourceFiles) {
        const source = await readFile(path, 'utf8');
        for (const match of source.matchAll(/(?:from\s+|import\s*\()["']([^"']+)/g)) {
          const specifier = match[1];
          if (!specifier?.startsWith('.')) continue;
          const target = resolve(dirname(path), specifier);
          if (relative(packageRoot, target).startsWith('..')) {
            violations.push(`${relative(repositoryRoot, path)} -> ${specifier}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
