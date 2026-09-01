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
        ['apps/site-v2/src', 'src', 'tests/unit', 'worker'].map((directory) =>
          collectSourceFiles(join(repositoryRoot, directory)),
        ),
      )
    )
      .flat()
      .filter((path) => !path.endsWith('architecture-boundaries.test.ts'));
    sourceFiles.push(join(repositoryRoot, 'astro.config.mjs'));

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

  it('keeps the production v2 island runtime Solid-only', async () => {
    const sourceFiles = await collectSourceFiles(join(repositoryRoot, 'apps/site-v2/src'));
    expect(sourceFiles.filter((path) => extname(path) === '.svelte')).toEqual([]);

    const packageManifest = await readFile(
      join(repositoryRoot, 'apps/site-v2/package.json'),
      'utf8',
    );
    const astroConfig = await readFile(
      join(repositoryRoot, 'apps/site-v2/astro.config.mjs'),
      'utf8',
    );
    expect(packageManifest).not.toContain('@astrojs/svelte');
    expect(packageManifest).not.toMatch(/"svelte"\s*:/);
    expect(astroConfig).not.toContain('@astrojs/svelte');
  });

  it('keeps v2 development tools outside the production application graph', async () => {
    const productionSources = await collectSourceFiles(join(repositoryRoot, 'apps/site-v2/src'));
    const violations: string[] = [];

    for (const path of productionSources) {
      const source = await readFile(path, 'utf8');
      if (/from\s+['"][^'"]*devtools\//.test(source)) {
        violations.push(relative(repositoryRoot, path));
      }
    }

    const productionConfig = await readFile(
      join(repositoryRoot, 'apps/site-v2/astro.config.mjs'),
      'utf8',
    );
    expect(violations).toEqual([]);
    expect(productionConfig).not.toContain('devtools');
    expect(productionConfig).not.toContain('content-health');
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

    const legacyImports: string[] = [];
    for (const path of contentFiles.filter((path) => extname(path) === '.mdx')) {
      const source = await readFile(path, 'utf8');
      if (/from\s+["'](?:\.\.\/)+(?:components|i18n|lib|paraglide|styles)\//.test(source)) {
        legacyImports.push(relative(repositoryRoot, path));
      }
    }
    expect(legacyImports).toEqual([]);
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

  it('keeps one explicit v2 browser runtime composition root', async () => {
    const layout = await readFile(
      join(repositoryRoot, 'apps/site-v2/src/layouts/BaseLayout.astro'),
      'utf8',
    );
    expect(layout).toContain("import SiteRuntime from '../components/SiteRuntime.astro'");

    const featureControllers = await Promise.all(
      [
        ['article', 'article-controller.ts'],
        ['blog', 'blog-controller.ts'],
        ['search', 'search-controller.ts'],
      ].map(([feature, name]) =>
        readFile(
          join(repositoryRoot, 'apps/site-v2/src/features', feature!, 'runtime', name!),
          'utf8',
        ),
      ),
    );
    for (const source of featureControllers) {
      expect(source).not.toContain("addEventListener('astro:");
      expect(source).not.toMatch(/\blet installed\s*=/);
    }
  });

  it('keeps page implementation and base styles inside vertical feature slices', async () => {
    const sourceRoot = join(repositoryRoot, 'apps/site-v2/src');
    expect((await readdir(join(sourceRoot, 'features'))).sort()).toEqual([
      'appearance',
      'article',
      'blog',
      'foundation',
      'projects',
      'search',
    ]);
    expect((await readdir(join(sourceRoot, 'components'))).sort()).toEqual([
      'SiteFooter.astro',
      'SiteRuntime.astro',
      'SiteShell.astro',
      'SiteShellController.astro',
      'site-shell',
    ]);
    expect((await readdir(join(sourceRoot, 'components/site-shell'))).sort()).toEqual([
      'SiteHeaderNavigation.astro',
      'SiteHeaderUtilities.astro',
      'WallpaperSettings.astro',
    ]);
    expect((await readdir(join(sourceRoot, 'features/appearance/components'))).sort()).toEqual([
      'BackdropSurface.astro',
    ]);
    expect((await readdir(join(sourceRoot, 'runtime'))).sort()).toEqual([
      'build-generation.ts',
      'build-identity.ts',
      'font-coordinator.ts',
      'initial-frame.ts',
      'locale-navigation-transfer.ts',
      'locale-preference.ts',
      'navigation-coordinator.ts',
      'navigation-feedback.ts',
      'page-outlet-transition.ts',
      'page-runtime.ts',
      'scroll-state.ts',
      'site-runtime.ts',
      'site-shell-controller.ts',
      'state-ledger.ts',
      'transient-overlay-controller.ts',
    ]);

    const styleIndex = await readFile(join(sourceRoot, 'styles/index.css'), 'utf8');
    for (const featureStyle of [
      'appearance/styles.css',
      'appearance/responsive.css',
      'article/styles.css',
      'article/responsive.css',
      'article/compact.css',
      'blog/styles.css',
      'blog/responsive.css',
      'foundation/home.css',
      'foundation/about.css',
      'foundation/responsive.css',
      'projects/styles.css',
      'search/styles.css',
    ]) {
      expect(styleIndex).toContain(`../features/${featureStyle}`);
    }
  });

  it('keeps backdrop bootstrap literal and runtime ownership split by responsibility', async () => {
    const appearanceRoot = join(repositoryRoot, 'apps/site-v2/src/features/appearance');
    const surface = await readFile(
      join(appearanceRoot, 'components/BackdropSurface.astro'),
      'utf8',
    );
    const controller = await readFile(
      join(appearanceRoot, 'runtime/wallpaper-controller.ts'),
      'utf8',
    );

    expect(surface).toContain('<script is:inline>');
    expect(surface).not.toContain('set:html');
    expect(surface).not.toMatch(/\.toString\(\)/);
    expect(controller).toContain("import { BackdropPresenter } from './backdrop-presenter'");
    expect(controller).toContain(
      "import { ScenicWallpaperSession } from './scenic-wallpaper-session'",
    );
  });
});
