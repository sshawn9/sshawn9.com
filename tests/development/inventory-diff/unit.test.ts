import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareInventories,
  renderInventoryDiffMarkdown,
  renderInventoryDiffSummary,
} from '../../../apps/site/tools/resource-inventory/diff.mjs';

const site = 'https://site.test';
const url = (path: string) => new URL(path, site).href;
const cli = fileURLToPath(
  new URL('../../../apps/site/tools/resource-inventory/diff-cli.mjs', import.meta.url),
);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function inventory(buildId: string, pages = ['/'], assets = ['/app.js']) {
  return {
    site,
    buildId,
    mode: 'production',
    pages: pages.map((path) => ({
      url: url(path),
      title: `Title ${path}`,
      language: 'en',
      kind: 'page',
    })),
    resources: [
      ...pages.map((path) => ({ url: url(path), type: 'html', external: false, bytes: 100 })),
      ...assets.map((path) => ({
        url: url(path),
        type: 'js',
        external: new URL(path, site).origin !== site,
        bytes: 10,
      })),
    ],
  };
}

async function fixture(before: unknown = inventory('old'), after: unknown = inventory('new')) {
  const parent = fileURLToPath(new URL('../../.results/', import.meta.url));
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'inventory-diff-'));
  directories.push(directory);
  const beforePath = join(directory, 'before snapshot.json');
  const afterPath = join(directory, 'after snapshot.json');
  await writeFile(beforePath, JSON.stringify(before));
  await writeFile(afterPath, JSON.stringify(after));
  return { directory, beforePath, afterPath };
}

function run(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 });
}

describe('production inventory differences', () => {
  it('lists added and removed full URLs without counting page HTML as resources', () => {
    const before = inventory(
      'old',
      ['/', '/removed/'],
      ['/app.old.js', '/data.json?v=1', '/shared.js'],
    );
    const after = inventory(
      'new',
      ['/', '/z/', '/a/'],
      ['/shared.js', '/data.json?v=2', '/app.new.js', 'https://cdn.test/external.js'],
    );
    const originals = structuredClone([before, after]);
    const result = compareInventories(before, after);
    expect(result.before).toEqual({ buildId: 'old', pages: 2, resources: 3 });
    expect(result.after).toEqual({ buildId: 'new', pages: 3, resources: 4 });
    expect(result.pages.added.map((item) => item.url)).toEqual([url('/a/'), url('/z/')]);
    expect(result.pages.removed).toEqual([before.pages[1]]);
    expect(result.resources.added.map((item) => item.url)).toEqual([
      'https://cdn.test/external.js',
      url('/app.new.js'),
      url('/data.json?v=2'),
    ]);
    expect(result.resources.removed.map((item) => item.url)).toEqual([
      url('/app.old.js'),
      url('/data.json?v=1'),
    ]);
    expect(result.resources.added[0].external).toBe(true);
    expect([before, after]).toEqual(originals);
  });

  it('ignores order, build identity, titles and size changes at unchanged URLs', () => {
    const before = inventory('old', ['/', '/404'], ['/b.js', '/a.js?v=1', '/a.js?v=2']);
    const after = structuredClone(before);
    after.buildId = 'new';
    after.pages[0].title = 'Changed title';
    after.resources[0].bytes = 999;
    after.pages.reverse();
    after.resources.reverse();
    const result = compareInventories(before, after);
    expect(result.pages).toEqual({ added: [], removed: [] });
    expect(result.resources).toEqual({ added: [], removed: [] });
    expect(renderInventoryDiffMarkdown(result)).toContain('| Resources | 3 | 3 | 0 | 0 |');
  });

  it('accepts explicit empty lists and includes entry/404 pages in additions and removals', () => {
    const empty = inventory('empty', [], []);
    const full = inventory('full', ['/', '/404']);
    expect(compareInventories(empty, full).pages.added).toEqual(full.pages);
    expect(compareInventories(full, empty).pages.removed).toEqual(full.pages);
  });

  it.each([
    [
      'missing build identity',
      (value: any) => {
        delete value.buildId;
      },
    ],
    [
      'preview mode',
      (value: any) => {
        value.mode = 'preview';
      },
    ],
    [
      'missing pages',
      (value: any) => {
        delete value.pages;
      },
    ],
    [
      'missing resources',
      (value: any) => {
        delete value.resources;
      },
    ],
    [
      'invalid URL',
      (value: any) => {
        value.pages[0].url = 'javascript:alert(1)';
      },
    ],
    [
      'null entry',
      (value: any) => {
        value.resources[0] = null;
      },
    ],
    [
      'duplicate page',
      (value: any) => {
        value.pages.push(value.pages[0]);
      },
    ],
    [
      'duplicate resource',
      (value: any) => {
        value.resources.push(value.resources[0]);
      },
    ],
    [
      'missing page HTML',
      (value: any) => {
        value.resources.shift();
      },
    ],
    [
      'invalid external flag',
      (value: any) => {
        value.resources[1].external = true;
      },
    ],
  ])('rejects %s in either snapshot', (_name, invalidate) => {
    const valid = inventory('valid');
    const invalid = structuredClone(valid);
    invalidate(invalid);
    expect(() => compareInventories(invalid, valid)).toThrow();
    expect(() => compareInventories(valid, invalid)).toThrow();
  });

  it('rejects inventories from different sites', () => {
    expect(() =>
      compareInventories(inventory('old'), {
        ...inventory('new', [], []),
        site: 'https://other.test',
      }),
    ).toThrow('same site');
  });
});

describe('inventory report rendering', () => {
  it('escapes page titles and includes external resource markers and four lists', () => {
    const after = inventory('new', ['/new/'], ['https://cdn.test/asset.js?q=1&v=2']);
    after.pages[0].title = '<img> [title] | test\nnext';
    const report = compareInventories(inventory('old', [], []), after);
    const markdown = renderInventoryDiffMarkdown(report);
    expect(markdown).toContain('&lt;img&gt; \\[title\\] \\| test next');
    expect(markdown).toContain('(external)');
    expect(markdown).toContain('(<https://cdn.test/asset.js?q=1&v=2>)');
    for (const section of [
      'Added pages (1)',
      'Removed pages (0)',
      'Added resources (1)',
      'Removed resources (0)',
    ]) {
      expect(markdown).toContain(`<summary>${section}</summary>`);
    }
    expect(renderInventoryDiffSummary(report)).toBe(markdown);
  });

  it('bounds a large UTF-8 summary while keeping full Markdown and counts', () => {
    const after = inventory('new', ['/long-title/'], []);
    after.pages[0].title = '中文'.repeat(200000);
    const report = compareInventories(inventory('old', [], []), after);
    expect(Buffer.byteLength(renderInventoryDiffMarkdown(report))).toBeGreaterThan(1024 * 1024);
    const summary = renderInventoryDiffSummary(report);
    expect(Buffer.byteLength(summary)).toBeLessThan(1024 * 1024);
    expect(summary).toContain('| Pages | 0 | 1 | 1 | 0 |');
    expect(summary).toContain('Showing 0 of 1; download diff.md');
    expect(summary.match(/<details>/g)).toHaveLength(4);
    expect(summary.match(/<\/details>/g)).toHaveLength(4);
  });
});

describe('inventory diff CLI', () => {
  it('validates without writing reports, then produces files and appends the summary offline', async () => {
    const before = inventory('old', ['/', '/old/'], ['/old.js']);
    const after = inventory('new', ['/', '/new/'], ['/new.js']);
    const { directory, beforePath, afterPath } = await fixture(before, after);
    const check = run(beforePath, afterPath, '--check');
    expect(check.status, check.stderr).toBe(0);
    expect((await readdir(directory)).sort()).toEqual([
      'after snapshot.json',
      'before snapshot.json',
    ]);

    const summary = join(directory, 'summary.md');
    await writeFile(summary, 'Existing deployment URL\n\n');
    const result = run(beforePath, afterPath, '--output', directory, '--summary', summary);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(await readFile(join(directory, 'diff.json'), 'utf8'));
    expect(report.pages.removed).toEqual([before.pages[1]]);
    expect(report.resources.added).toEqual([after.resources[2]]);
    expect(report.beforeSavedAt).toMatch(/^\d{4}-/);
    expect(await readFile(join(directory, 'diff.md'), 'utf8')).toContain('Added resources (1)');
    expect(await readFile(summary, 'utf8')).toMatch(
      /^Existing deployment URL\n\n### Production inventory changes/,
    );
    expect(JSON.parse(await readFile(beforePath, 'utf8'))).toEqual(before);
    expect(JSON.parse(await readFile(afterPath, 'utf8'))).toEqual(after);
  });

  it.each(['missing', 'invalid JSON', 'invalid shape'])(
    'fails the pre-deployment check for %s without publishing reports',
    async (failure) => {
      const { directory, beforePath, afterPath } = await fixture();
      if (failure === 'missing') await rm(beforePath);
      else
        await writeFile(beforePath, failure === 'invalid JSON' ? '<html>Unavailable</html>' : '{}');
      const result = run(beforePath, afterPath, '--check');
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Inventory comparison failed:');
      expect(await readdir(directory)).not.toContain('diff.json');
    },
  );
});
